# Start PV_DataForge FastAPI backend on port 8765
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
Set-Location $Backend

$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Creating virtualenv..."
    python -m venv .venv
    & $venvPython -m pip install -r requirements.txt
}

Write-Host "API: http://127.0.0.1:8765  docs: http://127.0.0.1:8765/docs"
& $venvPython -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
