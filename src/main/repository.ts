import type Database from 'better-sqlite3'
import type { Trip, Track, TrackPoint, Entry, Photo, Message } from '../shared/types'
import { parseGpx, buildGpx, type ParsedGpxTrack } from './gpxParser'
import { parseInreachCsv } from './inreachCsvParser'
import type { TrackTimeRange } from '../shared/timezoneOffsetDetector'

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

// Thrown when a GPX file holds several <trk> segments (e.g. a whole trail's worth of planned
// legs exported from CalTopo as one file) and more than one of them has no timestamp of its own
// — a single date override wouldn't make sense for several distinct days, so the caller must
// instead prompt for a start date and retry via importGpxTrack's `startDate` option, which dates
// the untimed segments sequentially from there.
export class MultiDateRequiredError extends Error {
  constructor(public readonly segmentCount: number) {
    super(`${segmentCount} of this GPX file's track segments have no timestamp of their own`)
  }
}

// Thrown when trying to rename or re-date a track that has real GPS timestamps — a live-recorded
// track's name/date come from its own data, not a hiker's typed-in guess, so editing them isn't
// offered at all for a timed track. Only an untimed track (a CalTopo-style retrace or a planning
// route with no GPS clock) can have these edited.
export class TrackNotTimelessError extends Error {}

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

// Local (not UTC) date-component construction avoids the classic off-by-one from parsing a plain
// "YYYY-MM-DD" as UTC midnight — same reasoning as the renderer's own formatTrackDate.
function addDaysToIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// When several of a multi-<trk> file's segments need a sequential date assigned (see
// MultiDateRequiredError), this decides what order to assign them in. CalTopo's own multi-leg
// exports name each <trk> with its leg number ("1", "2", … "91") but don't necessarily store
// them in that order — so when every segment needing a date has a plain numeric name, they're
// ordered by that number instead of file order, matching what the numbering actually means. A
// file where even one such segment has a non-numeric name falls back to file order entirely
// (rather than partially reordering), since a mix has no well-defined "correct" order to guess at.
function orderForDateSequencing(segments: ParsedGpxTrack[]): ParsedGpxTrack[] {
  const allNumericallyNamed = segments.every(
    (s) => s.name !== null && s.name.trim() !== '' && Number.isFinite(Number(s.name))
  )
  if (!allNumericallyNamed) return segments
  return [...segments].sort((a, b) => Number(a.name) - Number(b.name))
}

interface EntryRow {
  id: number
  track_id: number
  text: string
  updated_at: string
}

interface PhotoRow {
  id: number
  track_id: number
  filepath: string
  timestamp: string | null
  lat: number | null
  lng: number | null
  caption: string | null
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

function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    trackId: row.track_id,
    filepath: row.filepath,
    timestamp: row.timestamp,
    lat: row.lat,
    lng: row.lng,
    caption: row.caption,
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

function requireName(name: string, label: string = 'Trip'): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(`${label} name must not be empty`)
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

  // Cascade-deletes a single track and everything hanging off it: track_points, entries,
  // messages, and photos rows (children before the parent row, since foreign_keys is ON and
  // there's no ON DELETE CASCADE configured anywhere — see db.ts), then the track row itself. All
  // in one transaction: either the whole track and its children disappear, or (on error) none of
  // it does.
  //
  // Deleting a photo's *file* on disk is a side effect outside the DB transaction, and this class
  // is kept a pure-DB-transaction concern (see fileStorageManager.ts for the actual filesystem
  // delete) — so this only collects and returns the filepaths of the photos it deleted in the DB.
  // The caller (the IPC layer) is responsible for unlinking those files after this transaction
  // commits successfully.
  deleteTrack(id: number): { deletedPhotoFilepaths: string[] } {
    return this.db.transaction(() => this.deleteTrackInTransaction(id))()
  }

  // The actual delete logic, factored out so deleteTrip can reuse it for each of a trip's tracks
  // inside its own single transaction, rather than duplicating the SQL or nesting
  // this.db.transaction calls (better-sqlite3 transactions aren't meant to nest).
  private deleteTrackInTransaction(id: number): { deletedPhotoFilepaths: string[] } {
    const photoRows = this.db.prepare('SELECT filepath FROM photos WHERE track_id = ?').all(id) as {
      filepath: string
    }[]

    this.db.prepare('DELETE FROM track_points WHERE track_id = ?').run(id)
    this.db.prepare('DELETE FROM entries WHERE track_id = ?').run(id)
    this.db.prepare('DELETE FROM messages WHERE track_id = ?').run(id)
    this.db.prepare('DELETE FROM photos WHERE track_id = ?').run(id)

    const info = this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
    if (info.changes === 0) throw new Error(`Track ${id} not found`)

    return { deletedPhotoFilepaths: photoRows.map((r) => r.filepath) }
  }

  // Cascade-deletes a trip: every track under it (and each track's own children, via
  // deleteTrackInTransaction), then the trip row itself, all in one transaction. Returns the
  // combined list of photo filepaths across every deleted track, same shape as deleteTrack, for
  // the IPC layer to unlink from disk after this commits.
  deleteTrip(id: number): { deletedPhotoFilepaths: string[] } {
    return this.db.transaction(() => {
      const tripExists = this.db.prepare('SELECT 1 FROM trips WHERE id = ?').get(id)
      if (!tripExists) throw new Error(`Trip ${id} not found`)

      const trackRows = this.db.prepare('SELECT id FROM tracks WHERE trip_id = ?').all(id) as {
        id: number
      }[]

      const deletedPhotoFilepaths: string[] = []
      for (const track of trackRows) {
        const result = this.deleteTrackInTransaction(track.id)
        deletedPhotoFilepaths.push(...result.deletedPhotoFilepaths)
      }

      this.db.prepare('DELETE FROM trips WHERE id = ?').run(id)

      return { deletedPhotoFilepaths }
    })()
  }

  // A GPX file usually holds a single <trk> (one recorded/traced day) and becomes one Track, but
  // a planning export can hold many — see parseGpx's doc comment — and becomes one Track per
  // segment in a single call. `options.date` resolves a single-<trk> file's date exactly as
  // before (unchanged behavior for the overwhelmingly common case); `options.startDate` instead
  // dates a multi-segment file's untimed segments sequentially, one calendar day apart, in
  // whatever order orderForDateSequencing decides (see its own doc comment).
  importGpxTrack(
    tripId: number,
    gpxRaw: string,
    options: { filename?: string; date?: string; startDate?: string } = {}
  ): Track[] {
    const segments = parseGpx(gpxRaw)

    const dates: (string | null)[] = segments.map((segment) => {
      const firstTimestamp = segment.points[0].timestamp
      // A live-recorded segment's own GPS time is authoritative — a filename/override is ignored.
      return firstTimestamp !== null ? firstTimestamp.slice(0, 10) : null
    })

    if (segments.length === 1) {
      // Exactly the single-track import path this always used to be: a filename-inferred date or
      // explicit override both still apply here, unlike the multi-segment branch below.
      if (dates[0] === null) {
        if (options.date && ISO_DATE.test(options.date)) {
          dates[0] = options.date
        } else {
          const inferred = options.filename ? inferDateFromFilename(options.filename) : null
          if (!inferred) {
            throw new DateRequiredError(
              'This GPX file has no timestamps and no date could be inferred from its filename'
            )
          }
          dates[0] = inferred
        }
      }
    } else {
      const needingDateIndexes = dates
        .map((date, index) => (date === null ? index : -1))
        .filter((index) => index !== -1)

      if (needingDateIndexes.length > 0) {
        if (!options.startDate || !ISO_DATE.test(options.startDate)) {
          throw new MultiDateRequiredError(needingDateIndexes.length)
        }
        const ordered = orderForDateSequencing(needingDateIndexes.map((index) => segments[index]))
        ordered.forEach((segment, sequenceIndex) => {
          const originalIndex = segments.indexOf(segment)
          dates[originalIndex] = addDaysToIsoDate(options.startDate as string, sequenceIndex)
        })
      }
    }

    const now = new Date().toISOString()
    const insertTrack = this.db.prepare(
      'INSERT INTO tracks (trip_id, name, date, gpx_raw, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const insertPoint = this.db.prepare(
      'INSERT INTO track_points (track_id, lat, lng, elevation, timestamp) VALUES (?, ?, ?, ?, ?)'
    )

    const trackIds = this.db.transaction(() => {
      const ids: number[] = []
      segments.forEach((segment, index) => {
        const date = dates[index] as string
        const name = segment.name || date
        // Each track gets its own minimal, self-contained GPX (not the original file's raw text)
        // — a multi-segment source file would otherwise have its entire text repeated once per
        // resulting track.
        const segmentGpxRaw = segments.length === 1 ? gpxRaw : buildGpx(segment)
        const info = insertTrack.run(tripId, name, date, segmentGpxRaw, now)
        const id = info.lastInsertRowid as number
        for (const point of segment.points) {
          insertPoint.run(id, point.lat, point.lng, point.elevation, point.timestamp)
        }
        ids.push(id)
      })
      return ids
    })()

    const placeholders = trackIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`)
      .all(...trackIds) as TrackRow[]
    const rowsById = new Map(rows.map((row) => [row.id, row]))
    return trackIds.map((id) => toTrack(rowsById.get(id) as TrackRow))
  }

  listTracksForTrip(tripId: number): Track[] {
    const rows = this.db
      .prepare('SELECT * FROM tracks WHERE trip_id = ? ORDER BY date ASC, id ASC')
      .all(tripId) as TrackRow[]
    return rows.map(toTrack)
  }

  // Renaming/re-dating is only offered for an untimed track (see TrackNotTimelessError) — a timed
  // track's name/date already come from real GPS data, and letting a hiker overwrite that with a
  // typed-in guess would contradict the app's "no guessing" stance on everything else timeline/
  // position related.
  updateTrack(id: number, updates: { name?: string; date?: string }): Track {
    const row = this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined
    if (!row) throw new Error(`Track ${id} not found`)

    if (updates.name !== undefined || updates.date !== undefined) {
      const firstPoint = this.db
        .prepare('SELECT timestamp FROM track_points WHERE track_id = ? LIMIT 1')
        .get(id) as { timestamp: string | null } | undefined
      const isTimed = firstPoint !== undefined && firstPoint.timestamp !== null
      if (isTimed) {
        throw new TrackNotTimelessError(
          'Only an untimed track (no GPS timestamps) can have its name or date edited'
        )
      }
    }

    const name = updates.name !== undefined ? requireName(updates.name, 'Track') : row.name
    let date = row.date
    if (updates.date !== undefined) {
      if (!ISO_DATE.test(updates.date)) {
        throw new Error('Date must be in YYYY-MM-DD format')
      }
      date = updates.date
    }

    this.db.prepare('UPDATE tracks SET name = ?, date = ? WHERE id = ?').run(name, date, id)
    return toTrack(this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow)
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

  // Every other TIMED track in the same trip as `trackId`, with its own recorded start/end —
  // cheap (a MIN/MAX aggregate, not a full point load) so the photo-import flow can check whether
  // a batch actually fits some other day in the trip better than the one it's being imported to
  // (see suggestBetterTrack in timezoneOffsetDetector.ts). A track with no timestamps at all is
  // naturally excluded: it has no non-null timestamp for MIN/MAX to aggregate, so it never
  // produces a row.
  listOtherTimedTrackRangesInSameTrip(trackId: number): TrackTimeRange[] {
    const track = this.db.prepare('SELECT trip_id FROM tracks WHERE id = ?').get(trackId) as
      { trip_id: number } | undefined
    if (!track) return []

    const rows = this.db
      .prepare(
        `SELECT t.id AS track_id, t.name, t.date,
                MIN(tp.timestamp) AS start_iso, MAX(tp.timestamp) AS end_iso
         FROM tracks t
         JOIN track_points tp ON tp.track_id = t.id
         WHERE t.trip_id = ? AND t.id != ? AND tp.timestamp IS NOT NULL
         GROUP BY t.id
         ORDER BY t.date ASC, t.id ASC`
      )
      .all(track.trip_id, trackId) as {
      track_id: number
      name: string
      date: string
      start_iso: string
      end_iso: string
    }[]

    return rows.map((row) => ({
      trackId: row.track_id,
      name: row.name,
      date: row.date,
      startIso: row.start_iso,
      endIso: row.end_iso
    }))
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

  // `filepath` is the already-copied managed path (see main/fileStorageManager.ts) — this method
  // only persists metadata, it doesn't touch the filesystem itself. `timestamp`/`lat`/`lng` are
  // each independently nullable: see Photo's doc comment in shared/types.ts for what each null
  // combination means. A track can have any number of photos, so this is a plain insert, not an
  // upsert, and inserting against a nonexistent trackId throws via the `foreign_keys = ON` pragma
  // set in migrate().
  createPhoto(
    trackId: number,
    filepath: string,
    timestamp: string | null,
    lat: number | null,
    lng: number | null,
    contentHash: string | null
  ): Photo {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        'INSERT INTO photos (track_id, filepath, timestamp, lat, lng, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(trackId, filepath, timestamp, lat, lng, contentHash, now)
    return toPhoto(
      this.db.prepare('SELECT * FROM photos WHERE id = ?').get(info.lastInsertRowid) as PhotoRow
    )
  }

  getPhoto(id: number): Photo | null {
    const row = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined
    return row ? toPhoto(row) : null
  }

  // Hiker-authored, added any time after import — entirely separate from the photo's own EXIF
  // data. Blank (or whitespace-only) input clears the caption back to null rather than storing an
  // empty string, since the two read identically in the UI (no caption shown either way).
  updatePhotoCaption(id: number, caption: string): Photo {
    const trimmed = caption.trim()
    const info = this.db
      .prepare('UPDATE photos SET caption = ? WHERE id = ?')
      .run(trimmed === '' ? null : trimmed, id)
    if (info.changes === 0) throw new Error(`Photo ${id} not found`)
    return toPhoto(this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow)
  }

  // Used to skip re-importing a photo already stored for this track — scoped per track (not
  // global) since the same photo genuinely belonging to two different tracks isn't a mistake.
  photoContentHashExists(trackId: number, contentHash: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM photos WHERE track_id = ? AND content_hash = ?')
      .get(trackId, contentHash)
    return row !== undefined
  }

  listPhotosForTrack(trackId: number): Photo[] {
    // Same `id ASC` tiebreak as getTrackPoints: a no-op once every photo has a distinct real
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
    // Same `id ASC` tiebreak as getTrackPoints for stable ordering, though in practice a
    // message's timestamp is never null so this rarely matters the way it does elsewhere.
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE track_id = ? ORDER BY timestamp ASC, id ASC')
      .all(trackId) as MessageRow[]
    return rows.map(toMessage)
  }
}
