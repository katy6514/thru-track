import { describe, it, expect } from 'vitest'
import { interpolatePosition } from './positionInterpolator'
import type { TrackPoint } from '../../shared/types'

function point(timestamp: string, lat: number, lng: number): TrackPoint {
  return { lat, lng, elevation: null, timestamp }
}

describe('interpolatePosition', () => {
  const points = [
    point('2026-07-01T14:00:00Z', 46.8, -121.7),
    point('2026-07-01T14:10:00Z', 46.9, -121.8)
  ]

  it('interpolates the midpoint proportionally by time', () => {
    const midMs = Date.parse('2026-07-01T14:05:00Z')
    const result = interpolatePosition(points, midMs)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.lat).toBeCloseTo(46.85, 5)
      expect(result.lng).toBeCloseTo(-121.75, 5)
    }
  })

  it('interpolates a non-midpoint proportionally', () => {
    // 25% of the way from 14:00 to 14:10.
    const ms = Date.parse('2026-07-01T14:02:30Z')
    const result = interpolatePosition(points, ms)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.lat).toBeCloseTo(46.825, 5)
      expect(result.lng).toBeCloseTo(-121.725, 5)
    }
  })

  it('returns the exact point when the timestamp matches one precisely', () => {
    const ms = Date.parse('2026-07-01T14:00:00Z')
    expect(interpolatePosition(points, ms)).toEqual({ status: 'ok', lat: 46.8, lng: -121.7 })
  })

  it('returns out-of-range for a timestamp before the first point', () => {
    const ms = Date.parse('2026-07-01T13:00:00Z')
    expect(interpolatePosition(points, ms)).toEqual({ status: 'out-of-range' })
  })

  it('returns out-of-range for a timestamp after the last point', () => {
    const ms = Date.parse('2026-07-01T15:00:00Z')
    expect(interpolatePosition(points, ms)).toEqual({ status: 'out-of-range' })
  })

  it('returns out-of-range for an empty track', () => {
    expect(interpolatePosition([], Date.parse('2026-07-01T14:00:00Z'))).toEqual({
      status: 'out-of-range'
    })
  })

  it('returns gap for a timestamp inside a recording gap larger than the threshold', () => {
    const gappy = [
      point('2026-07-01T14:00:00Z', 1, 1),
      point('2026-07-01T14:30:00Z', 2, 2) // 30 min gap, past the 15 min threshold
    ]
    const midGapMs = Date.parse('2026-07-01T14:15:00Z')
    expect(interpolatePosition(gappy, midGapMs)).toEqual({ status: 'gap' })
  })

  it('still interpolates across a gap smaller than the threshold', () => {
    const closeEnough = [
      point('2026-07-01T14:00:00Z', 1, 1),
      point('2026-07-01T14:10:00Z', 2, 2) // 10 min — under the 15 min threshold
    ]
    const midMs = Date.parse('2026-07-01T14:05:00Z')
    expect(interpolatePosition(closeEnough, midMs)).toEqual({ status: 'ok', lat: 1.5, lng: 1.5 })
  })
})
