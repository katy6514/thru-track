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

    -- filepath is the app-managed copy under userData (see the File Storage Manager in
    -- main/fileStorageManager.ts), never the hiker's original file location. timestamp comes
    -- from EXIF DateTimeOriginal and is nullable for a photo with no EXIF timestamp at all.
    -- lat/lng come from EXIF GPS when present, otherwise from the Position Interpolator against
    -- the track's points, and are both nullable for the same reason: no EXIF GPS AND a timeless
    -- track (no time axis to interpolate against) leaves no position available at all.
    -- content_hash (SHA-256 of the file's bytes) is how a re-imported duplicate is recognized —
    -- deliberately not timestamp-based, since two genuinely different photos taken in the same
    -- second (a burst) are common and must both be kept.
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      filepath TEXT NOT NULL,
      timestamp TEXT,
      lat REAL,
      lng REAL,
      content_hash TEXT,
      caption TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_photos_track_id ON photos(track_id);
    CREATE INDEX IF NOT EXISTS idx_photos_track_id_content_hash ON photos(track_id, content_hash);

    -- A satellite message imported from a device export (currently only Garmin inReach CSV
    -- exports, hence source = 'inreach' hardcoded at write time — the PRD's data model
    -- anticipates other sources, e.g. 'spot', later). A message always carries its own GPS
    -- position straight from the export (a satellite messenger transmits location with every
    -- check-in), so lat/lng are NOT NULL here, and timestamp is NOT NULL too since a message's
    -- own absolute timestamp is independent of whether the track it's attached to happens to
    -- have GPS timestamps of its own (see the timeless-track handling in gpxParser.ts /
    -- TrackPoint.timestamp).
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
  migratePhotosContentHash(database)
  migratePhotosCaption(database)
  dropJournalNotes(database)
}

// The journal-note feature (a short text pinned to a moment on a track's timeline, distinct from
// the per-track journal entry) was removed — the note-taking flow was too similar to the journal
// entry, with no real distinction a hiker could feel. Dropping the table (not just leaving it
// unused) since nothing else references it anymore; a fresh CREATE TABLE IF NOT EXISTS above
// never runs against an existing database that still has it, so this cleans those up explicitly.
// A no-op (single fast PRAGMA read) once a database has already been migrated.
function dropJournalNotes(database: Database.Database): void {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'journal_notes'")
    .all()
  if (tables.length === 0) return

  database.exec('DROP TABLE journal_notes')
}

// photos.content_hash was added after photos already existed in the wild — a plain ADD COLUMN
// (unlike the track_points NOT NULL change above, this needs no rebuild/copy dance since SQLite
// supports adding a nullable column in place). Existing photo rows get a NULL hash, which simply
// never matches a newly-computed one, so pre-existing photos are just never considered when
// checking a new import for duplicates — no backfill needed for correctness.
function migratePhotosContentHash(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(photos)').all() as { name: string }[]
  if (columns.some((c) => c.name === 'content_hash')) return

  database.exec(`
    ALTER TABLE photos ADD COLUMN content_hash TEXT;
    CREATE INDEX IF NOT EXISTS idx_photos_track_id_content_hash ON photos(track_id, content_hash);
  `)
}

// photos.caption was added after photos already existed in the wild too — same plain nullable
// ADD COLUMN as content_hash above. Existing photo rows get a NULL caption, which just means "no
// caption yet", the same state a freshly-imported photo starts in — no backfill needed.
function migratePhotosCaption(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(photos)').all() as { name: string }[]
  if (columns.some((c) => c.name === 'caption')) return

  database.exec('ALTER TABLE photos ADD COLUMN caption TEXT')
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
