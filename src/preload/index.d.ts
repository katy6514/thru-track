import { ElectronAPI } from '@electron-toolkit/preload'
import type { Trip, Track, TrackPoint, Entry, GpxImportNeedsDate, JournalNote } from '../shared/types'

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
  }
  entries: {
    get: (trackId: number) => Promise<Entry | null>
    save: (trackId: number, text: string) => Promise<Entry>
  }
  notes: {
    create: (trackId: number, content: string, timestamp: string | null) => Promise<JournalNote>
    list: (trackId: number) => Promise<JournalNote[]>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
