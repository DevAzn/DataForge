# Build DataForge desktop package and publish to GitHub Releases.
# Prerequisites: Windows, scripts/build-exe.ps1 deps, GitHub CLI (gh) authenticated.
# Usage (repo root):
#   .\scripts\publish-desktop-release.ps1 -Version 0.6.2
#   .\scripts\publish-desktop-release.ps1 -Version 0.6.2 -SkipBuild

param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$Version = $Version.TrimStart("v")
$tag = "v$Version"
$zipVer = Join-Path $Root "dist\DataForge-v$Version-windows-x64.zip"
$zipLatest = Join-Path $Root "dist\DataForge-windows-x64.zip"
$notes = Join-Path $Root "dist\release-notes-v$Version.md"

if (-not $SkipBuild) {
    Write-Host "==> Building exe" -ForegroundColor Cyan
    & (Join-Path $Root "scripts\build-exe.ps1")
}

$exeDir = Join-Path $Root "dist\DataForge"
if (-not (Test-Path (Join-Path $exeDir "DataForge.exe"))) {
    throw "Missing dist\DataForge\DataForge.exe — run build-exe.ps1 first"
}

# Do not ship local runtime DB
$dataDir = Join-Path $exeDir "data"
if (Test-Path $dataDir) {
    Remove-Item $dataDir -Recurse -Force
}

Write-Host "==> Zipping"
if (Test-Path $zipVer) { Remove-Item $zipVer -Force }
if (Test-Path $zipLatest) { Remove-Item $zipLatest -Force }
Compress-Archive -Path (Join-Path $exeDir "*") -DestinationPath $zipVer -Force
Copy-Item $zipVer $zipLatest -Force

if (-not (Test-Path $notes)) {
    @"
# DataForge $tag

Windows desktop package. Extract the whole folder and run DataForge.exe.
"@ | Set-Content $notes -Encoding utf8
}

Write-Host "==> Publishing $tag to GitHub Releases" -ForegroundColor Cyan
$exists = $false
gh release view $tag 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $exists = $true }

if ($exists) {
    gh release upload $tag $zipVer $zipLatest $notes --clobber
} else {
    gh release create $tag $zipVer $zipLatest $notes `
        --title "DataForge $tag" `
        --notes-file $notes `
        --target main
}

Write-Host "Published: https://github.com/DevAzn/DataForge/releases/tag/$tag" -ForegroundColor Green
Write-Host "Do not commit the zip into git — Releases is the distribution channel."
