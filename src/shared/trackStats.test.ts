import { describe, it, expect } from 'vitest'
import { computeTrackStats } from './trackStats'
import type { TrackPoint } from './types'

function point(
  lat: number,
  lng: number,
  elevation: number | null,
  timestamp: string | null
): TrackPoint {
  return { lat, lng, elevation, timestamp }
}

describe('computeTrackStats', () => {
  it('returns zero distance and null elevation gain for an empty track', () => {
    expect(computeTrackStats([])).toEqual({ distanceMiles: 0, elevationGainFeet: null })
  })

  it('returns zero distance for a single point', () => {
    const stats = computeTrackStats([point(46.85, -121.75, 1000, '2026-07-01T14:00:00Z')])
    expect(stats.distanceMiles).toBe(0)
  })

  it('computes ~69.09 miles for one degree of latitude — a known reference distance', () => {
    // One degree of latitude is a constant great-circle distance regardless of where on Earth,
    // unlike longitude (which shrinks toward the poles) — makes it a reliable sanity check for
    // the haversine formula itself, independent of anything else in this module.
    const stats = computeTrackStats([
      point(0, 0, null, '2026-07-01T14:00:00Z'),
      point(1, 0, null, '2026-07-01T14:05:00Z')
    ])
    expect(stats.distanceMiles).toBeCloseTo(69.093, 1)
  })

  it('sums distance across multiple legs', () => {
    const stats = computeTrackStats([
      point(0, 0, null, '2026-07-01T14:00:00Z'),
      point(1, 0, null, '2026-07-01T14:05:00Z'),
      point(2, 0, null, '2026-07-01T14:10:00Z')
    ])
    expect(stats.distanceMiles).toBeCloseTo(69.093 * 2, 1)
  })

  it('does not count distance across a recording gap', () => {
    const withGap = computeTrackStats([
      point(0, 0, null, '2026-07-01T14:00:00Z'),
      point(1, 0, null, '2026-07-01T15:00:00Z') // 1 hour later — well past the 15-min gap threshold
    ])
    // Each point is its own segment (no consecutive pair within one segment), so no distance
    // gets attributed to the "teleport" between them.
    expect(withGap.distanceMiles).toBe(0)
  })

  it('returns null elevation gain when no point has elevation data', () => {
    const stats = computeTrackStats([
      point(0, 0, null, '2026-07-01T14:00:00Z'),
      point(0.001, 0, null, '2026-07-01T14:01:00Z')
    ])
    expect(stats.elevationGainFeet).toBeNull()
  })

  it('only counts ascents toward elevation gain, ignoring descents', () => {
    const stats = computeTrackStats([
      point(0, 0, 1000, '2026-07-01T14:00:00Z'),
      point(0.001, 0, 1100, '2026-07-01T14:01:00Z'), // +100m
      point(0.002, 0, 1050, '2026-07-01T14:02:00Z'), // -50m, not counted
      point(0.003, 0, 1200, '2026-07-01T14:03:00Z') // +150m
    ])
    // Total ascent: 100m + 150m = 250m
    expect(stats.elevationGainFeet).toBeCloseTo(250 * 3.28084, 1)
  })

  it('returns 0 elevation gain (not null) when elevation data exists but never climbs', () => {
    const stats = computeTrackStats([
      point(0, 0, 1000, '2026-07-01T14:00:00Z'),
      point(0.001, 0, 900, '2026-07-01T14:01:00Z')
    ])
    expect(stats.elevationGainFeet).toBe(0)
  })

  it('treats a timeless track as one unbroken segment', () => {
    const stats = computeTrackStats([
      point(0, 0, 1000, null),
      point(1, 0, 1100, null),
      point(2, 0, 1200, null)
    ])
    expect(stats.distanceMiles).toBeCloseTo(69.093 * 2, 1)
    expect(stats.elevationGainFeet).toBeCloseTo(200 * 3.28084, 1)
  })
})
