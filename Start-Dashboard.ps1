$ErrorActionPreference = 'Stop'
$dashboardRoot = $PSScriptRoot
$dashboardUrl = 'http://127.0.0.1:4318/'
$dashboardRunning = $false
try {
  $response = Invoke-WebRequest -Uri ($dashboardUrl + 'health') -UseBasicParsing -TimeoutSec 2
  $dashboardRunning = ($response.Content | ConvertFrom-Json).service -eq 'advanblack-local-dashboard'
} catch {}
if (-not $dashboardRunning) {
  $dashboardNode = (Get-Command node -ErrorAction Stop).Source
  $dashboardServer = Join-Path $dashboardRoot 'server.mjs'
  Start-Process -FilePath $dashboardNode -ArgumentList ('"' + $dashboardServer + '"') -WorkingDirectory $dashboardRoot -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri ($dashboardUrl + 'health') -UseBasicParsing -TimeoutSec 2
      if (($response.Content | ConvertFrom-Json).service -eq 'advanblack-local-dashboard') { $dashboardRunning = $true; break }
    } catch {}
  }
}
if (-not $dashboardRunning) { throw 'The local dashboard could not start. Check whether port 4318 is in use.' }
Start-Process $dashboardUrl
