# Collapse junction DataForge-app -> real folder PV_DataForge when locks allow.
# Safe if PV_DataForge is already a real directory.

$ErrorActionPreference = "Stop"
$Sandbox = "C:\Users\terro\Projects\Sandbox"
$Pv = Join-Path $Sandbox "PV_DataForge"
$App = Join-Path $Sandbox "DataForge-app"

if (-not (Test-Path $Pv)) {
  if (Test-Path $App) {
    Rename-Item $App "PV_DataForge"
    Write-Host "Renamed DataForge-app -> PV_DataForge"
    exit 0
  }
  Write-Host "Neither PV_DataForge nor DataForge-app found."
  exit 1
}

$item = Get-Item $Pv
if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
  Write-Host "PV_DataForge is a junction -> $($item.Target)"
  if (-not (Test-Path $App)) {
    Write-Host "Target DataForge-app missing; nothing to collapse."
    exit 1
  }
  # Remove junction only (not target contents)
  cmd /c "rmdir `"$Pv`""
  Rename-Item $App "PV_DataForge"
  Write-Host "SUCCESS: PV_DataForge is now a real directory."
} else {
  Write-Host "PV_DataForge is already a real directory."
  if ((Test-Path $App) -and ((Resolve-Path $App).Path -ne (Resolve-Path $Pv).Path)) {
    Write-Host "Note: DataForge-app still exists separately — remove manually if duplicate."
  }
}
