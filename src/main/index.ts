import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'

type CatColor = 'ginger' | 'grey' | 'white'
type CatCounts = Record<CatColor, number>
type Lang = 'ko' | 'en'
interface PetConfig {
  counts: CatCounts
  sleepAfterMin: number | null
  noWake: boolean
  lang: Lang
}

const MAIN_STR: Record<Lang, { settings: string; quit: string; title: string }> = {
  ko: { settings: '설정…', quit: '종료', title: 'mac-pet 설정' },
  en: { settings: 'Settings…', quit: 'Quit', title: 'mac-pet Settings' }
}

let overlay: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let tray: Tray | null = null

const configPath = (): string => join(app.getPath('userData'), 'config.json')
let config: PetConfig = {
  counts: { ginger: 1, grey: 0, white: 0 },
  sleepAfterMin: 5,
  noWake: false,
  lang: 'ko'
}

const clampCount = (n: unknown): number =>
  typeof n === 'number' ? Math.max(0, Math.min(3, Math.round(n))) : 0

function loadConfig(): void {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), 'utf-8'))
    if (parsed?.counts) {
      config.counts = {
        ginger: clampCount(parsed.counts.ginger),
        grey: clampCount(parsed.counts.grey),
        white: clampCount(parsed.counts.white)
      }
    } else if (typeof parsed?.color === 'string') {
      // migrate old single-color config
      config.counts = { ginger: 0, grey: 0, white: 0 }
      config.counts[parsed.color as CatColor] = 1
    }
    if (parsed && (parsed.sleepAfterMin === null || typeof parsed.sleepAfterMin === 'number')) {
      config.sleepAfterMin = parsed.sleepAfterMin
    }
    if (typeof parsed?.noWake === 'boolean') config.noWake = parsed.noWake
    if (parsed?.lang === 'ko' || parsed?.lang === 'en') config.lang = parsed.lang
    else config.lang = app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en'
  } catch {
    // first run / missing file → default language to the system locale
    config.lang = app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en'
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
    width: 360,
    height: 560,
    resizable: false,
    title: MAIN_STR[config.lang].title,
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

// Cute pixel-cat tray icon (a sprite frame; colored, non-template).
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAACgUlEQVR4nO1YsWoCQRA9RbCzOOyTwiYHEiUfkB+wtfAX8gGSFCJikeAH5BdS2MbSws4mJCGwaVIkVSCIhV0gYJjj5hjW3bvZvcXcBR8srre7b9/Ozs7OnecdkAP4tfrWBYfvgIc10Xy23KZNmNY2ny1jnix6ypxOQghvencfFnlCXMhoMFGK9mv1LYwDDihZwRKcJ1Q4nao/7x4aB6zV7XViS4JlAUEQ7LQB0LrAsTfBKvfQQW4TDtzAyiXAQrZWqjqybiF9uMTpBCf95uoirH9XjkN/5UJE/nt5fRv+X29WrDl1SB2MIctEpAoi8uXhuJ9J9J+6hG9x+ymjhEwiW7fb63iL5wfvS3wqSaEdsCB9KAfy21h6RzCQUSJZPIo5Pz1ThjFsT+qzLqpLOBGMq9f5F7UW3nIU8rOp4pLJkrkpt4a6BTdKgCsk3YDCUZRgx2GaM8hCAVEeoRQthAiFAnTng7sI9kqR3DQmi0isLAj4Hp9e4v/tVpMlvHCHrmQ6wOTmExrrqizMtbSxS6gmSUO71dSKljnTBOfCJd5eP+I6iIeiC3tWUaJxcmQkRmiiBOWH6EJ5dbuSCwuboJxlC+lWym20HjDDoIov8zudTI6/sJ1JC+EibayxhWk2xpmoq+mvQ9r3i7JJ3FVtLQhCUUniRoNJWPby5SdPqLgisvn+4JP8BJEU/jILVomEZ5yo4CsyQM6ijQXDJGm5L6Kr6SfnIya5sjOXMME0WgQVys2J/9+hW29WpeG4H/ubDQTJJYDHxrJswVQ0TmgrFkDrNu92Vgm8Kn9FyPlyW5N12SJzLoEAUbAY+rxhkIZyUbhDV7IZlPR6LucKa4fucIC3B/wCTxqj23SDXUkAAAAASUVORK5CYII='

function refreshTrayMenu(): void {
  if (!tray) return
  const s = MAIN_STR[config.lang]
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: s.settings, click: openSettings },
      { type: 'separator' },
      { label: s.quit, click: () => app.quit() }
    ])
  )
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON)
  icon.setTemplateImage(false) // keep the cat's colors
  tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('mac-pet')
  refreshTrayMenu()
}

/** Apply the current language to the tray menu + settings window title. */
function applyLang(): void {
  refreshTrayMenu()
  settings?.setTitle(MAIN_STR[config.lang].title)
}

// --- IPC ---
ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
  overlay?.setIgnoreMouseEvents(ignore, { forward: true })
})

ipcMain.handle('config:get', () => config)

ipcMain.on('config:set', (_e, partial: Partial<PetConfig>) => {
  config = { ...config, ...partial }
  saveConfig()
  if (partial.lang) applyLang()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('config:changed', config)
  }
})

ipcMain.on('cmd:sleep-all', () => {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('cmd:sleep-all')
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
