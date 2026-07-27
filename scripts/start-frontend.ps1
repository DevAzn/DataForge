# Start DataForge Vue dev server (proxies /api -> :8765) — Windows PowerShell
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Frontend = Join-Path $Root "frontend"
Set-Location $Frontend

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm not found. Install Node.js 18+ from https://nodejs.org/"
}

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    npm install
}

Write-Host "UI: http://localhost:5173"
npm run dev -- --host 127.0.0.1 --port 5173
