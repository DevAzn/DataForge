/**
 * Ensures the Electron binary is fully installed.
 * npm's extract-zip step can leave a partial dist/ on some Windows setups.
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const electronRoot = path.dirname(require.resolve('electron/package.json'))
const { version } = require(path.join(electronRoot, 'package.json'))
const distPath = path.join(electronRoot, 'dist')
const pathTxt = path.join(electronRoot, 'path.txt')

function platformBinary() {
  switch (os.platform()) {
    case 'win32':
      return 'electron.exe'
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    default:
      return 'electron'
  }
}

function isReady() {
  const binary = platformBinary()
  try {
    if (!fs.existsSync(path.join(distPath, binary))) return false
    if (!fs.existsSync(pathTxt)) return false
    if (fs.readFileSync(pathTxt, 'utf8').trim() !== binary) return false
    return true
  } catch {
    return false
  }
}

if (isReady()) {
  process.exit(0)
}

console.log(`[ensure-electron] Electron ${version} binary missing or incomplete — repairing...`)

// Prefer official installer; if it leaves a partial tree, force extract via PowerShell on Windows.
try {
  execFileSync(process.execPath, [path.join(electronRoot, 'install.js')], {
    stdio: 'inherit',
    env: process.env
  })
} catch {
  // continue to fallback
}

if (isReady()) {
  console.log('[ensure-electron] OK via electron/install.js')
  process.exit(0)
}

if (process.platform !== 'win32') {
  console.error('[ensure-electron] Failed to install Electron binary. Try: rm -rf node_modules/electron && npm install electron')
  process.exit(1)
}

// Windows fallback: download artifact (uses cache) + .NET ZipFile extract
const { downloadArtifact } = require('@electron/get')

;(async () => {
  try {
    const zipPath = await downloadArtifact({
      version,
      artifactName: 'electron',
      platform: 'win32',
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      checksums: require(path.join(electronRoot, 'checksums.json'))
    })

    if (fs.existsSync(distPath)) {
      fs.rmSync(distPath, { recursive: true, force: true })
    }
    fs.mkdirSync(distPath, { recursive: true })

    const ps = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${distPath.replace(/'/g, "''")}')
    `
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' })
    fs.writeFileSync(pathTxt, 'electron.exe')

    if (!isReady()) {
      throw new Error('electron.exe still missing after extract')
    }
    console.log('[ensure-electron] OK via Windows ZipFile fallback')
  } catch (err) {
    console.error('[ensure-electron] Repair failed:', err)
    process.exit(1)
  }
})()
