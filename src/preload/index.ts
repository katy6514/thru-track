import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Trip,
  Track,
  TrackPoint,
  Entry,
  GpxImportNeedsDate,
  JournalNote,
  Photo,
  Message
} from '../shared/types'

// Custom APIs for renderer
const api = {
  pingDb: (): Promise<{ dbPath: string; sqliteVersion: string }> => ipcRenderer.invoke('db:ping'),
  trips: {
    create: (name: string): Promise<Trip> => ipcRenderer.invoke('trips:create', name),
    list: (): Promise<Trip[]> => ipcRenderer.invoke('trips:list'),
    rename: (id: number, name: string): Promise<Trip> =>
      ipcRenderer.invoke('trips:rename', id, name),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('trips:delete', id)
  },
  tracks: {
    list: (tripId: number): Promise<Track[]> => ipcRenderer.invoke('tracks:list', tripId),
    importGpx: (tripId: number): Promise<Track | GpxImportNeedsDate | null> =>
      ipcRenderer.invoke('tracks:importGpx', tripId),
    importGpxWithDate: (tripId: number, gpxRaw: string, date: string): Promise<Track> =>
      ipcRenderer.invoke('tracks:importGpxWithDate', tripId, gpxRaw, date),
    getPoints: (trackId: number): Promise<TrackPoint[]> =>
      ipcRenderer.invoke('tracks:getPoints', trackId),
    delete: (trackId: number): Promise<void> => ipcRenderer.invoke('tracks:delete', trackId)
  },
  entries: {
    get: (trackId: number): Promise<Entry | null> => ipcRenderer.invoke('entries:get', trackId),
    save: (trackId: number, text: string): Promise<Entry> =>
      ipcRenderer.invoke('entries:save', trackId, text)
  },
  notes: {
    create: (trackId: number, content: string, timestamp: string | null): Promise<JournalNote> =>
      ipcRenderer.invoke('notes:create', trackId, content, timestamp),
    list: (trackId: number): Promise<JournalNote[]> => ipcRenderer.invoke('notes:list', trackId)
  },
  photos: {
    list: (trackId: number): Promise<Photo[]> => ipcRenderer.invoke('photos:list', trackId),
    import: (trackId: number): Promise<Photo[]> => ipcRenderer.invoke('photos:import', trackId),
    getDataUri: (photoId: number): Promise<string> =>
      ipcRenderer.invoke('photos:getDataUri', photoId)
  },
  messages: {
    importCsv: (trackId: number): Promise<Message[] | null> =>
      ipcRenderer.invoke('messages:importCsv', trackId),
    list: (trackId: number): Promise<Message[]> => ipcRenderer.invoke('messages:list', trackId)
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
