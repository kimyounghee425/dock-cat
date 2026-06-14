import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /**
   * Toggle whether the overlay window swallows mouse events.
   * @param ignore true = clicks pass through to apps below; false = pet captures clicks.
   */
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse', ignore)
  }
}

contextBridge.exposeInMainWorld('petApi', api)

export type PetApi = typeof api
