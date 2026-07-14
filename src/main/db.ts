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
      timestamp TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_track_points_track_id ON track_points(track_id);

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id),
      text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Unlike entries (one per track), a track can have many notes. timestamp is nullable for
    -- the same reason track_points.timestamp is: a note added to a timeless (CalTopo-retraced)
    -- track has no time axis to place it on, so it's stored with a null timestamp and simply
    -- isn't shown on a timeline (there isn't one to show it on). Position (lat/lng) is
    -- deliberately not modeled here — placing a note on the map is out of scope for issue #7.
    CREATE TABLE IF NOT EXISTS journal_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      content TEXT NOT NULL,
      timestamp TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_journal_notes_track_id ON journal_notes(track_id);

    -- A satellite message imported from a device export (currently only Garmin inReach CSV
    -- exports, hence source = 'inreach' hardcoded at write time — the PRD's data model
    -- anticipates other sources, e.g. 'spot', later). Unlike a journal note, a message always
    -- carries its own GPS position straight from the export (a satellite messenger transmits
    -- location with every check-in), so lat/lng are NOT NULL here, and timestamp is NOT NULL
    -- too since a message's own absolute timestamp is independent of whether the track it's
    -- attached to happens to have GPS timestamps of its own (see the timeless-track handling in
    -- gpxParser.ts / TrackPoint.timestamp).
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_track_id ON messages(track_id);
  `)

  migrateTrackPointsTimestampNullable(database)
}

// track_points.timestamp used to be NOT NULL, before timeless (CalTopo-retrace-style) tracks
// were supported. CREATE TABLE IF NOT EXISTS above is a no-op against an existing database with
// the old constraint, so an existing local .db file needs its table rebuilt to actually drop the
// NOT NULL — done via SQLite's standard rename/recreate/copy/drop dance so no data is lost. This
// is a no-op (single fast PRAGMA read) once a database has already been migrated.
function migrateTrackPointsTimestampNullable(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(track_points)').all() as {
    name: string
    notnull: number
  }[]
  const timestampColumn = columns.find((c) => c.name === 'timestamp')
  if (!timestampColumn || timestampColumn.notnull === 0) return

  database.transaction(() => {
    database.exec(`
      ALTER TABLE track_points RENAME TO track_points_old;

      CREATE TABLE track_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id INTEGER NOT NULL REFERENCES tracks(id),
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        timestamp TEXT
      );

      INSERT INTO track_points (id, track_id, lat, lng, elevation, timestamp)
        SELECT id, track_id, lat, lng, elevation, timestamp FROM track_points_old;

      DROP TABLE track_points_old;

      CREATE INDEX IF NOT EXISTS idx_track_points_track_id ON track_points(track_id);
    `)
  })()
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
