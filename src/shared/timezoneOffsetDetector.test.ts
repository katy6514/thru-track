import { describe, it, expect } from 'vitest'
import {
  detectTimezoneOffset,
  suggestBetterTrack,
  type TrackTimeRange
} from './timezoneOffsetDetector'

describe('detectTimezoneOffset', () => {
  const trackStart = '2026-07-01T14:00:00Z'
  const trackEnd = '2026-07-01T20:00:00Z' // a 6-hour hiking day; midpoint is 17:00Z

  it('proposes 0 when a single photo timestamp exactly matches the track midpoint', () => {
    // Absent any other signal, assuming a lone photo landed roughly mid-hike is as reasonable a
    // default as assuming it landed at the very start — and it's what keeps a batch of many
    // photos spread across the day (see the regression tests below) correct.
    expect(detectTimezoneOffset(trackStart, trackEnd, ['2026-07-01T17:00:00Z'])).toEqual({
      offsetMinutes: 0
    })
  })

  it('proposes a whole-hour offset for a single photo', () => {
    expect(detectTimezoneOffset(trackStart, trackEnd, ['2026-07-01T19:00:00Z'])).toEqual({
      offsetMinutes: 120
    })
  })

  it('proposes a half-hour offset', () => {
    // e.g. a camera clock left set to an Indian Standard Time-style UTC+5:30 zone.
    expect(detectTimezoneOffset(trackStart, trackEnd, ['2026-07-01T19:30:00Z'])).toEqual({
      offsetMinutes: 150
    })
  })

  it('rounds a small raw difference down to no meaningful offset', () => {
    // A couple of minutes of ordinary clock drift between the GPS recorder and the camera —
    // should not propose a spurious tiny correction.
    expect(detectTimezoneOffset(trackStart, trackEnd, ['2026-07-01T17:03:00Z'])).toEqual({
      offsetMinutes: 0
    })
  })

  it('detects a negative offset when the camera clock reads earlier than the track', () => {
    expect(detectTimezoneOffset(trackStart, trackEnd, ['2026-07-01T16:00:00Z'])).toEqual({
      offsetMinutes: -60
    })
  })

  it('proposes 0 when given no photo timestamps at all', () => {
    expect(detectTimezoneOffset(trackStart, trackEnd, [])).toEqual({ offsetMinutes: 0 })
  })

  it('skips an unparseable timestamp rather than letting it corrupt the batch', () => {
    expect(
      detectTimezoneOffset(trackStart, trackEnd, ['not a date', '2026-07-01T19:00:00Z'])
    ).toEqual({ offsetMinutes: 120 })
  })

  // Regression tests for the real bug this rewrite fixes: comparing every photo against the
  // track's fixed *start* (rather than the batch's own midpoint vs. the track's midpoint) meant a
  // photo taken hours into the hike produced a spurious multi-hour "offset" purely because of how
  // far into the day it was taken — nothing to do with the camera's actual clock. A real batch
  // hit this: one photo 7 hours into a hike produced a bogus +450-minute "correction" that then
  // got applied to the whole batch, corrupting photos that never needed it.
  it('does not mistake elapsed hike time for a clock offset across a spread-out batch', () => {
    // Every photo's clock is genuinely correct — just taken at different points across the
    // 6-hour hiking day, including close to both the start and the end.
    const photoTimestamps = [
      '2026-07-01T14:05:00Z', // 5 min into the hike
      '2026-07-01T17:00:00Z', // 3 hours in (the midpoint)
      '2026-07-01T19:55:00Z' // nearly at the end
    ]
    expect(detectTimezoneOffset(trackStart, trackEnd, photoTimestamps)).toEqual({
      offsetMinutes: 0
    })
  })

  it('still detects a real constant offset across a batch spread through the day', () => {
    // Same spread as above, but every photo's clock reads a consistent 2 hours ahead regardless
    // of when during the hike each one was actually taken.
    const photoTimestamps = [
      '2026-07-01T16:05:00Z', // 5 min in + 2h
      '2026-07-01T19:00:00Z', // 3h in (midpoint) + 2h
      '2026-07-01T21:55:00Z' // near the end + 2h
    ]
    expect(detectTimezoneOffset(trackStart, trackEnd, photoTimestamps)).toEqual({
      offsetMinutes: 120
    })
  })
})

describe('suggestBetterTrack', () => {
  // A trip where "today's" track runs 2026-07-03, but the hiker accidentally picked photos from
  // 2026-07-01 instead — the exact mistake this function exists to catch.
  const wrongDayPhotos = ['2026-07-01T16:05:00Z', '2026-07-01T19:55:00Z']

  const dayOne: TrackTimeRange = {
    trackId: 1,
    name: 'Day 1',
    date: '2026-07-01',
    startIso: '2026-07-01T14:00:00Z',
    endIso: '2026-07-01T20:00:00Z'
  }
  const dayTwo: TrackTimeRange = {
    trackId: 2,
    name: 'Day 2',
    date: '2026-07-02',
    startIso: '2026-07-02T14:00:00Z',
    endIso: '2026-07-02T20:00:00Z'
  }
  const dayThree: TrackTimeRange = {
    trackId: 3,
    name: 'Day 3',
    date: '2026-07-03',
    startIso: '2026-07-03T14:00:00Z',
    endIso: '2026-07-03T20:00:00Z'
  }

  it('suggests the track the batch actually fits when the current offset is implausible', () => {
    // Importing onto Day 3's track proposes a ~48h offset for these Day-1 photos — way past
    // plausible clock drift — while Day 1 itself needs none at all.
    const { offsetMinutes: currentOffset } = detectTimezoneOffset(
      dayThree.startIso,
      dayThree.endIso,
      wrongDayPhotos
    )
    const suggestion = suggestBetterTrack(currentOffset, wrongDayPhotos, [dayOne, dayTwo])
    expect(suggestion).toEqual({
      trackId: dayOne.trackId,
      name: dayOne.name,
      date: dayOne.date,
      offsetMinutes: 60
    })
  })

  it('does not bother checking other tracks when the current offset is already plausible', () => {
    // A perfectly ordinary 2-hour camera-clock error — should never second-guess this.
    const suggestion = suggestBetterTrack(120, ['2026-07-03T16:00:00Z'], [dayOne, dayTwo])
    expect(suggestion).toBeNull()
  })

  it('returns null when no other track fits any better either', () => {
    // Every candidate track still needs an implausible correction of its own.
    const suggestion = suggestBetterTrack(2880, wrongDayPhotos, [dayThree])
    expect(suggestion).toBeNull()
  })

  it('picks the closest-fitting track when more than one is plausible', () => {
    // Two candidate tracks close enough together in time that a batch can plausibly fit either —
    // the nearer one (trackA, only 60 min off) should win over the farther one (trackB, 90 min
    // off), even though both are within PLAUSIBLE_DRIFT_MINUTES.
    const trackA: TrackTimeRange = {
      trackId: 10,
      name: 'Track A',
      date: '2026-07-05',
      startIso: '2026-07-05T14:00:00Z',
      endIso: '2026-07-05T16:00:00Z' // midpoint 15:00Z
    }
    const trackB: TrackTimeRange = {
      trackId: 11,
      name: 'Track B',
      date: '2026-07-05',
      startIso: '2026-07-05T16:30:00Z',
      endIso: '2026-07-05T18:30:00Z' // midpoint 17:30Z
    }
    const photos = ['2026-07-05T15:45:00Z']

    const suggestion = suggestBetterTrack(9999, photos, [trackA, trackB])

    expect(suggestion?.trackId).toBe(trackA.trackId)
  })

  it('returns null when there are no other tracks to compare against', () => {
    expect(suggestBetterTrack(2880, wrongDayPhotos, [])).toBeNull()
  })
})
