# Start DataForge in single-process mode (API + built UI on port 8765).
# Builds the UI if frontend/dist is missing. Requires backend\.venv.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$py = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    throw "Missing backend\.venv - run install first (or: python -m venv backend\.venv)"
}

$distIndex = Join-Path $Root "frontend\dist\index.html"
if (-not (Test-Path $distIndex)) {
    Write-Host "Building frontend..."
    Push-Location (Join-Path $Root "frontend")
    if (-not (Test-Path "node_modules")) { npm install }
    npm run build
    Pop-Location
}

Write-Host "Starting DataForge at http://127.0.0.1:8765/"
& $py (Join-Path $Root "backend\desktop_main.py")
