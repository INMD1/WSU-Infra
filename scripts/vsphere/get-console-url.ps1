#!/usr/bin/env pwsh
<#
.SYNOPSIS
  vSphere HTML5 웹콘솔 URL 발급 (sessionTicket 포함).
  govc vm.console -h5 가 ticket 없이 URL 만 돌려주는 vCenter 환경에서 사용.
.NOTES
  비밀번호는 VCENTER_PASSWORD 환경변수로 전달.
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
  $vmView = $vm | Get-View

  # 단명 sessionTicket 발급 (CloneTicket — 원격 콘솔 인증용)
  $si = Get-View -Id 'ServiceInstance'
  $sm = Get-View -Id $si.Content.SessionManager
  $ticket = $sm.AcquireCloneTicket()

  # VM 이 떨어진 호스트 정보 (콘솔 endpoint + thumbprint 필요)
  # SSL thumbprint 는 Summary.Config.SslThumbprint 경로에 있음 (Config.SslThumbprint 아님)
  $hostView = Get-View -Id $vmView.Runtime.Host -Property Name, Summary.Config.SslThumbprint
  $hostName = $hostView.Name
  $thumbprint = $hostView.Summary.Config.SslThumbprint
  $serverGuid = $si.Content.About.InstanceUuid

  # VMRC 데스크톱 앱 URL.
  # vCenter SAML 필터가 /ui/webconsole.html 의 sessionTicket 인증을 차단하는 환경에서
  # 가장 안정적인 우회 — 클라이언트 PC 의 VMRC 가 ticket 으로 직접 vCenter 에 접속.
  # 형식: vmrc://clone:<ticket>@<vcenter>:443/?moid=<vm-moref>
  $moid = $vmView.MoRef.Value
  $url = "vmrc://clone:${ticket}@${VCenterServer}:443/?moid=${moid}"
  Write-Output $url
}
finally {
  if ($global:DefaultVIServer) {
    Disconnect-VIServer -Server $global:DefaultVIServer -Confirm:$false -Force | Out-Null
  }
}
