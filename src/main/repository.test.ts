import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from './db'
import { Repository, DateRequiredError, inferDateFromFilename } from './repository'

describe('Repository trip CRUD', () => {
  let repo: Repository

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
  })

  it('creates a trip and returns it with timestamps', () => {
    const trip = repo.createTrip('PCT 2026')
    expect(trip.name).toBe('PCT 2026')
    expect(trip.id).toBeTypeOf('number')
    expect(trip.createdAt).toBe(trip.updatedAt)
  })

  it('trims whitespace from the trip name', () => {
    const trip = repo.createTrip('  PCT 2026  ')
    expect(trip.name).toBe('PCT 2026')
  })

  it('rejects an empty or whitespace-only trip name', () => {
    expect(() => repo.createTrip('')).toThrow()
    expect(() => repo.createTrip('   ')).toThrow()
  })

  it('lists trips newest first', () => {
    const first = repo.createTrip('Older Trip')
    const second = repo.createTrip('Newer Trip')
    const trips = repo.listTrips()
    expect(trips.map((t) => t.id)).toEqual([second.id, first.id])
  })

  it('renames a trip and updates updatedAt', () => {
    const trip = repo.createTrip('Original Name')
    const renamed = repo.renameTrip(trip.id, 'New Name')
    expect(renamed.name).toBe('New Name')
    expect(renamed.id).toBe(trip.id)
  })

  it('throws when renaming a trip that does not exist', () => {
    expect(() => repo.renameTrip(999, 'New Name')).toThrow()
  })

  it('deletes a trip', () => {
    const trip = repo.createTrip('To Delete')
    repo.deleteTrip(trip.id)
    expect(repo.listTrips()).toEqual([])
  })

  it('throws when deleting a trip that does not exist', () => {
    expect(() => repo.deleteTrip(999)).toThrow()
  })
})

function sampleGpx({
  name = 'Day 1',
  points = [
    { lat: '46.85', lon: '-121.75', time: '2026-07-01T14:00:00Z' },
    { lat: '46.86', lon: '-121.76', time: '2026-07-01T14:01:00Z' }
  ]
}: { name?: string; points?: { lat: string; lon: string; time: string }[] } = {}): string {
  const trkpts = points
    .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.time}</time></trkpt>`)
    .join('\n')
  return `<?xml version="1.0"?><gpx><trk><name>${name}</name><trkseg>${trkpts}</trkseg></trk></gpx>`
}

describe('Repository track import', () => {
  let repo: Repository
  let tripId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    tripId = repo.createTrip('PCT 2026').id
  })

  it('imports a GPX file into a track with its points', () => {
    const track = repo.importGpxTrack(tripId, sampleGpx())

    expect(track.tripId).toBe(tripId)
    expect(track.name).toBe('Day 1')
    expect(track.date).toBe('2026-07-01')

    const points = repo.getTrackPoints(track.id)
    expect(points).toEqual([
      { lat: 46.85, lng: -121.75, elevation: null, timestamp: '2026-07-01T14:00:00Z' },
      { lat: 46.86, lng: -121.76, elevation: null, timestamp: '2026-07-01T14:01:00Z' }
    ])
  })

  it('falls back to the track date as the name when GPX has no <name>', () => {
    const track = repo.importGpxTrack(tripId, sampleGpx({ name: '' }))
    expect(track.name).toBe('2026-07-01')
  })

  it('lists tracks for a trip, oldest date first', () => {
    repo.importGpxTrack(
      tripId,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-05T14:00:00Z' }] })
    )
    repo.importGpxTrack(
      tripId,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-01T14:00:00Z' }] })
    )
    const tracks = repo.listTracksForTrip(tripId)
    expect(tracks.map((t) => t.date)).toEqual(['2026-07-01', '2026-07-05'])
  })

  it('does not list tracks belonging to a different trip', () => {
    const otherTripId = repo.createTrip('Other Trip').id
    repo.importGpxTrack(otherTripId, sampleGpx())
    expect(repo.listTracksForTrip(tripId)).toEqual([])
  })

  it('propagates a clear error for malformed GPX without creating a track', () => {
    expect(() => repo.importGpxTrack(tripId, 'not gpx at all')).toThrow()
    expect(repo.listTracksForTrip(tripId)).toEqual([])
  })

  it('throws when importing a track into a trip that does not exist', () => {
    expect(() => repo.importGpxTrack(999, sampleGpx())).toThrow()
  })
})

function timelessGpx(name = 'Retraced Route'): string {
  return `<?xml version="1.0"?><gpx><trk><name>${name}</name><trkseg>
    <trkpt lat="46.85" lon="-121.75"></trkpt>
    <trkpt lat="46.86" lon="-121.76"></trkpt>
  </trkseg></trk></gpx>`
}

describe('inferDateFromFilename', () => {
  it('extracts a YYYY-MM-DD pattern', () => {
    expect(inferDateFromFilename('2026-07-01-track.gpx')).toBe('2026-07-01')
  })

  it('extracts a YYYY_MM_DD pattern', () => {
    expect(inferDateFromFilename('2026_07_01_track.gpx')).toBe('2026-07-01')
  })

  it('extracts a compact YYYYMMDD pattern', () => {
    expect(inferDateFromFilename('20260701.gpx')).toBe('2026-07-01')
  })

  it('returns null when no pattern matches', () => {
    expect(inferDateFromFilename('Untitled.gpx')).toBeNull()
  })

  it('returns null for an implausible date (rejects false-positive digit runs)', () => {
    expect(inferDateFromFilename('track-99999999.gpx')).toBeNull()
  })
})

describe('Repository timeless track import', () => {
  let repo: Repository
  let tripId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    tripId = repo.createTrip('PCT 2026').id
  })

  it('imports a timeless track using a date inferred from the filename', () => {
    const track = repo.importGpxTrack(tripId, timelessGpx(), { filename: '2026-07-01-caltopo.gpx' })
    expect(track.date).toBe('2026-07-01')
    expect(track.name).toBe('Retraced Route')
  })

  it('imports a timeless track using an explicit date override', () => {
    const track = repo.importGpxTrack(tripId, timelessGpx(), { date: '2026-07-04' })
    expect(track.date).toBe('2026-07-04')
  })

  it('an explicit date override wins over filename inference', () => {
    const track = repo.importGpxTrack(tripId, timelessGpx(), {
      filename: '2026-07-01-caltopo.gpx',
      date: '2026-07-09'
    })
    expect(track.date).toBe('2026-07-09')
  })

  it('throws DateRequiredError when no date can be determined at all', () => {
    expect(() => repo.importGpxTrack(tripId, timelessGpx())).toThrow(DateRequiredError)
    expect(() => repo.importGpxTrack(tripId, timelessGpx(), { filename: 'Untitled.gpx' })).toThrow(
      DateRequiredError
    )
    expect(repo.listTracksForTrip(tripId)).toEqual([])
  })

  it('stores timeless track points with a null timestamp, preserving file order', () => {
    const track = repo.importGpxTrack(tripId, timelessGpx(), { date: '2026-07-01' })
    const points = repo.getTrackPoints(track.id)
    expect(points).toEqual([
      { lat: 46.85, lng: -121.75, elevation: null, timestamp: null },
      { lat: 46.86, lng: -121.76, elevation: null, timestamp: null }
    ])
  })

  it("a live-timestamped track's own GPS time wins even if a date override is also passed", () => {
    const track = repo.importGpxTrack(tripId, sampleGpx(), { date: '1999-01-01' })
    expect(track.date).toBe('2026-07-01')
  })
})

describe('Repository journal entries', () => {
  let repo: Repository
  let trackId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    const tripId = repo.createTrip('PCT 2026').id
    trackId = repo.importGpxTrack(tripId, sampleGpx()).id
  })

  it('returns null for a track with no entry yet', () => {
    expect(repo.getEntry(trackId)).toBeNull()
  })

  it('creates a new entry on first save', () => {
    const entry = repo.saveEntry(trackId, 'Long climb, great views at the top.')
    expect(entry.trackId).toBe(trackId)
    expect(entry.text).toBe('Long climb, great views at the top.')
    expect(entry.id).toBeTypeOf('number')

    expect(repo.getEntry(trackId)).toEqual(entry)
  })

  it('upserts: saving again updates the same row instead of creating a second one', () => {
    const first = repo.saveEntry(trackId, 'Draft one.')
    const second = repo.saveEntry(trackId, 'Final version of the entry.')

    expect(second.id).toBe(first.id)
    expect(second.text).toBe('Final version of the entry.')
    expect(repo.getEntry(trackId)?.text).toBe('Final version of the entry.')
  })

  it('allows saving empty text (clearing an entry is a valid state, not an error)', () => {
    repo.saveEntry(trackId, 'Something to say.')
    const cleared = repo.saveEntry(trackId, '')
    expect(cleared.text).toBe('')
    expect(repo.getEntry(trackId)?.text).toBe('')
  })

  it('keeps entries for different tracks independent', () => {
    const otherTrackId = repo.importGpxTrack(
      repo.createTrip('Other Trip').id,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-02T14:00:00Z' }] })
    ).id

    repo.saveEntry(trackId, 'Entry for track one.')
    repo.saveEntry(otherTrackId, 'Entry for track two.')

    expect(repo.getEntry(trackId)?.text).toBe('Entry for track one.')
    expect(repo.getEntry(otherTrackId)?.text).toBe('Entry for track two.')
  })

  it('throws when saving an entry for a track that does not exist', () => {
    expect(() => repo.saveEntry(999, 'orphan entry')).toThrow()
  })

  it('returns null for a track id that does not exist', () => {
    expect(repo.getEntry(999)).toBeNull()
  })
})

describe('Repository journal notes', () => {
  let repo: Repository
  let trackId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    const tripId = repo.createTrip('PCT 2026').id
    trackId = repo.importGpxTrack(tripId, sampleGpx()).id
  })

  it('returns an empty list for a track with no notes yet', () => {
    expect(repo.listNotesForTrack(trackId)).toEqual([])
  })

  it('creates a note with a timestamp', () => {
    const note = repo.createNote(trackId, 'Great view here', '2026-07-01T14:00:30Z')
    expect(note.trackId).toBe(trackId)
    expect(note.content).toBe('Great view here')
    expect(note.timestamp).toBe('2026-07-01T14:00:30Z')
    expect(note.id).toBeTypeOf('number')

    expect(repo.listNotesForTrack(trackId)).toEqual([note])
  })

  it('creates a note with a null timestamp (the timeless-track case)', () => {
    const note = repo.createNote(trackId, 'No specific time for this one', null)
    expect(note.timestamp).toBeNull()
  })

  it('trims whitespace from note content', () => {
    const note = repo.createNote(trackId, '  Trimmed  ', null)
    expect(note.content).toBe('Trimmed')
  })

  it('rejects empty or whitespace-only note content', () => {
    expect(() => repo.createNote(trackId, '', null)).toThrow()
    expect(() => repo.createNote(trackId, '   ', null)).toThrow()
  })

  it('lists notes for a track ordered by timestamp ascending', () => {
    repo.createNote(trackId, 'Second', '2026-07-01T15:00:00Z')
    repo.createNote(trackId, 'First', '2026-07-01T14:00:00Z')
    const notes = repo.listNotesForTrack(trackId)
    expect(notes.map((n) => n.content)).toEqual(['First', 'Second'])
  })

  it('does not list notes belonging to a different track', () => {
    const otherTrackId = repo.importGpxTrack(
      repo.createTrip('Other Trip').id,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-02T14:00:00Z' }] })
    ).id

    repo.createNote(trackId, 'Note for track one', null)
    repo.createNote(otherTrackId, 'Note for track two', null)

    expect(repo.listNotesForTrack(trackId).map((n) => n.content)).toEqual(['Note for track one'])
    expect(repo.listNotesForTrack(otherTrackId).map((n) => n.content)).toEqual([
      'Note for track two'
    ])
  })

  it('throws when creating a note for a track that does not exist', () => {
    expect(() => repo.createNote(999, 'orphan note', null)).toThrow()
  })
})

describe('Repository photos', () => {
  let repo: Repository
  let trackId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    const tripId = repo.createTrip('PCT 2026').id
    trackId = repo.importGpxTrack(tripId, sampleGpx()).id
  })

  it('returns an empty list for a track with no photos yet', () => {
    expect(repo.listPhotosForTrack(trackId)).toEqual([])
  })

  it('creates a photo with a timestamp and position', () => {
    const photo = repo.createPhoto(
      trackId,
      '/managed/track-1-abc.jpg',
      '2026-07-01T14:00:30Z',
      46.85,
      -121.75,
      'hash-abc'
    )
    expect(photo.trackId).toBe(trackId)
    expect(photo.filepath).toBe('/managed/track-1-abc.jpg')
    expect(photo.timestamp).toBe('2026-07-01T14:00:30Z')
    expect(photo.lat).toBe(46.85)
    expect(photo.lng).toBe(-121.75)
    expect(photo.id).toBeTypeOf('number')

    expect(repo.listPhotosForTrack(trackId)).toEqual([photo])
  })

  it('creates a photo with a null timestamp and null position (no EXIF GPS on a timeless track)', () => {
    const photo = repo.createPhoto(trackId, '/managed/track-1-def.jpg', null, null, null, null)
    expect(photo.timestamp).toBeNull()
    expect(photo.lat).toBeNull()
    expect(photo.lng).toBeNull()
  })

  it('lists photos for a track ordered by timestamp ascending', () => {
    repo.createPhoto(trackId, '/managed/second.jpg', '2026-07-01T15:00:00Z', 1, 1, null)
    repo.createPhoto(trackId, '/managed/first.jpg', '2026-07-01T14:00:00Z', 1, 1, null)
    const photos = repo.listPhotosForTrack(trackId)
    expect(photos.map((p) => p.filepath)).toEqual(['/managed/first.jpg', '/managed/second.jpg'])
  })

  it('does not list photos belonging to a different track', () => {
    const otherTrackId = repo.importGpxTrack(
      repo.createTrip('Other Trip').id,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-02T14:00:00Z' }] })
    ).id

    repo.createPhoto(trackId, '/managed/track-one.jpg', null, null, null, null)
    repo.createPhoto(otherTrackId, '/managed/track-two.jpg', null, null, null, null)

    expect(repo.listPhotosForTrack(trackId).map((p) => p.filepath)).toEqual([
      '/managed/track-one.jpg'
    ])
    expect(repo.listPhotosForTrack(otherTrackId).map((p) => p.filepath)).toEqual([
      '/managed/track-two.jpg'
    ])
  })

  it('gets a single photo by id', () => {
    const created = repo.createPhoto(trackId, '/managed/one.jpg', null, null, null, null)
    expect(repo.getPhoto(created.id)).toEqual(created)
  })

  it('returns null when getting a photo that does not exist', () => {
    expect(repo.getPhoto(999)).toBeNull()
  })

  it('throws when creating a photo for a track that does not exist', () => {
    expect(() => repo.createPhoto(999, '/managed/orphan.jpg', null, null, null, null)).toThrow()
  })

  it("recognizes a content hash already stored for the track, but not a track that doesn't have it", () => {
    repo.createPhoto(trackId, '/managed/dup-source.jpg', null, null, null, 'hash-1')
    expect(repo.photoContentHashExists(trackId, 'hash-1')).toBe(true)
    expect(repo.photoContentHashExists(trackId, 'hash-2')).toBe(false)
  })

  it('scopes a content hash check to the track, not globally', () => {
    const otherTrackId = repo.importGpxTrack(
      repo.createTrip('Other Trip').id,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-02T14:00:00Z' }] })
    ).id
    repo.createPhoto(otherTrackId, '/managed/elsewhere.jpg', null, null, null, 'hash-shared')
    expect(repo.photoContentHashExists(trackId, 'hash-shared')).toBe(false)
  })
})

function sampleInreachCsv({
  rows = [
    { time: '2026-07-01T14:00:00Z', lat: '46.85', lng: '-121.75', text: 'At the trailhead' },
    { time: '2026-07-01T16:30:00Z', lat: '46.90', lng: '-121.80', text: 'Reached the ridge' }
  ]
}: { rows?: { time: string; lat: string; lng: string; text: string }[] } = {}): string {
  const header = 'Time UTC,Latitude,Longitude,Text'
  const dataRows = rows.map((r) => `${r.time},${r.lat},${r.lng},${r.text}`)
  return [header, ...dataRows].join('\n')
}

describe('Repository messages', () => {
  let repo: Repository
  let trackId: number

  beforeEach(() => {
    const db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
    const tripId = repo.createTrip('PCT 2026').id
    trackId = repo.importGpxTrack(tripId, sampleGpx()).id
  })

  it('returns an empty list for a track with no messages yet', () => {
    expect(repo.listMessagesForTrack(trackId)).toEqual([])
  })

  it('imports messages from an inReach CSV export', () => {
    const messages = repo.importInreachMessages(trackId, sampleInreachCsv())

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      trackId,
      content: 'At the trailhead',
      timestamp: '2026-07-01T14:00:00.000Z',
      lat: 46.85,
      lng: -121.75,
      source: 'inreach'
    })
    expect(messages[0].id).toBeTypeOf('number')

    expect(repo.listMessagesForTrack(trackId)).toEqual(messages)
  })

  it('lists messages for a track ordered by timestamp ascending', () => {
    repo.importInreachMessages(
      trackId,
      sampleInreachCsv({
        rows: [
          { time: '2026-07-01T16:00:00Z', lat: '46.9', lng: '-121.8', text: 'Second' },
          { time: '2026-07-01T14:00:00Z', lat: '46.85', lng: '-121.75', text: 'First' }
        ]
      })
    )
    const messages = repo.listMessagesForTrack(trackId)
    expect(messages.map((m) => m.content)).toEqual(['First', 'Second'])
  })

  it('does not list messages belonging to a different track', () => {
    const otherTrackId = repo.importGpxTrack(
      repo.createTrip('Other Trip').id,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-02T14:00:00Z' }] })
    ).id

    repo.importInreachMessages(
      trackId,
      sampleInreachCsv({
        rows: [{ time: '2026-07-01T14:00:00Z', lat: '46.85', lng: '-121.75', text: 'For track one' }]
      })
    )
    repo.importInreachMessages(
      otherTrackId,
      sampleInreachCsv({
        rows: [{ time: '2026-07-02T14:00:00Z', lat: '46.85', lng: '-121.75', text: 'For track two' }]
      })
    )

    expect(repo.listMessagesForTrack(trackId).map((m) => m.content)).toEqual(['For track one'])
    expect(repo.listMessagesForTrack(otherTrackId).map((m) => m.content)).toEqual(['For track two'])
  })

  it('propagates a clear error for a malformed CSV without creating any messages', () => {
    expect(() => repo.importInreachMessages(trackId, 'not a csv at all')).toThrow()
    expect(repo.listMessagesForTrack(trackId)).toEqual([])
  })

  it('throws when importing messages for a track that does not exist', () => {
    expect(() => repo.importInreachMessages(999, sampleInreachCsv())).toThrow()
  })
})

describe('Repository cascade deletion', () => {
  let db: Database.Database
  let repo: Repository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
    repo = new Repository(db)
  })

  // Builds a fully-populated track (points come from the GPX import itself) plus one of every
  // child row type this track owns: an entry, a journal note, two photos, and a message.
  function buildFullTrack(tripId: number, label: string): { trackId: number; photoPaths: string[] } {
    const track = repo.importGpxTrack(tripId, sampleGpx({ name: `${label} track` }))
    repo.saveEntry(track.id, `${label} entry text`)
    repo.createNote(track.id, `${label} note`, '2026-07-01T14:00:30Z')
    const photoA = repo.createPhoto(track.id, `/managed/${label}-a.jpg`, null, null, null, null)
    const photoB = repo.createPhoto(track.id, `/managed/${label}-b.jpg`, null, 46.85, -121.75, null)
    repo.importInreachMessages(track.id, sampleInreachCsv())
    return { trackId: track.id, photoPaths: [photoA.filepath, photoB.filepath] }
  }

  function trackChildRowCounts(trackId: number): Record<string, number> {
    const count = (table: string): number =>
      (
        db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE track_id = ?`).get(trackId) as {
          c: number
        }
      ).c
    return {
      track_points: count('track_points'),
      entries: count('entries'),
      journal_notes: count('journal_notes'),
      photos: count('photos'),
      messages: count('messages')
    }
  }

  function trackRowExists(trackId: number): boolean {
    return db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(trackId) !== undefined
  }

  describe('deleteTrack', () => {
    it('removes the track row and every child row, and returns its photo filepaths', () => {
      const tripId = repo.createTrip('PCT 2026').id
      const { trackId, photoPaths } = buildFullTrack(tripId, 'day-one')

      const result = repo.deleteTrack(trackId)

      expect(result.deletedPhotoFilepaths.sort()).toEqual([...photoPaths].sort())
      expect(trackRowExists(trackId)).toBe(false)
      expect(trackChildRowCounts(trackId)).toEqual({
        track_points: 0,
        entries: 0,
        journal_notes: 0,
        photos: 0,
        messages: 0
      })
    })

    it('leaves a sibling track (same trip) completely unaffected', () => {
      const tripId = repo.createTrip('PCT 2026').id
      const { trackId: deletedId } = buildFullTrack(tripId, 'day-one')
      const { trackId: siblingId } = buildFullTrack(tripId, 'day-two')

      repo.deleteTrack(deletedId)

      expect(trackRowExists(siblingId)).toBe(true)
      expect(trackChildRowCounts(siblingId)).toEqual({
        track_points: 2,
        entries: 1,
        journal_notes: 1,
        photos: 2,
        messages: 2
      })
    })

    it('leaves a track in a different trip completely unaffected', () => {
      const tripId = repo.createTrip('PCT 2026').id
      const otherTripId = repo.createTrip('Other Trip').id
      const { trackId: deletedId } = buildFullTrack(tripId, 'day-one')
      const { trackId: otherId } = buildFullTrack(otherTripId, 'other-trip-day')

      repo.deleteTrack(deletedId)

      expect(trackRowExists(otherId)).toBe(true)
      expect(trackChildRowCounts(otherId).photos).toBe(2)
    })

    it('throws when deleting a track that does not exist', () => {
      expect(() => repo.deleteTrack(999)).toThrow()
    })
  })

  describe('deleteTrip', () => {
    it('cascades through every track under the trip and removes the trip itself', () => {
      const tripId = repo.createTrip('PCT 2026').id
      const { trackId: track1Id, photoPaths: photos1 } = buildFullTrack(tripId, 'day-one')
      const { trackId: track2Id, photoPaths: photos2 } = buildFullTrack(tripId, 'day-two')

      const result = repo.deleteTrip(tripId)

      expect(result.deletedPhotoFilepaths.sort()).toEqual([...photos1, ...photos2].sort())
      expect(trackRowExists(track1Id)).toBe(false)
      expect(trackRowExists(track2Id)).toBe(false)
      expect(trackChildRowCounts(track1Id)).toEqual({
        track_points: 0,
        entries: 0,
        journal_notes: 0,
        photos: 0,
        messages: 0
      })
      expect(trackChildRowCounts(track2Id)).toEqual({
        track_points: 0,
        entries: 0,
        journal_notes: 0,
        photos: 0,
        messages: 0
      })
      expect(repo.listTrips().map((t) => t.id)).not.toContain(tripId)
    })

    it('leaves a different trip and its tracks completely unaffected', () => {
      const tripId = repo.createTrip('PCT 2026').id
      const otherTripId = repo.createTrip('Other Trip').id
      buildFullTrack(tripId, 'day-one')
      const { trackId: otherTrackId } = buildFullTrack(otherTripId, 'other-trip-day')

      repo.deleteTrip(tripId)

      expect(trackRowExists(otherTrackId)).toBe(true)
      expect(repo.listTrips().map((t) => t.id)).toContain(otherTripId)
      expect(trackChildRowCounts(otherTrackId).photos).toBe(2)
    })

    it('throws when deleting a trip that does not exist', () => {
      expect(() => repo.deleteTrip(999)).toThrow()
    })
  })
})
