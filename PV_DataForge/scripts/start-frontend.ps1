# Start PV_DataForge Vue dev server (proxies /api -> :8765)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"
Set-Location $Frontend

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    npm install
}

Write-Host "UI: http://127.0.0.1:5173"
npm run dev
