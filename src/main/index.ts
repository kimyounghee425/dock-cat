import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

type CatColor = 'ginger' | 'grey' | 'white'
interface PetConfig {
  color: CatColor
  sleepAfterMin: number | null
}

let overlay: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let tray: Tray | null = null

const configPath = (): string => join(app.getPath('userData'), 'config.json')
let config: PetConfig = { color: 'ginger', sleepAfterMin: 5 }

function loadConfig(): void {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf-8'))
    if (parsed && typeof parsed.color === 'string') config.color = parsed.color
    if (parsed && (parsed.sleepAfterMin === null || typeof parsed.sleepAfterMin === 'number')) {
      config.sleepAfterMin = parsed.sleepAfterMin
    }
  } catch {
    // first run / missing file → keep defaults
  }
}

function saveConfig(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config))
  } catch {
    // non-fatal: settings just won't persist this session
  }
}

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

function createOverlay(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea

  overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setIgnoreMouseEvents(true, { forward: true })

  if (rendererUrl) {
    overlay.loadURL(rendererUrl)
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  overlay.on('closed', () => {
    overlay = null
  })
}

function openSettings(): void {
  if (settings) {
    settings.show()
    settings.focus()
    return
  }

  settings = new BrowserWindow({
    width: 340,
    height: 380,
    resizable: false,
    title: 'mac-pet 설정',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (rendererUrl) {
    settings.loadURL(`${rendererUrl}#settings`)
  } else {
    settings.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  }

  settings.on('closed', () => {
    settings = null
  })
}

// Monochrome cat-head template icon (auto-adapts to light/dark menu bar).
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAA1UlEQVR4nO2VSw7EMAhDIer9r+zZj9qG8CulebvREGxZFiXabL4Hntw3MkQ892gNP8YwJGJNGZpd1oS1pqEVbF8Jj7RASYbhYALWHQfVvc+nfLLDJQ0j2IdYp23CZRjU0DASfIj12iWMJB9iXY8vHUuESD5HkZXgye/VuSntOlyOYXz/30UY56Zw0Stx6e11lTiSkoHX8lnCmvPj0Ve++uN1lRiCGUvKULy91YtMOOTCSA2rP6WLTHVWEo42zZKh1UpEmeYMAx4d5fAHJ7hfgs1mQ3X4Aam9JjZc3lSmAAAAAElFTkSuQmCC'

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON)
  icon.setTemplateImage(true)
  tray = new Tray(icon.resize({ width: 22, height: 22 }))
  tray.setToolTip('mac-pet')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '설정…', click: openSettings },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() }
    ])
  )
}

// --- IPC ---
ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
  overlay?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.handle('config:get', () => config)

ipcMain.on('config:set', (_e, partial: Partial<PetConfig>) => {
  config = { ...config, ...partial }
  saveConfig()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('config:changed', config)
  }
})

app.whenReady().then(() => {
  loadConfig()
  createOverlay()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay()
  })
})

// Keep running in the tray even when all windows are closed.
app.on('window-all-closed', () => {
  // no-op: the tray keeps the app alive; quit only via the tray menu
})
