import { contextBridge, ipcRenderer } from 'electron'
import type { PetConfig } from '../shared/config'

const api = {
  /** Clicks pass through (true) or the pet captures them (false). */
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },

  /** Read the persisted config. */
  getConfig(): Promise<PetConfig> {
    return ipcRenderer.invoke('config:get')
  },

  /** Merge + persist + broadcast a config change. */
  setConfig(partial: Partial<PetConfig>): void {
    ipcRenderer.send('config:set', partial)
  },

  /** Subscribe to config changes broadcast from the main process. */
  onConfigChange(cb: (config: PetConfig) => void): () => void {
    const listener = (_e: unknown, config: PetConfig): void => cb(config)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },

  /** Command: put every cat to sleep right now. */
  sleepAll(): void {
    ipcRenderer.send('cmd:sleep-all')
  },

  /** Command: wake every sleeping cat right now. */
  wakeAll(): void {
    ipcRenderer.send('cmd:wake-all')
  },

  /** Subscribe to the "sleep all" command (overlay side). */
  onSleepAll(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on('cmd:sleep-all', listener)
    return () => ipcRenderer.removeListener('cmd:sleep-all', listener)
  },

  /** Subscribe to the "wake all" command (overlay side). */
  onWakeAll(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on('cmd:wake-all', listener)
    return () => ipcRenderer.removeListener('cmd:wake-all', listener)
  }
}

contextBridge.exposeInMainWorld('petApi', api)

export type PetApi = typeof api
