import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { getDb, pingDb } from './db'
import { Repository, DateRequiredError, MultiDateRequiredError } from './repository'
import { extractExifData } from './exifExtractor'
import { storePhotoFile, deletePhotoFile, hashPhotoContent } from './fileStorageManager'
import {
  startPhotoUploadServer,
  startGpxUploadServer,
  type StartedUploadServer
} from './photoUploadServer'
import { interpolatePosition } from '../shared/positionInterpolator'
import {
  detectTimezoneOffset,
  suggestBetterTrack,
  PLAUSIBLE_DRIFT_MINUTES
} from '../shared/timezoneOffsetDetector'
import type {
  Track,
  TrackPoint,
  GpxImportNeedsDate,
  GpxImportNeedsStartDate,
  Photo,
  PendingPhoto,
  PhotoImportNeedsOffset,
  PhotoImportResult,
  Message
} from '../shared/types'

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
  ipcMain.handle('trips:delete', async (_event, id: number): Promise<void> => {
    // deleteTrip only removes DB rows (in its own transaction) and hands back the filepaths of
    // every photo that was under the trip; the actual file unlinks happen here, after the
    // transaction has already committed successfully — see Repository.deleteTrip's doc comment.
    const { deletedPhotoFilepaths } = repository.deleteTrip(id)
    for (const filepath of deletedPhotoFilepaths) {
      await deletePhotoFile(filepath)
    }
  })

  ipcMain.handle('tracks:list', (_event, tripId: number) => repository.listTracksForTrip(tripId))

  ipcMain.handle(
    'tracks:update',
    (
      _event,
      id: number,
      updates: { name?: string; date?: string; startLocation?: string; endLocation?: string }
    ): Track => repository.updateTrack(id, updates)
  )

  ipcMain.handle('tracks:delete', async (_event, id: number): Promise<void> => {
    const { deletedPhotoFilepaths } = repository.deleteTrack(id)
    for (const filepath of deletedPhotoFilepaths) {
      await deletePhotoFile(filepath)
    }
  })

  ipcMain.handle(
    'tracks:importGpx',
    async (
      event,
      tripId: number
    ): Promise<Track[] | GpxImportNeedsDate | GpxImportNeedsStartDate | null> => {
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
        // A multi-<trk> file (e.g. a whole trail's worth of legs from one CalTopo export) with
        // several untimed segments — same idea, but the renderer prompts for a start date and
        // resubmits via importGpxWithStartDate instead.
        if (err instanceof MultiDateRequiredError) {
          return { needsStartDate: true, gpxRaw, segmentCount: err.segmentCount }
        }
        throw err
      }
    }
  )

  ipcMain.handle(
    'tracks:importGpxWithDate',
    (_event, tripId: number, gpxRaw: string, date: string): Track[] =>
      repository.importGpxTrack(tripId, gpxRaw, { date })
  )

  ipcMain.handle(
    'tracks:importGpxWithStartDate',
    (_event, tripId: number, gpxRaw: string, startDate: string): Track[] =>
      repository.importGpxTrack(tripId, gpxRaw, { startDate })
  )

  // A phone on the same wifi/hotspot sends its exported GPX file straight to a short-lived local
  // HTTP server (see photoUploadServer.ts / issue #34), the same mechanism as the phone photo
  // uploader but its own separate session/QR code rather than one flow that accepts both file
  // types — scanning it is a distinct choice from "upload photos", and the two upload pages ask
  // for different things. Only one session runs at a time, scoped to whichever trip it was
  // started from.
  let activeGpxUploadServer: StartedUploadServer | null = null

  ipcMain.handle(
    'gpxUpload:start',
    async (event, tripId: number): Promise<{ url: string; qrDataUri: string }> => {
      activeGpxUploadServer?.stop()
      const window = BrowserWindow.fromWebContents(event.sender)
      const server = await startGpxUploadServer((files) => {
        const file = files[0]
        if (!file) return
        readFile(file.filePath, 'utf-8')
          .then((gpxRaw) => {
            try {
              const tracks = repository.importGpxTrack(tripId, gpxRaw, {
                filename: file.originalName
              })
              window?.webContents.send('gpxUpload:received', tracks)
            } catch (err) {
              // Same fallback as the file-picker path above: no usable date, so hand the parsed
              // GPX back to the renderer to prompt for one and resubmit via importGpxWithDate (or
              // importGpxWithStartDate for a multi-segment file).
              if (err instanceof DateRequiredError) {
                window?.webContents.send('gpxUpload:received', { needsDate: true, gpxRaw })
              } else if (err instanceof MultiDateRequiredError) {
                window?.webContents.send('gpxUpload:received', {
                  needsStartDate: true,
                  gpxRaw,
                  segmentCount: err.segmentCount
                })
              } else {
                throw err
              }
            }
          })
          .catch((err) => {
            window?.webContents.send('gpxUpload:error', String(err))
          })
      })
      activeGpxUploadServer = server
      return { url: server.url, qrDataUri: server.qrDataUri }
    }
  )

  ipcMain.handle('gpxUpload:stop', (): void => {
    activeGpxUploadServer?.stop()
    activeGpxUploadServer = null
  })

  ipcMain.handle('tracks:getPoints', (_event, trackId: number): TrackPoint[] =>
    repository.getTrackPoints(trackId)
  )

  ipcMain.handle('entries:get', (_event, trackId: number) => repository.getEntry(trackId))
  ipcMain.handle('entries:save', (_event, trackId: number, text: string) =>
    repository.saveEntry(trackId, text)
  )

  ipcMain.handle('photos:list', (_event, trackId: number): Photo[] =>
    repository.listPhotosForTrack(trackId)
  )

  ipcMain.handle('photos:updateCaption', (_event, photoId: number, caption: string): Photo =>
    repository.updatePhotoCaption(photoId, caption)
  )

  // Shared by both the direct-import path and photos:importWithOffset below: copies each pending
  // photo's file into managed storage, resolves its position (EXIF GPS, falling back to
  // interpolation), and inserts the DB row. `offsetMinutes` shifts each photo's EXIF timestamp
  // before it's used for anything — persisted timestamp and interpolation alike — so a confirmed
  // (or manually adjusted) timezone correction is applied consistently everywhere the timestamp
  // matters. `offsetMinutes` is 0 on the direct path (no correction needed/possible there).
  async function finalizePhotoImport(
    trackId: number,
    pending: PendingPhoto[],
    offsetMinutes: number
  ): Promise<Photo[]> {
    // `pending` arriving here is already duplicate-filtered (see buildPhotoImportResult) — this
    // just does the copy/DB-insert work, so nothing further to check.
    const points = repository.getTrackPoints(trackId)
    const isTimed = points.length > 0 && points[0].timestamp !== null
    const offsetMs = offsetMinutes * 60 * 1000

    const imported: Photo[] = []
    for (const photo of pending) {
      // A positive offsetMinutes means the camera clock reads that many minutes ahead of the
      // track's own clock (see timezoneOffsetDetector.ts) — subtracting it aligns the photo's
      // timestamp back onto the track's clock before it's stored or interpolated against.
      const adjustedTimestamp =
        photo.exifTimestamp !== null
          ? new Date(Date.parse(photo.exifTimestamp) - offsetMs).toISOString()
          : null

      let lat = photo.exifLat
      let lng = photo.exifLng
      // No EXIF GPS on this photo — fall back to the Position Interpolator, but only when
      // there's actually a time axis to interpolate against (a timed track) and a timestamp to
      // place on it (this photo's own, offset-corrected capture time). Failing either leaves
      // lat/lng null: a timeless track has no time axis at all, and a photo with no EXIF
      // timestamp has nothing to interpolate against even on a timed track.
      if ((lat === null || lng === null) && isTimed && adjustedTimestamp) {
        const interpolated = interpolatePosition(points, Date.parse(adjustedTimestamp))
        if (interpolated.status === 'ok') {
          lat = interpolated.lat
          lng = interpolated.lng
        }
      }

      const storedPath = await storePhotoFile(photo.filePath, trackId)
      imported.push(
        repository.createPhoto(trackId, storedPath, adjustedTimestamp, lat, lng, photo.contentHash)
      )
    }

    return imported
  }

  // Shared by the file-picker import below and the phone-upload path (ipc channel photoUpload:*
  // further down): given a batch of file paths already sitting on disk — wherever they came from
  // — extracts EXIF and either returns a finalized import or hands back a pending batch awaiting
  // offset confirmation. Keeping this in one place means both import paths apply identical
  // EXIF/GPS/timezone-offset matching logic.
  async function buildPhotoImportResult(
    trackId: number,
    filePaths: string[]
  ): Promise<PhotoImportResult | PhotoImportNeedsOffset> {
    if (filePaths.length === 0) return { photos: [], duplicatesSkipped: 0 }

    // Fetched once up front rather than per-photo: every photo in this batch is imported against
    // the same track, so its points/timed-ness don't change mid-loop.
    const points = repository.getTrackPoints(trackId)
    const isTimed = points.length > 0 && points[0].timestamp !== null

    // Extract EXIF and hash every file, but don't finalize (copy/DB-insert) anything yet — that
    // only happens once any offset-confirmation step below has been resolved. A file whose
    // content hash matches a photo already stored for this track — or an earlier file in this
    // same batch, e.g. the same photo picked twice — is dropped here rather than re-imported;
    // `duplicatesSkipped` carries the count back so the hiker isn't left wondering why they
    // picked 5 files but only got 3.
    const pending: PendingPhoto[] = []
    const seenHashes = new Set<string>()
    let duplicatesSkipped = 0
    for (const filePath of filePaths) {
      const buffer = await readFile(filePath)
      const contentHash = hashPhotoContent(buffer)
      if (seenHashes.has(contentHash) || repository.photoContentHashExists(trackId, contentHash)) {
        duplicatesSkipped++
        continue
      }
      seenHashes.add(contentHash)

      const exif = await extractExifData(buffer)
      pending.push({
        filePath,
        exifTimestamp: exif.timestamp,
        exifLat: exif.lat,
        exifLng: exif.lng,
        contentHash
      })
    }

    // A timezone offset can only be detected when there's both a track clock to compare against
    // (a timed track) and at least one photo's own EXIF clock to compare it to (a batch where
    // every photo lacks an EXIF timestamp has nothing to offset). Either gap means there's
    // genuinely no comparison to make, so skip the confirmation prompt and import directly —
    // unchanged from the pre-issue-#10 behavior.
    const trackStart = isTimed ? (points[0].timestamp as string) : null
    const trackEnd = isTimed ? (points[points.length - 1].timestamp as string) : null
    const photosWithTimestamp = pending
      .map((p) => p.exifTimestamp)
      .filter((ts): ts is string => ts !== null)

    if (trackStart !== null && trackEnd !== null && photosWithTimestamp.length > 0) {
      const { offsetMinutes } = detectTimezoneOffset(trackStart, trackEnd, photosWithTimestamp)

      // Only worth checking sibling tracks at all once this track's own offset is already past
      // plausible clock drift — the common case (a normal, small offset) never touches the DB for
      // this. See suggestBetterTrack's own doc comment for what this is actually catching: a
      // hiker importing today's photos onto a different day's track by mistake.
      const suggestedTrack =
        Math.abs(offsetMinutes) > PLAUSIBLE_DRIFT_MINUTES
          ? suggestBetterTrack(
              offsetMinutes,
              photosWithTimestamp,
              repository.listOtherTimedTrackRangesInSameTrip(trackId)
            )
          : null

      return {
        needsOffsetConfirm: true,
        proposedOffsetMinutes: offsetMinutes,
        pending,
        duplicatesSkipped,
        suggestedTrack
      }
    }

    return { photos: await finalizePhotoImport(trackId, pending, 0), duplicatesSkipped }
  }

  ipcMain.handle(
    'photos:import',
    async (event, trackId: number): Promise<PhotoImportResult | PhotoImportNeedsOffset> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window found for the requesting renderer')
      const result = await dialog.showOpenDialog(window, {
        title: 'Import photos',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif'] }]
      })
      if (result.canceled || result.filePaths.length === 0)
        return { photos: [], duplicatesSkipped: 0 }
      return buildPhotoImportResult(trackId, result.filePaths)
    }
  )

  ipcMain.handle(
    'photos:importWithOffset',
    async (
      _event,
      trackId: number,
      pending: PendingPhoto[],
      offsetMinutes: number
    ): Promise<PhotoImportResult> => ({
      // The batch reaching here was already duplicate-filtered when it was first built (see
      // buildPhotoImportResult) — nothing further can have become a duplicate in the meantime.
      photos: await finalizePhotoImport(trackId, pending, offsetMinutes),
      duplicatesSkipped: 0
    })
  )

  // A phone on the same wifi/hotspot uploads straight to a short-lived local HTTP server (see
  // photoUploadServer.ts / issue #33) instead of the hiker having to sync photos to the desktop
  // first. Only one session runs at a time, scoped to whichever track the hiker started it from;
  // starting a new one replaces any prior session rather than running two servers at once.
  let activeUploadServer: StartedUploadServer | null = null

  ipcMain.handle(
    'photoUpload:start',
    async (event, trackId: number): Promise<{ url: string; qrDataUri: string }> => {
      activeUploadServer?.stop()
      const window = BrowserWindow.fromWebContents(event.sender)
      const server = await startPhotoUploadServer((files) => {
        buildPhotoImportResult(
          trackId,
          files.map((f) => f.filePath)
        )
          .then((result) => {
            window?.webContents.send('photoUpload:batchReceived', result)
          })
          .catch((err) => {
            window?.webContents.send('photoUpload:batchError', String(err))
          })
      })
      activeUploadServer = server
      return { url: server.url, qrDataUri: server.qrDataUri }
    }
  )

  ipcMain.handle('photoUpload:stop', (): void => {
    activeUploadServer?.stop()
    activeUploadServer = null
  })

  ipcMain.handle('photos:getDataUri', async (_event, photoId: number): Promise<string> => {
    const photo = repository.getPhoto(photoId)
    if (!photo) throw new Error(`Photo ${photoId} not found`)
    const buffer = await readFile(photo.filepath)
    const mime = IMAGE_MIME_TYPES[extname(photo.filepath).toLowerCase()] ?? 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  })

  ipcMain.handle(
    'messages:importCsv',
    async (event, trackId: number): Promise<Message[] | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new Error('No window found for the requesting renderer')
      const result = await dialog.showOpenDialog(window, {
        title: 'Import inReach messages (CSV)',
        properties: ['openFile'],
        filters: [{ name: 'CSV files', extensions: ['csv'] }]
      })
      if (result.canceled || result.filePaths.length === 0) return null

      const csvRaw = await readFile(result.filePaths[0], 'utf-8')
      return repository.importInreachMessages(trackId, csvRaw)
    }
  )

  ipcMain.handle('messages:list', (_event, trackId: number): Message[] =>
    repository.listMessagesForTrack(trackId)
  )
}
