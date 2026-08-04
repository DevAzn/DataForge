# Build DataForge.exe (Windows) - API + packaged Vue UI in one process.
# Prerequisites: Python 3.12+ venv with backend deps; Node for frontend build.
# Usage (from repo root):
#   .\scripts\build-exe.ps1
# Output:
#   dist\DataForge\DataForge.exe   (onedir - recommended)
#   or dist\DataForge.exe          if -OneFile

param(
    [switch]$OneFile,
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Write-Host "==> DataForge Windows exe build" -ForegroundColor Cyan
Write-Host "    Root: $Root"

$py = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Creating backend\.venv ..."
    python -m venv (Join-Path $Root "backend\.venv")
    $py = Join-Path $Root "backend\.venv\Scripts\python.exe"
}

Write-Host "==> Installing backend + PyInstaller"
& $py -m pip install -q -r (Join-Path $Root "backend\requirements.txt")
& $py -m pip install -q "pyinstaller>=6.0"

if (-not $SkipFrontendBuild) {
    Write-Host "==> Building frontend (vite)"
    Push-Location (Join-Path $Root "frontend")
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "vite build failed" }
    Pop-Location
}

$distIndex = Join-Path $Root "frontend\dist\index.html"
if (-not (Test-Path $distIndex)) {
    throw "frontend/dist/index.html missing - run npm run build in frontend/"
}

$entry = Join-Path $Root "backend\desktop_main.py"
$work = Join-Path $Root "build\pyinstaller"
$out = Join-Path $Root "dist"
New-Item -ItemType Directory -Force -Path $work | Out-Null
New-Item -ItemType Directory -Force -Path $out | Out-Null

# Windows --add-data uses semicolon; use absolute source so workpath does not break it
$uiSrc = Join-Path $Root "frontend\dist"
$uiData = "$uiSrc;frontend\dist"

$piArgs = @(
    "--noconfirm",
    "--clean",
    "--name", "DataForge",
    "--distpath", $out,
    "--workpath", $work,
    "--specpath", $work,
    "--paths", (Join-Path $Root "backend"),
    "--add-data", $uiData,
    "--collect-all", "uvicorn",
    "--collect-all", "fastapi",
    "--collect-all", "starlette",
    "--collect-all", "anyio",
    "--hidden-import", "app.main",
    "--hidden-import", "app.database",
    "--hidden-import", "app.defaults",
    "--hidden-import", "app.runtime_paths",
    "--hidden-import", "app.services.generator",
    "--hidden-import", "app.services.export_fmt",
    "--hidden-import", "app.services.infer",
    "--hidden-import", "app.services.package_svc",
    "--hidden-import", "app.services.delivery_svc",
    "--hidden-import", "app.services.archive_svc",
    "--hidden-import", "app.services.file_naming",
    "--hidden-import", "app.services.patterns",
    "--hidden-import", "multipart",
    "--hidden-import", "yaml",
    "--hidden-import", "pydantic",
    "--console"
)

if ($OneFile) {
    $piArgs += "--onefile"
} else {
    $piArgs += "--onedir"
}

$ico = Join-Path $Root "frontend\public\favicon.ico"
if (Test-Path $ico) {
    $piArgs += @("--icon", $ico)
}

Write-Host "==> PyInstaller"
# PyInstaller writes progress to stderr; do not treat that as a terminating error
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $py -m PyInstaller @piArgs $entry
$piExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($piExit -ne 0) { throw "PyInstaller failed (exit $piExit)" }

if ($OneFile) {
    $exe = Join-Path $out "DataForge.exe"
} else {
    $exe = Join-Path $out "DataForge\DataForge.exe"
}

if (-not (Test-Path $exe)) {
    throw "Expected exe not found: $exe"
}

Write-Host ""
Write-Host "Built: $exe" -ForegroundColor Green
Write-Host "Double-click to start. Browser opens http://127.0.0.1:8765/"
Write-Host "SQLite data is stored next to the exe in a data folder."
Write-Host ""
