import { contextBridge, ipcRenderer } from 'electron'

export type CatColor = 'ginger' | 'grey' | 'white'
export interface PetConfig {
  color: CatColor
  sleepAfterMin: number | null
}

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
  }
}

contextBridge.exposeInMainWorld('petApi', api)

export type PetApi = typeof api
