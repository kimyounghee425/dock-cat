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

// 모든 창이 닫혀도 트레이에서 계속 실행.
app.on('window-all-closed', () => {
  // no-op: 트레이가 앱을 살려둔다; 종료는 트레이 메뉴로만
})
