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
