import { app, BrowserWindow } from 'electron'
import { loadConfig } from './config-store'
import { createOverlay } from './windows'
import { createTray } from './tray'
import { registerIpc } from './ipc'

app.whenReady().then(() => {
  loadConfig()
  createOverlay()
  createTray()
  registerIpc()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlay()
  })
})

// Keep running in the tray even when all windows are closed.
app.on('window-all-closed', () => {
  // no-op: the tray keeps the app alive; quit only via the tray menu
})
