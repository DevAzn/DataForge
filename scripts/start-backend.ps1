# Start DataForge FastAPI backend on port 8765 (Windows PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
Set-Location $Backend

function Resolve-Python {
  $candidates = @(
    "$env:USERPROFILE\.local\bin\python3.14.exe",
    "$env:APPDATA\uv\python\cpython-3.14.6-windows-x86_64-none\python.exe",
    "$env:USERPROFILE\.local\bin\python3.exe",
    "py",
    "python"
  )
  foreach ($c in $candidates) {
    if ($c -eq "py" -or $c -eq "python" -or (Test-Path $c)) {
      try {
        $v = & $c -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($v -match '^3\.(1[2-9]|[2-9]\d)$') { return $c }
      } catch { }
    }
  }
  throw "Need Python 3.12+ on PATH"
}

$venvPython = Join-Path $Backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    $py = Resolve-Python
    Write-Host "Creating virtualenv with: $py"
    & $py -m venv .venv
    & $venvPython -m pip install --upgrade pip
    & $venvPython -m pip install -r requirements.txt
} else {
    $v = & $venvPython -c "import sys; print(sys.version.split()[0])"
    Write-Host "Using existing venv Python $v"
}

$dataDir = Join-Path $Root "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

Write-Host "API: http://127.0.0.1:8765  docs: http://127.0.0.1:8765/docs"
& $venvPython -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
