import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { getDb, pingDb } from './db'
import { Repository } from './repository'
import type { Track, TrackPoint } from '../shared/types'

export function registerIpcHandlers(): void {
  const repository = new Repository(getDb())

  ipcMain.handle('db:ping', () => pingDb())

  ipcMain.handle('trips:create', (_event, name: string) => repository.createTrip(name))
  ipcMain.handle('trips:list', () => repository.listTrips())
  ipcMain.handle('trips:rename', (_event, id: number, name: string) =>
    repository.renameTrip(id, name)
  )
  ipcMain.handle('trips:delete', (_event, id: number) => repository.deleteTrip(id))

  ipcMain.handle('tracks:list', (_event, tripId: number) => repository.listTracksForTrip(tripId))

  ipcMain.handle('tracks:importGpx', async (event, tripId: number): Promise<Track | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found for the requesting renderer')
    const result = await dialog.showOpenDialog(window, {
      title: 'Import GPX track',
      properties: ['openFile'],
      filters: [{ name: 'GPX files', extensions: ['gpx'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const gpxRaw = await readFile(result.filePaths[0], 'utf-8')
    return repository.importGpxTrack(tripId, gpxRaw)
  })

  ipcMain.handle('tracks:getPoints', (_event, trackId: number): TrackPoint[] =>
    repository.getTrackPoints(trackId)
  )

  ipcMain.handle('entries:get', (_event, trackId: number) => repository.getEntry(trackId))
  ipcMain.handle('entries:save', (_event, trackId: number, text: string) =>
    repository.saveEntry(trackId, text)
  )
}
