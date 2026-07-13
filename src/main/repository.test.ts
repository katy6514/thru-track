import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from './db'
import { Repository } from './repository'

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

  it('lists tracks for a trip, newest date first', () => {
    repo.importGpxTrack(
      tripId,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-01T14:00:00Z' }] })
    )
    repo.importGpxTrack(
      tripId,
      sampleGpx({ points: [{ lat: '1', lon: '1', time: '2026-07-05T14:00:00Z' }] })
    )
    const tracks = repo.listTracksForTrip(tripId)
    expect(tracks.map((t) => t.date)).toEqual(['2026-07-05', '2026-07-01'])
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
