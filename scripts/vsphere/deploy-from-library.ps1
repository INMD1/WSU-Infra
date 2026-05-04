#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Content Library OVA/OVF 항목을 vSphere에 배포. DatastoreCluster(StoragePod)를
  네이티브 지원하므로 govc library.deploy 와 달리 클러스터 이름을 그대로 받을 수 있다.
.NOTES
  - 비밀번호는 VCENTER_PASSWORD 환경변수로 전달 (argv 노출 방지)
  - PowerShell 7+ 와 VMware.PowerCLI 모듈 필요
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$VCenterServer,
  [Parameter(Mandatory=$true)][string]$Username,
  [Parameter(Mandatory=$true)][string]$LibraryName,
  [Parameter(Mandatory=$true)][string]$ItemName,
  [Parameter(Mandatory=$true)][string]$VMName,
  [Parameter(Mandatory=$true)][string]$DatastoreName,
  [string]$ResourcePoolName = "",
  [string]$FolderName = "",
  [string]$VMHostName = "",
  [string]$NetworkName = ""
)

$ErrorActionPreference = 'Stop'

$Password = $env:VCENTER_PASSWORD
if (-not $Password) { throw "VCENTER_PASSWORD environment variable is not set" }

# 자체서명 인증서 허용 (govc -k 와 동일)
Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -Confirm:$false -Scope Session | Out-Null
Set-PowerCLIConfiguration -ParticipateInCEIP $false -Confirm:$false -Scope Session | Out-Null

try {
  $secPwd = ConvertTo-SecureString $Password -AsPlainText -Force
  $cred = [System.Management.Automation.PSCredential]::new($Username, $secPwd)
  Connect-VIServer -Server $VCenterServer -Credential $cred -Force | Out-Null

  $library = Get-ContentLibrary -Name $LibraryName -ErrorAction Stop
  $item = Get-ContentLibraryItem -ContentLibrary $library -Name $ItemName -ErrorAction Stop

  # 클러스터 우선, 없으면 단일 데이터스토어
  $target = Get-DatastoreCluster -Name $DatastoreName -ErrorAction SilentlyContinue
  if (-not $target) {
    $target = Get-Datastore -Name $DatastoreName -ErrorAction Stop
  }

  # 네트워크가 주어졌으면 그 PG 가 실제로 존재하는 호스트로만 deploy 후보 제한.
  # (예: Internal-VNIC 는 vSwitch2 에만 있는데 클러스터의 모든 호스트가 vSwitch2 를
  #  갖지는 않을 때 SDRS 가 잘못된 호스트로 떨어뜨려 NIC 할당이 실패하는 문제 해결)
  # PowerCLI -Name 매칭이 wildcard 로 동작해 정확매칭에 실패할 수 있어 Where-Object 로 직접 필터.
  $networkHosts = $null
  $standardPgs = @()
  if ($NetworkName) {
    $standardPgs = @(Get-VirtualPortGroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName })
    if ($standardPgs.Count -gt 0) {
      $networkHosts = $standardPgs | Select-Object -ExpandProperty VMHost | Sort-Object Name -Unique
      Write-Output ("Standard PG '{0}' 보유 호스트: {1}" -f $NetworkName, (($networkHosts | Select-Object -ExpandProperty Name) -join ', '))
    } else {
      $vds = Get-VDPortgroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName }
      if (-not $vds) {
        Write-Warning ("Could not pre-resolve hosts for network '{0}' — relying on PowerCLI defaults" -f $NetworkName)
      }
    }
  }

  $params = @{
    ContentLibraryItem = $item
    Name = $VMName
    Datastore = $target
  }
  if ($ResourcePoolName) {
    $params.ResourcePool = Get-ResourcePool -Name $ResourcePoolName -ErrorAction Stop
  }

  # VMHost 결정: 사용자 지정 우선, 단 그 호스트가 네트워크를 못 보면 무시
  $resolvedHost = $null
  if ($VMHostName) {
    $resolvedHost = Get-VMHost -Name $VMHostName -ErrorAction SilentlyContinue
    if ($networkHosts -and $resolvedHost -and -not ($networkHosts.Name -contains $resolvedHost.Name)) {
      Write-Warning ("Requested VMHost '{0}' does not have network '{1}' — overriding" -f $VMHostName, $NetworkName)
      $resolvedHost = $null
    }
  }
  if (-not $resolvedHost -and $networkHosts) {
    # 네트워크 보유 호스트 중 메모리 여유가 가장 큰 곳 선택
    $resolvedHost = $networkHosts | Sort-Object -Property @{Expression={ $_.MemoryTotalGB - $_.MemoryUsageGB }; Descending=$true} | Select-Object -First 1
  }
  if ($resolvedHost) {
    $params.VMHost = $resolvedHost
    Write-Output ("Selected VMHost: {0}" -f $resolvedHost.Name)
  }
  if ($FolderName) {
    $params.Location = Get-Folder -Name $FolderName -Type VM -ErrorAction Stop
  }

  # New-VM 은 ResourcePool / VMHost 중 하나가 필수. 둘 다 없으면 폴백.
  if (-not $params.ContainsKey('ResourcePool') -and -not $params.ContainsKey('VMHost')) {
    $cluster = Get-Cluster -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cluster) {
      $params.ResourcePool = $cluster | Get-ResourcePool -Name Resources -ErrorAction Stop
    } else {
      $params.VMHost = Get-VMHost -ErrorAction Stop | Select-Object -First 1
    }
  }

  $vm = New-VM @params -ErrorAction Stop
  Write-Output ("Deployed: {0}" -f $vm.Name)

  # 네트워크 어댑터를 지정 포트그룹에 연결하고 StartConnected 활성화.
  # Where-Object 정확매칭 + Move-VM 으로 호스트 정합성 보장 + -Portgroup 객체 직접 전달.
  if ($NetworkName) {
    # VM 이 deploy 된 실제 호스트 확인 (deploy 후 객체 갱신)
    $vm = Get-VM -Name $vm.Name

    $portgroup = $null
    $isVds = $false

    # 1) VM 의 현재 호스트에서 표준 PG 우선 검색 (이미 같은 호스트면 Move 불필요)
    $portgroup = $vm.VMHost | Get-VirtualPortGroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName } | Select-Object -First 1

    # 2) 다른 호스트의 표준 PG → VM 을 그 호스트로 vMotion 이동 후 PG 재조회
    if (-not $portgroup -and $standardPgs.Count -gt 0) {
      $targetHost = $standardPgs | Select-Object -ExpandProperty VMHost | Sort-Object @{Expression={ $_.MemoryTotalGB - $_.MemoryUsageGB }; Descending=$true} | Select-Object -First 1
      if ($targetHost.Name -ne $vm.VMHost.Name) {
        Write-Output ("Moving VM '{0}' from '{1}' to '{2}' (network 보유 호스트)" -f $vm.Name, $vm.VMHost.Name, $targetHost.Name)
        Move-VM -VM $vm -Destination $targetHost -Confirm:$false -ErrorAction Stop | Out-Null
        $vm = Get-VM -Name $vm.Name
      }
      $portgroup = $vm.VMHost | Get-VirtualPortGroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName } | Select-Object -First 1
    }

    # 3) VDS 분산 포트그룹
    if (-not $portgroup) {
      $portgroup = Get-VDPortgroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName } | Select-Object -First 1
      if ($portgroup) { $isVds = $true }
    }

    # 4) Get-View 로 모든 Network 객체 (opaque/NSX 포함)
    if (-not $portgroup) {
      $netView = Get-View -ViewType Network -Property Name -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $NetworkName } | Select-Object -First 1
      if ($netView) {
        $portgroup = Get-VIObjectByVIView -MORef $netView.MoRef
      }
    }

    if (-not $portgroup) {
      $std = (Get-VirtualPortGroup | Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue)
      $vds = (Get-VDPortgroup | Select-Object -ExpandProperty Name -ErrorAction SilentlyContinue)
      $available = @($std + $vds) | Select-Object -Unique
      throw ("Network not found: {0}. Available: {1}" -f $NetworkName, ($available -join ', '))
    }

    $nics = Get-NetworkAdapter -VM $vm
    foreach ($nic in $nics) {
      Set-NetworkAdapter -NetworkAdapter $nic -Portgroup $portgroup -StartConnected $true -Confirm:$false -ErrorAction Stop | Out-Null
    }
    Write-Output ("Network attached: {0} (type={1}, host={2}, StartConnected=true)" -f $NetworkName, $portgroup.GetType().Name, $vm.VMHost.Name)
  }
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
