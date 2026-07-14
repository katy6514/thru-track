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
