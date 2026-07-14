import exifr from 'exifr'

// Extracted from a photo's EXIF metadata at import time. Both timestamp and position are
// independently optional — a photo can have a timestamp with no GPS (the common case handled by
// interpolation), GPS with no timestamp (rare, but harmless — it just won't place on the
// timeline), or neither (a photo with no usable EXIF at all).
export interface ExifData {
  // ISO 8601 instant from the photo's EXIF DateTimeOriginal (falling back to CreateDate), or null
  // if neither tag is present/parseable. Assumed to already agree with the track's own clock —
  // timezone correction is a separate slice (issue #10), not handled here.
  timestamp: string | null
  lat: number | null
  lng: number | null
}

const NO_EXIF: ExifData = { timestamp: null, lat: null, lng: null }

// Pulls timestamp + GPS out of a photo file buffer. Deliberately tolerant: a photo with no EXIF
// segment at all (e.g. a screenshot, or a photo stripped of metadata by a messaging app) is a
// normal, expected input, not an error — it just means the caller falls back to interpolation
// for position, and gets no timeline placement without a timestamp either.
export async function extractExifData(buffer: Buffer): Promise<ExifData> {
  let parsed: Record<string, unknown> | undefined
  try {
    parsed = (await exifr.parse(buffer, { gps: true })) ?? undefined
  } catch {
    // A file that isn't a real image, or is corrupt — treat exactly like "no EXIF present".
    parsed = undefined
  }

  if (!parsed) return NO_EXIF

  const lat = typeof parsed.latitude === 'number' ? parsed.latitude : null
  const lng = typeof parsed.longitude === 'number' ? parsed.longitude : null

  const rawDate = parsed.DateTimeOriginal ?? parsed.CreateDate
  const timestamp =
    rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate.toISOString() : null

  return { timestamp, lat, lng }
}
