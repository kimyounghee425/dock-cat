import { app, BrowserWindow, ipcMain } from 'electron'
import { normalizePartialConfig, type PartialPetConfig } from '../shared/config'
import { getConfig, setConfig, saveConfig } from './config-store'
import { applyLang } from './tray'
import { getOverlayWindow } from './windows'

function applyLoginItem(): void {
  app.setLoginItemSettings({ openAtLogin: getConfig().launchAtLogin })
}

/** Wire every ipcMain handler. Call once after the app is ready. */
export function registerIpc(): void {
  ipcMain.on('set-ignore-mouse', (_e, ignore: boolean) => {
    getOverlayWindow()?.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.handle('config:get', () => getConfig())

  ipcMain.on('config:set', (_e, raw: unknown) => {
    const partial: PartialPetConfig = normalizePartialConfig(raw)
    const config = getConfig()
    setConfig({
      ...config,
      ...partial,
      counts: partial.counts ? { ...config.counts, ...partial.counts } : config.counts
    })
    saveConfig()
    if (partial.lang) applyLang()
    if (typeof partial.launchAtLogin === 'boolean') applyLoginItem()
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('config:changed', getConfig())
    }
  })

  ipcMain.on('cmd:sleep-all', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('cmd:sleep-all')
    }
  })

  ipcMain.on('cmd:wake-all', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('cmd:wake-all')
    }
  })
}
