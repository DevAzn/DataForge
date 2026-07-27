# Remove non-product DataForge* folders (Electron leftovers) under Sandbox.
# Never deletes a tree that contains backend\app\main.py (the product).

$ErrorActionPreference = "Continue"
$Sandbox = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $Sandbox "PV_DataForge"))) {
  $Sandbox = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
}

Write-Host "Sandbox: $Sandbox"
Get-ChildItem $Sandbox -Directory -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -eq "DataForge" -or
    ($_.Name -like "DataForge-*" -and $_.Name -ne "DataForge-app")
  } |
  ForEach-Object {
    $main = Join-Path $_.FullName "backend\app\main.py"
    if (Test-Path $main) {
      Write-Host "SKIP product tree: $($_.Name)"
      return
    }
    Write-Host "Removing non-product: $($_.FullName)"
    cmd /c "rmdir /s /q `"$($_.FullName)`"" 2>$null
    if (Test-Path $_.FullName) {
      Write-Host "  LOCKED — close VS Code handles and re-run."
    } else {
      Write-Host "  removed."
    }
  }
