import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Trip,
  Track,
  TrackPoint,
  Entry,
  GpxImportNeedsDate,
  JournalNote,
  Photo,
  PendingPhoto,
  PhotoImportNeedsOffset,
  Message
} from '../shared/types'

interface Api {
  pingDb: () => Promise<{ dbPath: string; sqliteVersion: string }>
  trips: {
    create: (name: string) => Promise<Trip>
    list: () => Promise<Trip[]>
    rename: (id: number, name: string) => Promise<Trip>
    delete: (id: number) => Promise<void>
  }
  tracks: {
    list: (tripId: number) => Promise<Track[]>
    importGpx: (tripId: number) => Promise<Track | GpxImportNeedsDate | null>
    importGpxWithDate: (tripId: number, gpxRaw: string, date: string) => Promise<Track>
    getPoints: (trackId: number) => Promise<TrackPoint[]>
    delete: (trackId: number) => Promise<void>
  }
  entries: {
    get: (trackId: number) => Promise<Entry | null>
    save: (trackId: number, text: string) => Promise<Entry>
  }
  notes: {
    create: (trackId: number, content: string, timestamp: string | null) => Promise<JournalNote>
    list: (trackId: number) => Promise<JournalNote[]>
  }
  photos: {
    list: (trackId: number) => Promise<Photo[]>
    import: (trackId: number) => Promise<Photo[] | PhotoImportNeedsOffset>
    importWithOffset: (
      trackId: number,
      pending: PendingPhoto[],
      offsetMinutes: number
    ) => Promise<Photo[]>
    getDataUri: (photoId: number) => Promise<string>
  }
  messages: {
    importCsv: (trackId: number) => Promise<Message[] | null>
    list: (trackId: number) => Promise<Message[]>
  }
  photoUpload: {
    start: (trackId: number) => Promise<{ url: string; qrDataUri: string }>
    stop: () => Promise<void>
    onBatchReceived: (callback: (result: Photo[] | PhotoImportNeedsOffset) => void) => () => void
    onBatchError: (callback: (message: string) => void) => () => void
  }
  gpxUpload: {
    start: (tripId: number) => Promise<{ url: string; qrDataUri: string }>
    stop: () => Promise<void>
    onReceived: (callback: (result: Track | GpxImportNeedsDate) => void) => () => void
    onError: (callback: (message: string) => void) => () => void
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
