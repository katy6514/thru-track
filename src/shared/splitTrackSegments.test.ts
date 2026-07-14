import { describe, it, expect } from 'vitest'
import { splitTrackIntoSegments } from './splitTrackSegments'
import type { TrackPoint } from './types'

function point(timestamp: string | null, lat = 0, lng = 0): TrackPoint {
  return { lat, lng, elevation: null, timestamp }
}

describe('splitTrackIntoSegments', () => {
  it('returns a single segment when there are no gaps', () => {
    const points = [
      point('2026-07-01T14:00:00Z'),
      point('2026-07-01T14:01:00Z'),
      point('2026-07-01T14:02:00Z')
    ]

    const segments = splitTrackIntoSegments(points)

    expect(segments).toEqual([points])
  })

  it('splits into two segments at a gap larger than the threshold', () => {
    const first = point('2026-07-01T14:00:00Z')
    const second = point('2026-07-01T14:01:00Z')
    // 16 minutes later — past the 15 minute threshold.
    const third = point('2026-07-01T14:17:00Z')

    const segments = splitTrackIntoSegments([first, second, third])

    expect(segments).toEqual([[first, second], [third]])
  })

  it('does not split at a gap smaller than the threshold', () => {
    const first = point('2026-07-01T14:00:00Z')
    // 14 minutes later — just under the 15 minute threshold.
    const second = point('2026-07-01T14:14:00Z')

    const segments = splitTrackIntoSegments([first, second])

    expect(segments).toEqual([[first, second]])
  })

  it('splits into more than two segments when there are multiple gaps', () => {
    const a = point('2026-07-01T08:00:00Z')
    const b = point('2026-07-01T08:01:00Z')
    const c = point('2026-07-01T09:00:00Z') // gap after b
    const d = point('2026-07-01T09:01:00Z')
    const e = point('2026-07-01T12:00:00Z') // gap after d

    const segments = splitTrackIntoSegments([a, b, c, d, e])

    expect(segments).toEqual([[a, b], [c, d], [e]])
  })

  it('returns a single single-point segment for a single point', () => {
    const only = point('2026-07-01T14:00:00Z')
    expect(splitTrackIntoSegments([only])).toEqual([[only]])
  })

  it('returns an empty array for an empty input', () => {
    expect(splitTrackIntoSegments([])).toEqual([])
  })

  it('returns a single unbroken segment for a timeless track, regardless of point count', () => {
    const points = [point(null, 1, 1), point(null, 2, 2), point(null, 3, 3)]
    expect(splitTrackIntoSegments(points)).toEqual([points])
  })
})
