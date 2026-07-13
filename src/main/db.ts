import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function migrate(database: Database.Database): void {
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trip_id INTEGER NOT NULL REFERENCES trips(id),
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      gpx_raw TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_trip_id ON tracks(trip_id);

    CREATE TABLE IF NOT EXISTS track_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      elevation REAL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_track_points_track_id ON track_points(track_id);
  `)
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'thru-track.db')
    db = new Database(dbPath)
    migrate(db)
  }
  return db
}

export function pingDb(): { dbPath: string; sqliteVersion: string } {
  const database = getDb()
  const row = database.prepare('select sqlite_version() as version').get() as {
    version: string
  }
  return { dbPath: database.name, sqliteVersion: row.version }
}
