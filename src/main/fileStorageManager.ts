import { createHash, randomUUID } from 'crypto'
import { copyFile, mkdir, unlink } from 'fs/promises'
import { extname, join } from 'path'
import { app } from 'electron'

// The app's managed data directory for imported photos, under Electron's per-OS userData
// directory (e.g. ~/Library/Application Support/thru-track/photos on macOS). Everything the app
// shows a hiker (map pins, side-panel images) is read from here, never from the original file's
// location on their filesystem — see storePhotoFile below.
export function photosDir(): string {
  return join(app.getPath('userData'), 'photos')
}

// Copies (never moves — the hiker's original file is never touched or deleted) a photo into the
// app's managed photos directory, under a collision-safe generated filename that still traces
// back to its origin: the owning track id plus a random component, so two hikers' "IMG_0001.jpg"
// files (or the same file imported into two tracks) never collide, while the original extension
// is preserved so the file still opens as whatever image format it actually is.
export async function storePhotoFile(sourcePath: string, trackId: number): Promise<string> {
  const dir = photosDir()
  await mkdir(dir, { recursive: true })
  const ext = extname(sourcePath) || '.jpg'
  const managedFilename = `track-${trackId}-${randomUUID()}${ext}`
  const destPath = join(dir, managedFilename)
  await copyFile(sourcePath, destPath)
  return destPath
}

// Identifies a photo by its actual bytes, not its filename or timestamp — two different photos
// can legitimately share a timestamp (a burst shot), but never share a content hash, so this is
// what duplicate-import detection is keyed on.
export function hashPhotoContent(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// Deletes a managed photo file from disk, as post-transaction cleanup after Repository's
// deleteTrack/deleteTrip has already removed the corresponding `photos` row (and committed).
// A missing file (ENOENT — already deleted, or the file never made it to disk for some other
// reason) is deliberately swallowed rather than thrown: by the time this runs, the DB rows are
// already gone regardless of whether the unlink succeeds, so throwing here would surface a
// "deletion failed" error to the hiker for a delete that, from their perspective (the track/trip
// is gone from the app), actually succeeded. Any other error (e.g. a permissions problem) is
// still rethrown, since that's a real problem worth surfacing.
export async function deletePhotoFile(filepath: string): Promise<void> {
  try {
    await unlink(filepath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
}
