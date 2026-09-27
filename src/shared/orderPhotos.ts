import type { Photo } from './types'

// Chronological when every photo has a timestamp; a photo with none (no EXIF time at all) sorts
// after the ones that do, rather than colliding at an arbitrary position among them. Shared by
// the header slideshow and the expanded-photo overlay's arrow-key navigation, so both browse
// photos in the same order.
export function orderPhotosChronologically(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    if (a.timestamp === null) return b.timestamp === null ? 0 : 1
    if (b.timestamp === null) return -1
    return Date.parse(a.timestamp) - Date.parse(b.timestamp)
  })
}
