#!/usr/bin/env pwsh
<#
.SYNOPSIS
  ESXi WebMKS ticket 발급 — 자체 호스팅 wmks.js 가 ESXi 호스트와 직접 wss 연결할 때 사용.
.NOTES
  비밀번호는 VCENTER_PASSWORD 환경변수로 전달.
  출력: 단일 JSON 라인 (ticket / host / port / sslThumbprint / cfgFile / vmName / vmId)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$VCenterServer,
  [Parameter(Mandatory=$true)][string]$Username,
  [Parameter(Mandatory=$true)][string]$VMName
)

$ErrorActionPreference = 'Stop'

$Password = $env:VCENTER_PASSWORD
if (-not $Password) { throw "VCENTER_PASSWORD environment variable is not set" }

Set-PowerCLIConfiguration -InvalidCertificateAction Ignore -ParticipateInCEIP $false -Confirm:$false -Scope Session | Out-Null

try {
  $secPwd = ConvertTo-SecureString $Password -AsPlainText -Force
  $cred = [System.Management.Automation.PSCredential]::new($Username, $secPwd)
  Connect-VIServer -Server $VCenterServer -Credential $cred -Force | Out-Null

  $vm = Get-VM -Name $VMName -ErrorAction Stop
  $mks = $vm.ExtensionData.AcquireTicket("webmks")

  $result = [ordered]@{
    ticket        = $mks.Ticket
    host          = $mks.Host
    port          = $mks.Port
    cfgFile       = $mks.CfgFile
    sslThumbprint = $mks.SslThumbprint
    vmId          = $vm.ExtensionData.MoRef.Value
    vmName        = $VMName
  }

  $result | ConvertTo-Json -Compress
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
