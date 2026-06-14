import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'

let overlay: BrowserWindow | null = null

function createOverlay(): void {
  const primary = screen.getPrimaryDisplay()
  // workArea excludes the Dock and menu bar, so the pet stands on top of the
  // Dock instead of being hidden behind it.
  const { x, y, width, height } = primary.workArea

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
    // The overlay should never grab focus or show window chrome; it is purely visual.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Sit above normal windows (including most full-screen apps) and on every Space.
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Start fully click-through; `forward: true` keeps delivering mousemove so the
  // renderer can detect when the pointer is over the pet and request capture.
  overlay.setIgnoreMouseEvents(true, { forward: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    overlay.loadFile(join(__dirname, '../renderer/index.html'))
  }

  overlay.on('closed', () => {
    overlay = null
  })
}

// Renderer toggles click capture: false = capture clicks (pointer over pet),
// true = pass clicks through to whatever is underneath.
ipcMain.on('set-ignore-mouse', (_event, ignore: boolean) => {
  if (!overlay) return
  overlay.setIgnoreMouseEvents(ignore, { forward: true })
})

app.whenReady().then(() => {
  createOverlay()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
