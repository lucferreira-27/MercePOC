$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$ready = $false
try { $health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 2; $ready = [bool]$health.model } catch {}
if (-not $ready) {
  if (-not (Test-Path -LiteralPath 'dist/server')) { throw 'Execute npm install e npm run build nesta pasta primeiro.' }
  New-Item -ItemType Directory -Force -Path 'work' | Out-Null
  $nodeExecutable = (Get-Command node.exe).Source
  Start-Process -FilePath $nodeExecutable -ArgumentList 'scripts/start.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'work/server.log' -RedirectStandardError 'work/server-error.log' | Out-Null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 1; $ready = [bool]$health.model; if ($ready) { break } } catch {}
  }
}
if (-not $ready) { throw 'O servidor não iniciou. Consulte work/server-error.log.' }
Start-Process 'http://127.0.0.1:4310/'
