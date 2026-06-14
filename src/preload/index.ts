import { contextBridge, ipcRenderer } from 'electron'

export type CatColor = 'ginger' | 'grey' | 'white'
export interface PetConfig {
  color: CatColor
}

const api = {
  /** Clicks pass through (true) or the pet captures them (false). */
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },

  /** Read the persisted config (color, …). */
  getConfig(): Promise<PetConfig> {
    return ipcRenderer.invoke('config:get')
  },

  /** Persist + broadcast a new colorway. */
  setColor(color: CatColor): void {
    ipcRenderer.send('config:set-color', color)
  },

  /** Subscribe to colorway changes broadcast from the main process. */
  onColorChange(cb: (color: CatColor) => void): () => void {
    const listener = (_e: unknown, color: CatColor): void => cb(color)
    ipcRenderer.on('config:color', listener)
    return () => ipcRenderer.removeListener('config:color', listener)
  }
}

contextBridge.exposeInMainWorld('petApi', api)

export type PetApi = typeof api
