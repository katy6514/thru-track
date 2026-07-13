import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
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
