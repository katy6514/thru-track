import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { basename } from 'path'
import { getDb, pingDb } from './db'
import { Repository, DateRequiredError } from './repository'
import type { Track, TrackPoint, GpxImportNeedsDate } from '../shared/types'

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

  ipcMain.handle(
    'tracks:importGpx',
    async (event, tripId: number): Promise<Track | GpxImportNeedsDate | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window found for the requesting renderer')
      const result = await dialog.showOpenDialog(window, {
        title: 'Import GPX track',
        properties: ['openFile'],
        filters: [{ name: 'GPX files', extensions: ['gpx'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const filePath = result.filePaths[0]
      const gpxRaw = await readFile(filePath, 'utf-8')
      try {
        return repository.importGpxTrack(tripId, gpxRaw, { filename: basename(filePath) })
      } catch (err) {
        // A timeless track whose filename doesn't encode a usable date — hand the parsed GPX
        // back to the renderer so it can prompt for a date and resubmit via importGpxWithDate,
        // rather than creating a track with a guessed-wrong date or failing the import outright.
        if (err instanceof DateRequiredError) {
          return { needsDate: true, gpxRaw }
        }
        throw err
      }
    }
  )

  ipcMain.handle(
    'tracks:importGpxWithDate',
    (_event, tripId: number, gpxRaw: string, date: string): Track =>
      repository.importGpxTrack(tripId, gpxRaw, { date })
  )

  ipcMain.handle('tracks:getPoints', (_event, trackId: number): TrackPoint[] =>
    repository.getTrackPoints(trackId)
  )

  ipcMain.handle('entries:get', (_event, trackId: number) => repository.getEntry(trackId))
  ipcMain.handle('entries:save', (_event, trackId: number, text: string) =>
    repository.saveEntry(trackId, text)
  )
}
