import { contextBridge, ipcRenderer } from 'electron'
import type { PetConfig } from '../shared/config'

const api = {
  // true = 클릭 통과, false = 펫이 캡처.
  setIgnoreMouseEvents(ignore: boolean): void {
    ipcRenderer.send('set-ignore-mouse', ignore)
  },

  getConfig(): Promise<PetConfig> {
    return ipcRenderer.invoke('config:get')
  },

  // config 변경을 merge + 영속 + broadcast.
  setConfig(partial: Partial<PetConfig>): void {
    ipcRenderer.send('config:set', partial)
  },

  // main 프로세스가 broadcast하는 config 변경 구독.
  onConfigChange(cb: (config: PetConfig) => void): () => void {
    const listener = (_e: unknown, config: PetConfig): void => cb(config)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },

  sleepAll(): void {
    ipcRenderer.send('cmd:sleep-all')
  },

  wakeAll(): void {
    ipcRenderer.send('cmd:wake-all')
  },

  // "모두 재우기" 명령 구독(overlay 쪽).
  onSleepAll(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on('cmd:sleep-all', listener)
    return () => ipcRenderer.removeListener('cmd:sleep-all', listener)
  },

  // "모두 깨우기" 명령 구독(overlay 쪽).
  onWakeAll(cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on('cmd:wake-all', listener)
    return () => ipcRenderer.removeListener('cmd:wake-all', listener)
  }
}

contextBridge.exposeInMainWorld('petApi', api)

export type PetApi = typeof api
