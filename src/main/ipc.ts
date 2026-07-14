import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { getDb, pingDb } from './db'
import { Repository, DateRequiredError } from './repository'
import { extractExifData } from './exifExtractor'
import { storePhotoFile } from './fileStorageManager'
import { interpolatePosition } from '../shared/positionInterpolator'
import type { Track, TrackPoint, GpxImportNeedsDate, JournalNote, Photo } from '../shared/types'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
}

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

  ipcMain.handle(
    'notes:create',
    (_event, trackId: number, content: string, timestamp: string | null): JournalNote =>
      repository.createNote(trackId, content, timestamp)
  )
  ipcMain.handle('notes:list', (_event, trackId: number): JournalNote[] =>
    repository.listNotesForTrack(trackId)
  )

  ipcMain.handle('photos:list', (_event, trackId: number): Photo[] =>
    repository.listPhotosForTrack(trackId)
  )

  ipcMain.handle('photos:import', async (event, trackId: number): Promise<Photo[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('No window found for the requesting renderer')
    const result = await dialog.showOpenDialog(window, {
      title: 'Import photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return []

    // Fetched once up front rather than per-photo: every photo in this batch is imported
    // against the same track, so its points/timed-ness don't change mid-loop.
    const points = repository.getTrackPoints(trackId)
    const isTimed = points.length > 0 && points[0].timestamp !== null

    const imported: Photo[] = []
    for (const filePath of result.filePaths) {
      const buffer = await readFile(filePath)
      const exif = await extractExifData(buffer)

      let lat = exif.lat
      let lng = exif.lng
      // No EXIF GPS on this photo — fall back to the Position Interpolator, but only when
      // there's actually a time axis to interpolate against (a timed track) and a timestamp to
      // place on it (this photo's own EXIF capture time). Failing either leaves lat/lng null:
      // a timeless track has no time axis at all, and a photo with no EXIF timestamp has
      // nothing to interpolate against even on a timed track.
      if ((lat === null || lng === null) && isTimed && exif.timestamp) {
        const interpolated = interpolatePosition(points, Date.parse(exif.timestamp))
        if (interpolated.status === 'ok') {
          lat = interpolated.lat
          lng = interpolated.lng
        }
      }

      const storedPath = await storePhotoFile(filePath, trackId)
      imported.push(repository.createPhoto(trackId, storedPath, exif.timestamp, lat, lng))
    }

    return imported
  })

  ipcMain.handle('photos:getDataUri', async (_event, photoId: number): Promise<string> => {
    const photo = repository.getPhoto(photoId)
    if (!photo) throw new Error(`Photo ${photoId} not found`)
    const buffer = await readFile(photo.filepath)
    const mime = IMAGE_MIME_TYPES[extname(photo.filepath).toLowerCase()] ?? 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  })
}
