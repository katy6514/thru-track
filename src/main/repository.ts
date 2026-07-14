import type Database from 'better-sqlite3'
import type { Trip, Track, TrackPoint, Entry, JournalNote, Photo, Message } from '../shared/types'
import { parseGpx } from './gpxParser'
import { parseInreachCsv } from './inreachCsvParser'

interface TripRow {
  id: number
  name: string
  created_at: string
  updated_at: string
}

interface TrackRow {
  id: number
  trip_id: number
  name: string
  date: string
  gpx_raw: string
  created_at: string
}

interface TrackPointRow {
  id: number
  track_id: number
  lat: number
  lng: number
  elevation: number | null
  timestamp: string | null
}

// Thrown when a track has no timestamps (a CalTopo-style retrace rather than a live GPS
// recording) and no date could be inferred from its filename — the caller (IPC layer) must
// prompt the hiker for a date and retry with an explicit override.
export class DateRequiredError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isPlausibleDate(year: number, month: number, day: number): boolean {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

// Tries a few common date patterns hikers/tools actually use in exported filenames
// (e.g. CalTopo's default export naming, or a hiker renaming the file themselves).
// Deliberately conservative: a plausible year/month/day beats a blind regex match, since a
// filename could otherwise contain an unrelated 8-digit run.
export function inferDateFromFilename(filename: string): string | null {
  const patterns: RegExp[] = [
    /(\d{4})-(\d{2})-(\d{2})/, // 2026-07-01
    /(\d{4})_(\d{2})_(\d{2})/, // 2026_07_01
    /(\d{4})(\d{2})(\d{2})/ // 20260701
  ]

  for (const pattern of patterns) {
    const match = filename.match(pattern)
    if (!match) continue
    const [, yearStr, monthStr, dayStr] = match
    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)
    if (isPlausibleDate(year, month, day)) {
      return `${yearStr}-${monthStr}-${dayStr}`
    }
  }

  return null
}

interface EntryRow {
  id: number
  track_id: number
  text: string
  updated_at: string
}

interface JournalNoteRow {
  id: number
  track_id: number
  content: string
  timestamp: string | null
  created_at: string
}

interface PhotoRow {
  id: number
  track_id: number
  filepath: string
  timestamp: string | null
  lat: number | null
  lng: number | null
  created_at: string
}

interface MessageRow {
  id: number
  track_id: number
  content: string
  timestamp: string
  lat: number
  lng: number
  source: string
  created_at: string
}

function toTrip(row: TripRow): Trip {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function toTrack(row: TrackRow): Track {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    date: row.date,
    createdAt: row.created_at
  }
}

function toTrackPoint(row: TrackPointRow): TrackPoint {
  return { lat: row.lat, lng: row.lng, elevation: row.elevation, timestamp: row.timestamp }
}

function toEntry(row: EntryRow): Entry {
  return { id: row.id, trackId: row.track_id, text: row.text, updatedAt: row.updated_at }
}

function toJournalNote(row: JournalNoteRow): JournalNote {
  return {
    id: row.id,
    trackId: row.track_id,
    content: row.content,
    timestamp: row.timestamp,
    createdAt: row.created_at
  }
}

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    trackId: row.track_id,
    filepath: row.filepath,
    timestamp: row.timestamp,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.created_at
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    trackId: row.track_id,
    content: row.content,
    timestamp: row.timestamp,
    lat: row.lat,
    lng: row.lng,
    // Only 'inreach' is ever written today (see importInreachMessages) — cast rather than widen
    // Message.source to `string`, so a future second source is a deliberate, typed addition.
    source: row.source as Message['source'],
    createdAt: row.created_at
  }
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Trip name must not be empty')
  return trimmed
}

function requireContent(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Note content must not be empty')
  return trimmed
}

export class Repository {
  constructor(private db: Database.Database) {}

  createTrip(name: string): Trip {
    const trimmed = requireName(name)
    const now = new Date().toISOString()
    const info = this.db
      .prepare('INSERT INTO trips (name, created_at, updated_at) VALUES (?, ?, ?)')
      .run(trimmed, now, now)
    return toTrip(
      this.db.prepare('SELECT * FROM trips WHERE id = ?').get(info.lastInsertRowid) as TripRow
    )
  }

  listTrips(): Trip[] {
    const rows = this.db
      .prepare('SELECT * FROM trips ORDER BY created_at DESC, id DESC')
      .all() as TripRow[]
    return rows.map(toTrip)
  }

  renameTrip(id: number, name: string): Trip {
    const trimmed = requireName(name)
    const now = new Date().toISOString()
    const info = this.db
      .prepare('UPDATE trips SET name = ?, updated_at = ? WHERE id = ?')
      .run(trimmed, now, id)
    if (info.changes === 0) throw new Error(`Trip ${id} not found`)
    return toTrip(this.db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripRow)
  }

  deleteTrip(id: number): void {
    const info = this.db.prepare('DELETE FROM trips WHERE id = ?').run(id)
    if (info.changes === 0) throw new Error(`Trip ${id} not found`)
  }

  importGpxTrack(
    tripId: number,
    gpxRaw: string,
    options: { filename?: string; date?: string } = {}
  ): Track {
    const parsed = parseGpx(gpxRaw)
    const firstTimestamp = parsed.points[0].timestamp

    let date: string
    if (firstTimestamp !== null) {
      // A live-recorded track's own GPS time is authoritative — a filename/override is ignored.
      date = firstTimestamp.slice(0, 10)
    } else if (options.date && ISO_DATE.test(options.date)) {
      date = options.date
    } else {
      const inferred = options.filename ? inferDateFromFilename(options.filename) : null
      if (!inferred) {
        throw new DateRequiredError(
          'This GPX file has no timestamps and no date could be inferred from its filename'
        )
      }
      date = inferred
    }

    const name = parsed.name || date
    const now = new Date().toISOString()

    const insertTrack = this.db.prepare(
      'INSERT INTO tracks (trip_id, name, date, gpx_raw, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const insertPoint = this.db.prepare(
      'INSERT INTO track_points (track_id, lat, lng, elevation, timestamp) VALUES (?, ?, ?, ?, ?)'
    )

    const trackId = this.db.transaction(() => {
      const info = insertTrack.run(tripId, name, date, gpxRaw, now)
      const id = info.lastInsertRowid
      for (const point of parsed.points) {
        insertPoint.run(id, point.lat, point.lng, point.elevation, point.timestamp)
      }
      return id
    })()

    return toTrack(this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as TrackRow)
  }

  listTracksForTrip(tripId: number): Track[] {
    const rows = this.db
      .prepare('SELECT * FROM tracks WHERE trip_id = ? ORDER BY date DESC, id DESC')
      .all(tripId) as TrackRow[]
    return rows.map(toTrack)
  }

  getTrackPoints(trackId: number): TrackPoint[] {
    // `id ASC` is the tiebreaker: for a timed track it's a no-op (timestamps already differ), but
    // for a timeless track every timestamp is NULL, so `id` (insertion order == the file's own
    // point order, since import inserts points in parsed order) is what actually orders the path.
    const rows = this.db
      .prepare('SELECT * FROM track_points WHERE track_id = ? ORDER BY timestamp ASC, id ASC')
      .all(trackId) as TrackPointRow[]
    return rows.map(toTrackPoint)
  }

  getEntry(trackId: number): Entry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE track_id = ?').get(trackId) as
      EntryRow | undefined
    return row ? toEntry(row) : null
  }

  // There's exactly one entry per track, so this is an upsert: create the row if it doesn't
  // exist yet, otherwise update it in place. Empty text is a valid, persistable state (e.g. a
  // hiker who opened the editor but hasn't written anything, or cleared it out) — it is not
  // treated as "no entry" the way an empty trip name is rejected.
  saveEntry(trackId: number, text: string): Entry {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO entries (track_id, text, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(track_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`
      )
      .run(trackId, text, now)
    return toEntry(
      this.db.prepare('SELECT * FROM entries WHERE track_id = ?').get(trackId) as EntryRow
    )
  }

  // `timestamp` is the ISO instant the note refers to on the track's timeline, or null for a
  // note on a timeless track (no time axis to place it on — see JournalNote's doc comment).
  // Unlike entries, a track can have any number of notes, so this is a plain insert, not an
  // upsert. Inserting against a nonexistent trackId throws via the `foreign_keys = ON` pragma
  // set in migrate(), same as importGpxTrack/saveEntry.
  createNote(trackId: number, content: string, timestamp: string | null): JournalNote {
    const trimmed = requireContent(content)
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        'INSERT INTO journal_notes (track_id, content, timestamp, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(trackId, trimmed, timestamp, now)
    return toJournalNote(
      this.db
        .prepare('SELECT * FROM journal_notes WHERE id = ?')
        .get(info.lastInsertRowid) as JournalNoteRow
    )
  }

  listNotesForTrack(trackId: number): JournalNote[] {
    // Same `id ASC` tiebreak as getTrackPoints: a no-op when every note has a distinct real
    // timestamp, but for a timeless track's notes (timestamp always null) it falls back to
    // creation order, which is the only sensible order available.
    const rows = this.db
      .prepare('SELECT * FROM journal_notes WHERE track_id = ? ORDER BY timestamp ASC, id ASC')
      .all(trackId) as JournalNoteRow[]
    return rows.map(toJournalNote)
  }

  // `filepath` is the already-copied managed path (see main/fileStorageManager.ts) — this method
  // only persists metadata, it doesn't touch the filesystem itself. `timestamp`/`lat`/`lng` are
  // each independently nullable: see Photo's doc comment in shared/types.ts for what each null
  // combination means. Like createNote, a track can have any number of photos, so this is a
  // plain insert, not an upsert, and inserting against a nonexistent trackId throws via the
  // `foreign_keys = ON` pragma set in migrate().
  createPhoto(
    trackId: number,
    filepath: string,
    timestamp: string | null,
    lat: number | null,
    lng: number | null
  ): Photo {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        'INSERT INTO photos (track_id, filepath, timestamp, lat, lng, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(trackId, filepath, timestamp, lat, lng, now)
    return toPhoto(
      this.db.prepare('SELECT * FROM photos WHERE id = ?').get(info.lastInsertRowid) as PhotoRow
    )
  }

  getPhoto(id: number): Photo | null {
    const row = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined
    return row ? toPhoto(row) : null
  }

  listPhotosForTrack(trackId: number): Photo[] {
    // Same `id ASC` tiebreak as listNotesForTrack: a no-op once every photo has a distinct real
    // timestamp, but falls back to creation order for a timeless track's photos (timestamp
    // always null there).
    const rows = this.db
      .prepare('SELECT * FROM photos WHERE track_id = ? ORDER BY timestamp ASC, id ASC')
      .all(trackId) as PhotoRow[]
    return rows.map(toPhoto)
  }

  // Parses an inReach CSV export and inserts every message it contains against `trackId` in one
  // transaction — either the whole file lands, or (on a parse error) none of it does, same as
  // importGpxTrack. Returns the newly created messages; callers that want the track's full message
  // list afterward should call listMessagesForTrack.
  importInreachMessages(trackId: number, csvRaw: string): Message[] {
    const parsed = parseInreachCsv(csvRaw)
    if (parsed.length === 0) return []

    const now = new Date().toISOString()

    const insertMessage = this.db.prepare(
      `INSERT INTO messages (track_id, content, timestamp, lat, lng, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    const { firstId, lastId } = this.db.transaction(() => {
      let firstId: number | bigint | null = null
      let lastId: number | bigint | null = null
      for (const message of parsed) {
        const info = insertMessage.run(
          trackId,
          message.content,
          message.timestamp,
          message.lat,
          message.lng,
          'inreach',
          now
        )
        if (firstId === null) firstId = info.lastInsertRowid
        lastId = info.lastInsertRowid
      }
      return { firstId: firstId as number, lastId: lastId as number }
    })()

    const rows = this.db
      .prepare('SELECT * FROM messages WHERE id BETWEEN ? AND ? ORDER BY id ASC')
      .all(firstId, lastId) as MessageRow[]
    return rows.map(toMessage)
  }

  listMessagesForTrack(trackId: number): Message[] {
    // Same `id ASC` tiebreak as getTrackPoints/listNotesForTrack for stable ordering, though in
    // practice a message's timestamp is never null so this rarely matters in the same way it
    // does for a timeless track's notes.
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE track_id = ? ORDER BY timestamp ASC, id ASC')
      .all(trackId) as MessageRow[]
    return rows.map(toMessage)
  }
}
