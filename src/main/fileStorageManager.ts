import { randomUUID } from 'crypto'
import { copyFile, mkdir } from 'fs/promises'
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
