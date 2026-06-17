import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getConfig } from './config-store'
import { MAIN_STR } from './tray'

let overlay: BrowserWindow | null = null
let settings: BrowserWindow | null = null

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

export function getOverlayWindow(): BrowserWindow | null {
  return overlay
}

export function getSettingsWindow(): BrowserWindow | null {
  return settings
}

export function createOverlay(): void {
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

  if (process.platform === 'darwin') {
    // macOS-only: highest float level + show on every Space / full-screen app
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    overlay.setAlwaysOnTop(true)
  }
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

export function openSettings(): void {
  if (settings) {
    settings.show()
    settings.focus()
    return
  }

  settings = new BrowserWindow({
    width: 360,
    height: 810,
    resizable: false,
    title: MAIN_STR[getConfig().lang].title,
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
