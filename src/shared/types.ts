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
