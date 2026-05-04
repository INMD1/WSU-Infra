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

  $params = @{
    ContentLibraryItem = $item
    Name = $VMName
    Datastore = $target
  }
  if ($ResourcePoolName) {
    $params.ResourcePool = Get-ResourcePool -Name $ResourcePoolName -ErrorAction Stop
  }
  if ($VMHostName) {
    $params.VMHost = Get-VMHost -Name $VMHostName -ErrorAction Stop
  }
  if ($FolderName) {
    $params.Location = Get-Folder -Name $FolderName -Type VM -ErrorAction Stop
  }

  # New-VM 은 ResourcePool / VMHost 중 하나가 필수.
  # 둘 다 안 들어왔으면 첫 번째 클러스터의 루트 풀(Resources) 자동 선택.
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
  # 표준 포트그룹과 분산 포트그룹(VDS) 모두 지원 — 표준 먼저 찾고 없으면 분산.
  if ($NetworkName) {
    $portgroup = Get-VirtualPortGroup -Name $NetworkName -VMHost $vm.VMHost -ErrorAction SilentlyContinue
    if (-not $portgroup) {
      $portgroup = Get-VDPortgroup -Name $NetworkName -ErrorAction SilentlyContinue
    }
    if (-not $portgroup) {
      throw ("Network not found: {0}" -f $NetworkName)
    }

    $nics = Get-NetworkAdapter -VM $vm
    foreach ($nic in $nics) {
      if ($portgroup.GetType().Name -eq 'VDPortgroupImpl') {
        Set-NetworkAdapter -NetworkAdapter $nic -Portgroup $portgroup -StartConnected $true -Confirm:$false | Out-Null
      } else {
        Set-NetworkAdapter -NetworkAdapter $nic -NetworkName $NetworkName -StartConnected $true -Confirm:$false | Out-Null
      }
    }
    Write-Output ("Network attached: {0} (StartConnected=true)" -f $NetworkName)
  }
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
