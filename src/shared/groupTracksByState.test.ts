import { describe, it, expect } from 'vitest'
import type { Track, TrackPoint } from './types'
import {
  clusterClassifications,
  groupTracksByState,
  type TrackClassification
} from './groupTracksByState'

function track(id: number, date: string): Track {
  return {
    id,
    tripId: 1,
    name: `Track ${id}`,
    date,
    startLocation: null,
    endLocation: null,
    createdAt: date
  }
}

function classification(
  id: number,
  date: string,
  dominant: string | null,
  ambiguous = false
): TrackClassification {
  return { track: track(id, date), dominant, ambiguous }
}

// A run of `count` consecutive clean (non-ambiguous) classifications for the same state, starting
// at `startId`/`startDate` and incrementing both by one per day.
function cleanRun(
  startId: number,
  startDate: string,
  count: number,
  state: string
): TrackClassification[] {
  const start = new Date(startDate)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start)
    date.setDate(date.getDate() + i)
    return classification(startId + i, date.toISOString().slice(0, 10), state)
  })
}

describe('clusterClassifications', () => {
  it('keeps a single clean state as one group', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', 'Colorado'),
      classification(2, '2026-07-02', 'Colorado'),
      classification(3, '2026-07-03', 'Colorado')
    ])
    expect(groups).toEqual([
      {
        label: 'Colorado',
        states: ['Colorado'],
        tracks: [track(1, '2026-07-01'), track(2, '2026-07-02'), track(3, '2026-07-03')]
      }
    ])
  })

  it('leaves a single clean crossing as two separate groups, not merged', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', 'Colorado'),
      classification(2, '2026-07-02', 'Colorado'),
      classification(3, '2026-07-03', 'Wyoming'),
      classification(4, '2026-07-04', 'Wyoming')
    ])
    expect(groups.map((g) => g.label)).toEqual(['Colorado', 'Wyoming'])
    expect(groups[0].tracks.map((t) => t.id)).toEqual([1, 2])
    expect(groups[1].tracks.map((t) => t.id)).toEqual([3, 4])
  })

  it('merges an oscillating border stretch (A, B, A, B, A) into one shared group', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', 'Montana'),
      classification(2, '2026-07-02', 'Idaho'),
      classification(3, '2026-07-03', 'Montana'),
      classification(4, '2026-07-04', 'Idaho'),
      classification(5, '2026-07-05', 'Montana')
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Montana / Idaho')
    expect(groups[0].states).toEqual(['Montana', 'Idaho'])
    expect(groups[0].tracks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('merges a border stretch (A, B, A) that stops before it would touch a third state', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', 'Montana'),
      classification(2, '2026-07-02', 'Idaho'),
      classification(3, '2026-07-03', 'Montana'),
      classification(4, '2026-07-04', 'Wyoming')
    ])
    expect(groups.map((g) => g.label)).toEqual(['Montana / Idaho', 'Wyoming'])
    expect(groups[0].tracks.map((t) => t.id)).toEqual([1, 2, 3])
    expect(groups[1].tracks.map((t) => t.id)).toEqual([4])
  })

  it('merges an individually ambiguous track sitting between two different clean states', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', 'Montana'),
      classification(2, '2026-07-02', 'Montana'),
      classification(3, '2026-07-03', 'Montana', true), // straddles Montana/Idaho
      classification(4, '2026-07-04', 'Idaho'),
      classification(5, '2026-07-05', 'Idaho')
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Montana / Idaho')
    expect(groups[0].tracks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('separates a border stretch from an unrelated clean state before and after it', () => {
    const groups = clusterClassifications([
      classification(1, '2026-06-28', 'Colorado'),
      classification(2, '2026-06-29', 'Colorado'),
      classification(3, '2026-07-01', 'Montana'),
      classification(4, '2026-07-02', 'Idaho'),
      classification(5, '2026-07-03', 'Montana'),
      classification(6, '2026-07-04', 'Idaho'),
      classification(7, '2026-07-06', 'Wyoming')
    ])
    expect(groups.map((g) => g.label)).toEqual(['Colorado', 'Montana / Idaho', 'Wyoming'])
    expect(groups[1].tracks.map((t) => t.id)).toEqual([3, 4, 5, 6])
  })

  it('absorbs a no-GPS track (e.g. a zero day) into the adjacent state rather than breaking the group', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', null),
      classification(2, '2026-07-02', 'Colorado'),
      classification(3, '2026-07-03', 'Colorado'),
      classification(4, '2026-07-04', null)
    ])
    expect(groups).toEqual([
      {
        label: 'Colorado',
        states: ['Colorado'],
        tracks: [
          track(1, '2026-07-01'),
          track(2, '2026-07-02'),
          track(3, '2026-07-03'),
          track(4, '2026-07-04')
        ]
      }
    ])
  })

  it('absorbs a zero day in the middle of a long settled run instead of splitting it into repeated groups (the real bug this fixes)', () => {
    const classifications = [
      ...cleanRun(1, '2024-06-16', 5, 'Montana'),
      classification(6, '2024-06-21', null),
      ...cleanRun(7, '2024-06-22', 5, 'Montana')
    ]
    const groups = clusterClassifications(classifications)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Montana')
    expect(groups[0].tracks).toHaveLength(11)
  })

  it('attaches a zero day between two different states to the preceding state, not the following one', () => {
    const groups = clusterClassifications([
      ...cleanRun(1, '2024-06-16', 3, 'Montana'),
      classification(4, '2024-06-19', null),
      ...cleanRun(5, '2024-06-20', 3, 'Idaho')
    ])
    expect(groups.map((g) => g.label)).toEqual(['Montana', 'Idaho'])
    expect(groups[0].tracks.map((t) => t.id)).toEqual([1, 2, 3, 4])
    expect(groups[1].tracks.map((t) => t.id)).toEqual([5, 6, 7])
  })

  it('groups tracks into "Other" only when no track in the trip resolves to a real state at all', () => {
    const groups = clusterClassifications([
      classification(1, '2026-07-01', null),
      classification(2, '2026-07-02', null)
    ])
    expect(groups).toEqual([
      { label: 'Other', states: [], tracks: [track(1, '2026-07-01'), track(2, '2026-07-02')] }
    ])
  })

  it('treats a lone ambiguous track with no bordering state as its own single-state group', () => {
    const groups = clusterClassifications([classification(1, '2026-07-01', 'Montana', true)])
    expect(groups).toEqual([
      { label: 'Montana', states: ['Montana'], tracks: [track(1, '2026-07-01')] }
    ])
  })

  it('returns an empty list for no tracks', () => {
    expect(clusterClassifications([])).toEqual([])
  })

  it('keeps a long settled run separate from a short border stretch next to it, even when the settled state recurs inside that stretch (real CDT-trip shape)', () => {
    // 34 clean days in Montana, then a short, genuinely mixed week hugging the Idaho line
    // (mirroring the real EXIF-derived classification of that stretch: ambiguous days
    // alternating dominant state, with one clean day sitting in the middle of it), then weeks
    // settled in Wyoming, then Colorado. Montana recurring inside the border week is exactly what
    // used to make the whole trip up to Wyoming collapse into one "Montana / Wyoming" group.
    const classifications = [
      ...cleanRun(1, '2024-06-16', 34, 'Montana'),
      classification(35, '2024-07-20', 'Idaho', true),
      classification(36, '2024-07-21', 'Montana', true),
      classification(37, '2024-07-22', 'Idaho', true),
      classification(38, '2024-07-23', 'Idaho', true),
      classification(39, '2024-07-24', 'Montana', false),
      classification(40, '2024-07-25', 'Montana', true),
      classification(41, '2024-07-26', 'Idaho', true),
      ...cleanRun(42, '2024-07-27', 22, 'Wyoming'),
      ...cleanRun(64, '2024-08-18', 10, 'Colorado')
    ]

    const groups = clusterClassifications(classifications)

    expect(groups.map((g) => g.label)).toEqual([
      'Montana',
      'Idaho / Montana',
      'Wyoming',
      'Colorado'
    ])
    expect(groups[0].tracks).toHaveLength(34)
    expect(groups[1].tracks.map((t) => t.id)).toEqual([35, 36, 37, 38, 39, 40, 41])
    expect(groups[2].tracks).toHaveLength(22)
    expect(groups[3].tracks).toHaveLength(10)
  })
})

describe('groupTracksByState (integration, real coordinates)', () => {
  function pointsAt(lat: number, lng: number, count = 5): TrackPoint[] {
    return Array.from({ length: count }, (_, i) => ({
      lat: lat + i * 0.001,
      lng: lng + i * 0.001,
      elevation: null,
      timestamp: null
    }))
  }

  it('classifies real tracks by their own sampled coordinates', () => {
    const denver = track(1, '2026-07-01')
    const cheyenne = track(2, '2026-07-02')
    const pointsByTrackId = new Map<number, TrackPoint[]>([
      [denver.id, pointsAt(39.7392, -104.9903)], // Denver, CO
      [cheyenne.id, pointsAt(41.14, -104.8202)] // Cheyenne, WY
    ])

    const groups = groupTracksByState([denver, cheyenne], pointsByTrackId)

    expect(groups.map((g) => g.label)).toEqual(['Colorado', 'Wyoming'])
  })

  it('treats a track with no points as unresolvable', () => {
    const groups = groupTracksByState([track(1, '2026-07-01')], new Map())
    expect(groups).toEqual([{ label: 'Other', states: [], tracks: [track(1, '2026-07-01')] }])
  })
})
