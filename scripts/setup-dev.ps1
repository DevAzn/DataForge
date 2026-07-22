# One-shot setup for Windows developers (run from repo root).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/setup-dev.ps1

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Node version (need 20+):" -ForegroundColor Cyan
node -v
npm -v

Write-Host "==> npm install (downloads deps + rebuilds better-sqlite3 for Electron)..." -ForegroundColor Cyan
npm install

Write-Host "==> Repair Electron binary if needed..." -ForegroundColor Cyan
npm run repair:electron

Write-Host "==> Typecheck..." -ForegroundColor Cyan
npm run typecheck

Write-Host ""
Write-Host "Setup OK. Start the app with:" -ForegroundColor Green
Write-Host "  npm run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "Build Windows installers with:" -ForegroundColor Green
Write-Host "  npm run dist:win" -ForegroundColor Yellow
Write-Host "  (outputs under release/; copy .exe into installers/ if needed)" -ForegroundColor DarkGray
