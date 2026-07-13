import { ElectronAPI } from '@electron-toolkit/preload'

interface Api {
  pingDb: () => Promise<{ dbPath: string; sqliteVersion: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
