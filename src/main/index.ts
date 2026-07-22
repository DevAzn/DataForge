import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { flushUserCache, initDatabase } from './db/database'
import { registerIpcHandlers } from './ipc'
import { seedSampleTemplatesIfEmpty } from './services/sampleTemplates'

app.on('before-quit', () => {
  try {
    flushUserCache()
  } catch {
    /* ignore */
  }
})

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.cwd(), 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

function createWindow(): void {
  const icon = resolveAppIcon()
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'DataForge',
    backgroundColor: '#0f1419',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // better-sqlite3 / native tooling runs in main; keep sandbox off so
      // electron-vite preload + IPC stay reliable on Windows packages.
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })
  // Failsafe: never leave a hidden window if ready-to-show is delayed
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  }, 2500)

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[DataForge] renderer failed to load', code, desc)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[DataForge] renderer crashed', details)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const u = new URL(details.url)
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        void shell.openExternal(details.url)
      }
    } catch {
      /* ignore invalid URLs */
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDatabase()
  seedSampleTemplatesIfEmpty()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})



app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
