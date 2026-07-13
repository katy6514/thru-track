import { ElectronAPI } from '@electron-toolkit/preload'
import type { Trip, Track } from '../shared/types'

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
    importGpx: (tripId: number) => Promise<Track | null>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
