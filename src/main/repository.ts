import type Database from 'better-sqlite3'
import type { Trip, Track, TrackPoint, Entry } from '../shared/types'
import { parseGpx } from './gpxParser'

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
  timestamp: string
}

interface EntryRow {
  id: number
  track_id: number
  text: string
  updated_at: string
}

function toTrip(row: TripRow): Trip {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

function toTrack(row: TrackRow): Track {
  return { id: row.id, tripId: row.trip_id, name: row.name, date: row.date, createdAt: row.created_at }
}

function toTrackPoint(row: TrackPointRow): TrackPoint {
  return { lat: row.lat, lng: row.lng, elevation: row.elevation, timestamp: row.timestamp }
}

function toEntry(row: EntryRow): Entry {
  return { id: row.id, trackId: row.track_id, text: row.text, updatedAt: row.updated_at }
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Trip name must not be empty')
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

  importGpxTrack(tripId: number, gpxRaw: string): Track {
    const parsed = parseGpx(gpxRaw)
    const date = parsed.points[0].timestamp.slice(0, 10)
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
    const rows = this.db
      .prepare('SELECT * FROM track_points WHERE track_id = ? ORDER BY timestamp ASC')
      .all(trackId) as TrackPointRow[]
    return rows.map(toTrackPoint)
  }

  getEntry(trackId: number): Entry | null {
    const row = this.db.prepare('SELECT * FROM entries WHERE track_id = ?').get(trackId) as
      | EntryRow
      | undefined
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
    return toEntry(this.db.prepare('SELECT * FROM entries WHERE track_id = ?').get(trackId) as EntryRow)
  }
}
