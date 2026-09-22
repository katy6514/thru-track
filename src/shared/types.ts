export interface Trip {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export interface Track {
  id: number
  tripId: number
  name: string
  date: string
  createdAt: string
}

export interface TrackPoint {
  lat: number
  lng: number
  elevation: number | null
  // Null for a "timeless" track (e.g. a route retraced after the fact in CalTopo rather than
  // recorded live) — GPS timestamps are absent, but point order (the traced path) is preserved.
  timestamp: string | null
}

// Returned by a GPX import attempt when the track has no timestamps and no date could be
// inferred from the filename — the caller must re-submit the import with an explicit date.
export interface GpxImportNeedsDate {
  needsDate: true
  gpxRaw: string
}

// One plain-text journal entry per track (v1 is plain text only, no markdown/rich text).
export interface Entry {
  id: number
  trackId: number
  text: string
  updatedAt: string
}

// A hiker-authored note pinned to a moment on a track's timeline (issue #7). `timestamp` is the
// ISO instant the note refers to, and is null for a note on a timeless track (no time axis to
// place it on — see TrackPoint.timestamp above for the same distinction). Map position (lat/lng)
// is deliberately not modeled here; that's future work, out of scope for this slice.
export interface JournalNote {
  id: number
  trackId: number
  content: string
  timestamp: string | null
  createdAt: string
}

// A photo imported into a track (issue #9). `filepath` points at the app-managed copy under
// userData (see the main-process File Storage Manager) — never the hiker's original file
// location, which may move or be deleted after import. `timestamp` comes from the photo's own
// EXIF DateTimeOriginal and is assumed to already line up with the track's clock (timezone
// correction is a separate slice, issue #10). `lat`/`lng` come from the photo's own EXIF GPS
// when present, otherwise from the Position Interpolator against the track's points — and are
// both null when neither source can place the photo (no EXIF GPS AND the track is timeless, so
// there's no time axis to interpolate against either). A null-position photo still appears in a
// track's photo list, it's just not shown as a map pin.
export interface Photo {
  id: number
  trackId: number
  filepath: string
  timestamp: string | null
  lat: number | null
  lng: number | null
  createdAt: string
}

// A single photo's extracted EXIF data, captured up front by a `photos:import` call but not yet
// copied into managed storage or written to the DB — see PhotoImportNeedsOffset below. `filePath`
// is still the hiker's original file location at this point (the managed copy is only made once
// `photos:importWithOffset` finalizes the batch).
export interface PendingPhoto {
  filePath: string
  exifTimestamp: string | null
  exifLat: number | null
  exifLng: number | null
  contentHash: string
}

// Returned by `photos:import` instead of `Photo[]` when the track is timed AND at least one photo
// in the selected batch has its own EXIF timestamp — i.e. there's an actual track clock to compare
// against (see the Timezone Offset Detector, issue #10). The renderer must show a confirm/adjust
// prompt for `proposedOffsetMinutes` and resubmit via `photos:importWithOffset` to actually store
// the batch. When the track is timeless, or no photo in the batch has any EXIF timestamp at all,
// `photos:import` skips this step entirely and imports directly (there's nothing to compare).
export interface PhotoImportNeedsOffset {
  needsOffsetConfirm: true
  proposedOffsetMinutes: number
  pending: PendingPhoto[]
  duplicatesSkipped: number
}

// A completed import (offset-confirm not needed, or already resolved via
// `photos:importWithOffset`). `duplicatesSkipped` counts files that matched an existing photo's
// content hash for this track and were silently not re-imported — surfaced to the hiker as a
// small notice rather than left invisible, so "I picked 5 photos but only see 3 new ones" has an
// answer.
export interface PhotoImportResult {
  photos: Photo[]
  duplicatesSkipped: number
}

// A satellite check-in message imported from a device export (issue #11). Unlike a JournalNote,
// timestamp/lat/lng are never null: a satellite messenger transmits its own GPS position with
// every message, so a message is never dependent on the track's own timestamps/interpolation the
// way a photo would be. `source` is a literal union so future sources (e.g. 'spot') type-check
// cleanly when added — for now only 'inreach' is ever written.
export interface Message {
  id: number
  trackId: number
  content: string
  timestamp: string
  lat: number
  lng: number
  source: 'inreach'
  createdAt: string
}
