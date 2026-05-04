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
  $networkHosts = $null
  if ($NetworkName) {
    $networkHosts = Get-VirtualPortGroup -Name $NetworkName -ErrorAction SilentlyContinue |
                    ForEach-Object { $_.VMHost } | Sort-Object -Property Name -Unique
    if (-not $networkHosts) {
      # VDS 또는 opaque 인 경우는 모든 호스트에서 사용 가능하다고 가정 (보통 그러함)
      $vds = Get-VDPortgroup -Name $NetworkName -ErrorAction SilentlyContinue
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
  # 표준 / 분산 / opaque(NSX) 네트워크 모두 다단계 폴백으로 검색.
  if ($NetworkName) {
    # 1) 표준 포트그룹 (모든 호스트에서 검색 — VM 이 떨어진 호스트가 아닌 다른 호스트에 있을 수 있음)
    $portgroup = Get-VirtualPortGroup -Name $NetworkName -ErrorAction SilentlyContinue | Select-Object -First 1

    # 2) 분산 포트그룹 (VDS)
    if (-not $portgroup) {
      $portgroup = Get-VDPortgroup -Name $NetworkName -ErrorAction SilentlyContinue | Select-Object -First 1
    }

    # 3) Get-View 로 모든 종류의 Network 검색 (opaque network 포함)
    if (-not $portgroup) {
      $escaped = [regex]::Escape($NetworkName)
      $netView = Get-View -ViewType Network -Filter @{"Name" = "^$escaped$"} -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($netView) {
        $portgroup = Get-VIObjectByVIView -MORef $netView.MoRef
      }
    }

    if (-not $portgroup) {
      $available = (Get-VirtualPortGroup | Select-Object -ExpandProperty Name) +
                   (Get-VDPortgroup | Select-Object -ExpandProperty Name) | Select-Object -Unique
      throw ("Network not found: {0}. Available: {1}" -f $NetworkName, ($available -join ', '))
    }

    $nics = Get-NetworkAdapter -VM $vm
    foreach ($nic in $nics) {
      if ($portgroup.GetType().Name -like '*DPortgroup*') {
        Set-NetworkAdapter -NetworkAdapter $nic -Portgroup $portgroup -StartConnected $true -Confirm:$false | Out-Null
      } else {
        Set-NetworkAdapter -NetworkAdapter $nic -NetworkName $NetworkName -StartConnected $true -Confirm:$false | Out-Null
      }
    }
    Write-Output ("Network attached: {0} (type={1}, StartConnected=true)" -f $NetworkName, $portgroup.GetType().Name)
  }
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
