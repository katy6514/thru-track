import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  Trip,
  Track,
  TrackPoint,
  Entry,
  GpxImportNeedsDate,
  GpxImportNeedsStartDate,
  Photo,
  PendingPhoto,
  PhotoImportNeedsOffset,
  PhotoImportResult,
  Message
} from '../shared/types'

// Custom APIs for renderer
const api = {
  pingDb: (): Promise<{ dbPath: string; sqliteVersion: string }> => ipcRenderer.invoke('db:ping'),
  trips: {
    create: (name: string): Promise<Trip> => ipcRenderer.invoke('trips:create', name),
    list: (): Promise<Trip[]> => ipcRenderer.invoke('trips:list'),
    listArchived: (): Promise<Trip[]> => ipcRenderer.invoke('trips:listArchived'),
    rename: (id: number, name: string): Promise<Trip> =>
      ipcRenderer.invoke('trips:rename', id, name),
    archive: (id: number): Promise<Trip> => ipcRenderer.invoke('trips:archive', id),
    unarchive: (id: number): Promise<Trip> => ipcRenderer.invoke('trips:unarchive', id),
    delete: (id: number): Promise<void> => ipcRenderer.invoke('trips:delete', id)
  },
  tracks: {
    list: (tripId: number): Promise<Track[]> => ipcRenderer.invoke('tracks:list', tripId),
    importGpx: (
      tripId: number
    ): Promise<Track[] | GpxImportNeedsDate | GpxImportNeedsStartDate | null> =>
      ipcRenderer.invoke('tracks:importGpx', tripId),
    importGpxWithDate: (tripId: number, gpxRaw: string, date: string): Promise<Track[]> =>
      ipcRenderer.invoke('tracks:importGpxWithDate', tripId, gpxRaw, date),
    importGpxWithStartDate: (tripId: number, gpxRaw: string, startDate: string): Promise<Track[]> =>
      ipcRenderer.invoke('tracks:importGpxWithStartDate', tripId, gpxRaw, startDate),
    getPoints: (trackId: number): Promise<TrackPoint[]> =>
      ipcRenderer.invoke('tracks:getPoints', trackId),
    update: (
      id: number,
      updates: { name?: string; startLocation?: string; endLocation?: string }
    ): Promise<Track> => ipcRenderer.invoke('tracks:update', id, updates),
    delete: (trackId: number): Promise<void> => ipcRenderer.invoke('tracks:delete', trackId)
  },
  entries: {
    get: (trackId: number): Promise<Entry | null> => ipcRenderer.invoke('entries:get', trackId),
    save: (trackId: number, text: string): Promise<Entry> =>
      ipcRenderer.invoke('entries:save', trackId, text)
  },
  photos: {
    list: (trackId: number): Promise<Photo[]> => ipcRenderer.invoke('photos:list', trackId),
    import: (trackId: number): Promise<PhotoImportResult | PhotoImportNeedsOffset> =>
      ipcRenderer.invoke('photos:import', trackId),
    importWithOffset: (
      trackId: number,
      pending: PendingPhoto[],
      offsetMinutes: number
    ): Promise<PhotoImportResult> =>
      ipcRenderer.invoke('photos:importWithOffset', trackId, pending, offsetMinutes),
    getDataUri: (photoId: number): Promise<string> =>
      ipcRenderer.invoke('photos:getDataUri', photoId),
    updateCaption: (photoId: number, caption: string): Promise<Photo> =>
      ipcRenderer.invoke('photos:updateCaption', photoId, caption)
  },
  messages: {
    importCsv: (trackId: number): Promise<Message[] | null> =>
      ipcRenderer.invoke('messages:importCsv', trackId),
    list: (trackId: number): Promise<Message[]> => ipcRenderer.invoke('messages:list', trackId)
  },
  photoUpload: {
    start: (trackId: number): Promise<{ url: string; qrDataUri: string }> =>
      ipcRenderer.invoke('photoUpload:start', trackId),
    stop: (): Promise<void> => ipcRenderer.invoke('photoUpload:stop'),
    onBatchReceived: (
      callback: (result: PhotoImportResult | PhotoImportNeedsOffset) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        result: PhotoImportResult | PhotoImportNeedsOffset
      ): void => callback(result)
      ipcRenderer.on('photoUpload:batchReceived', listener)
      return () => ipcRenderer.removeListener('photoUpload:batchReceived', listener)
    },
    onBatchError: (callback: (message: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, message: string): void => callback(message)
      ipcRenderer.on('photoUpload:batchError', listener)
      return () => ipcRenderer.removeListener('photoUpload:batchError', listener)
    }
  },
  gpxUpload: {
    start: (tripId: number): Promise<{ url: string; qrDataUri: string }> =>
      ipcRenderer.invoke('gpxUpload:start', tripId),
    stop: (): Promise<void> => ipcRenderer.invoke('gpxUpload:stop'),
    onReceived: (
      callback: (result: Track[] | GpxImportNeedsDate | GpxImportNeedsStartDate) => void
    ): (() => void) => {
      const listener = (
        _event: IpcRendererEvent,
        result: Track[] | GpxImportNeedsDate | GpxImportNeedsStartDate
      ): void => callback(result)
      ipcRenderer.on('gpxUpload:received', listener)
      return () => ipcRenderer.removeListener('gpxUpload:received', listener)
    },
    onError: (callback: (message: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, message: string): void => callback(message)
      ipcRenderer.on('gpxUpload:error', listener)
      return () => ipcRenderer.removeListener('gpxUpload:error', listener)
    }
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
