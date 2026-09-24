import exifr from 'exifr'

// Extracted from a photo's EXIF metadata at import time. Both timestamp and position are
// independently optional — a photo can have a timestamp with no GPS (the common case handled by
// interpolation), GPS with no timestamp (rare, but harmless — it just won't place on the
// timeline), or neither (a photo with no usable EXIF at all).
export interface ExifData {
  timestamp: string | null
  lat: number | null
  lng: number | null
}

const NO_EXIF: ExifData = { timestamp: null, lat: null, lng: null }

// GPSDateStamp ("YYYY:MM:DD") + GPSTimeStamp ("HH:MM:SS", or "HH:MM:SS.sss") are always recorded
// in UTC by the EXIF spec — unlike DateTimeOriginal, there's no camera-locale ambiguity to
// resolve at all when these are present, so they're the most trustworthy source available.
function parseGpsUtcTimestamp(dateStamp: unknown, timeStamp: unknown): Date | null {
  if (typeof dateStamp !== 'string' || typeof timeStamp !== 'string') return null
  const dateMatch = dateStamp.match(/^(\d{4}):(\d{2}):(\d{2})$/)
  const timeMatch = timeStamp.match(/^(\d{2}):(\d{2}):(\d{2})/)
  if (!dateMatch || !timeMatch) return null
  const [, year, month, day] = dateMatch
  const [, hour, minute, second] = timeMatch
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  )
  return Number.isNaN(ms) ? null : new Date(ms)
}

// Parses an EXIF UTC-offset tag ("+05:30", "-06:00") into a millisecond offset from UTC, or null
// if it isn't in that shape (e.g. missing, or the literal "+00:00"/UTC sentinel some cameras
// write when they have no real timezone info — which not being a *plausible* local offset only
// matters if we ever need to distinguish "known UTC" from "unknown"; treated the same as any
// other explicit offset here since both mean "trust this number").
function parseUtcOffsetMs(offset: unknown): number | null {
  if (typeof offset !== 'string') return null
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, sign, hours, minutes] = match
  const magnitudeMs = (Number(hours) * 60 + Number(minutes)) * 60 * 1000
  return sign === '-' ? -magnitudeMs : magnitudeMs
}

// exifr resolves DateTimeOriginal/CreateDate into a Date by constructing it from the EXIF's own
// (timezone-less) wall-clock digits as if they were *this process's own local time* — so the
// instant it represents (what .toISOString()/.getTime() report) is only correct when the
// machine running the import happens to be set to the same timezone the camera was in. Its LOCAL
// getters (getFullYear/getHours/etc — never the UTC ones), though, always recover the original
// EXIF digits exactly, regardless of the runtime's own timezone, precisely because that's the
// frame they were constructed in — see exifExtractor.test.ts for this verified directly. Reading
// those back out and re-combining them with an explicit EXIF offset tag is what actually
// resolves the camera's local time into a real, unambiguous UTC instant.
function applyExifOffset(localDate: Date, offsetMs: number): Date {
  const wallClockAsUtcMs = Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds()
  )
  return new Date(wallClockAsUtcMs - offsetMs)
}

// Picks the most trustworthy timestamp available in a parsed EXIF record, in order:
//   1. GPSDateStamp + GPSTimeStamp — always UTC, no ambiguity at all when present.
//   2. DateTimeOriginal (or CreateDate) combined with an explicit OffsetTimeOriginal/OffsetTime/
//      OffsetTimeDigitized tag — still exact, just requires the extra combination step above.
//   3. DateTimeOriginal/CreateDate alone, exactly as exifr resolved it — the one remaining
//      ambiguous case (no GPS timestamp, no offset tag at all), correct only when the machine
//      that imported the photo happened to be set to the camera's own timezone. This is the
//      entire previous behavior of this module, kept as the last resort rather than removed,
//      since a camera with no offset tag and no GPS gives nothing better to go on.
// Exported (separately from extractExifData) so this selection logic can be tested directly
// against synthetic parsed-EXIF records, without needing real JPEG fixtures for every case.
export function resolveExifTimestamp(parsed: Record<string, unknown>): string | null {
  const gpsTimestamp = parseGpsUtcTimestamp(parsed.GPSDateStamp, parsed.GPSTimeStamp)
  if (gpsTimestamp) return gpsTimestamp.toISOString()

  const rawDate = parsed.DateTimeOriginal ?? parsed.CreateDate
  if (!(rawDate instanceof Date) || Number.isNaN(rawDate.getTime())) return null

  const offsetMs = parseUtcOffsetMs(
    parsed.OffsetTimeOriginal ?? parsed.OffsetTime ?? parsed.OffsetTimeDigitized
  )
  if (offsetMs !== null) return applyExifOffset(rawDate, offsetMs).toISOString()

  return rawDate.toISOString()
}

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
  const timestamp = resolveExifTimestamp(parsed)

  return { timestamp, lat, lng }
}
