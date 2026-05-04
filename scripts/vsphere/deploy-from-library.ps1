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
  [string]$FolderName = ""
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
  if ($FolderName) {
    $params.Location = Get-Folder -Name $FolderName -Type VM -ErrorAction Stop
  }

  $vm = New-VM @params -ErrorAction Stop
  Write-Output ("Deployed: {0}" -f $vm.Name)
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
