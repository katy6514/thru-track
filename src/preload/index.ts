import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Trip } from '../shared/types'

// Custom APIs for renderer
const api = {
  pingDb: (): Promise<{ dbPath: string; sqliteVersion: string }> => ipcRenderer.invoke('db:ping'),
  trips: {
    create: (name: string): Promise<Trip> => ipcRenderer.invoke('trips:create', name),
    list: (): Promise<Trip[]> => ipcRenderer.invoke('trips:list'),
    rename: (id: number, name: string): Promise<Trip> =>
      ipcRenderer.invoke('trips:rename', id, name),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('trips:delete', id)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
