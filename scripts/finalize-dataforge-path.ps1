# Collapse DataForge-app + junctions into a single real folder named DataForge.
# Run after closing VS Code / explorers that lock the tree.

$ErrorActionPreference = "Stop"
$Sandbox = "C:\Users\terro\Projects\Sandbox"
$Df = Join-Path $Sandbox "DataForge"
$App = Join-Path $Sandbox "DataForge-app"
$Pv = Join-Path $Sandbox "PV_DataForge"

function Remove-Junction([string]$Path) {
  if (-not (Test-Path $Path)) { return }
  $i = Get-Item $Path -Force
  if ($i.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    cmd /c "rmdir `"$Path`""
    Write-Host "Removed junction: $Path"
  }
}

# Prefer real product content location
$real = $null
if ((Test-Path $App) -and (Test-Path (Join-Path $App "backend\app\main.py"))) {
  $real = $App
} elseif ((Test-Path $Df) -and -not ((Get-Item $Df).Attributes -band [IO.FileAttributes]::ReparsePoint) -and (Test-Path (Join-Path $Df "backend\app\main.py"))) {
  Write-Host "DataForge is already a real product directory."
  Remove-Junction $Pv
  if ((Test-Path $App) -and ((Resolve-Path $App).Path -ne (Resolve-Path $Df).Path)) {
    Write-Host "Note: DataForge-app still exists — remove manually if duplicate."
  }
  exit 0
} elseif ((Test-Path $Df) -and (Test-Path (Join-Path $Df "backend\app\main.py"))) {
  # DataForge is junction to app — collapse
  $target = (Get-Item $Df).Target
  if ($target) { $real = "$target".Trim('{','}') }
  if (-not $real -or -not (Test-Path $real)) { $real = $App }
}

if (-not $real -or -not (Test-Path (Join-Path $real "backend\app\main.py"))) {
  Write-Host "Could not locate product tree."
  exit 1
}

Remove-Junction $Pv
Remove-Junction $Df

if ($real -ne $Df) {
  if (Test-Path $Df) { throw "DataForge still exists after junction removal" }
  Rename-Item $real "DataForge"
  Write-Host "Renamed to DataForge"
}

# Optional alias for old name
if (-not (Test-Path $Pv)) {
  cmd /c "mklink /J `"$Pv`" `"$Df`""
  Write-Host "Optional alias: PV_DataForge -> DataForge"
}

Write-Host "SUCCESS: primary path is $Df"
Write-Host "cd $Df"
