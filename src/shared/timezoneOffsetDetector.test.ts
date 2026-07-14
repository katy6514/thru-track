import { describe, it, expect } from 'vitest'
import { detectTimezoneOffset } from './timezoneOffsetDetector'

describe('detectTimezoneOffset', () => {
  const trackStart = '2026-07-01T14:00:00Z'

  it('proposes 0 when a photo timestamp exactly matches the track start', () => {
    expect(detectTimezoneOffset(trackStart, ['2026-07-01T14:00:00Z'])).toEqual({
      offsetMinutes: 0
    })
  })

  it('proposes a whole-hour offset', () => {
    // Camera clock reads exactly 2 hours ahead of the track's own clock.
    expect(detectTimezoneOffset(trackStart, ['2026-07-01T16:00:00Z'])).toEqual({
      offsetMinutes: 120
    })
  })

  it('proposes a half-hour offset', () => {
    // e.g. a camera clock left set to an Indian Standard Time-style UTC+5:30 zone.
    expect(detectTimezoneOffset(trackStart, ['2026-07-01T16:30:00Z'])).toEqual({
      offsetMinutes: 150
    })
  })

  it('rounds a small raw difference down to no meaningful offset', () => {
    // A couple of minutes of ordinary clock drift between the GPS recorder and the camera —
    // should not propose a spurious tiny correction.
    expect(detectTimezoneOffset(trackStart, ['2026-07-01T14:03:00Z'])).toEqual({
      offsetMinutes: 0
    })
  })

  it('detects a negative offset when the camera clock reads earlier than the track', () => {
    expect(detectTimezoneOffset(trackStart, ['2026-07-01T13:00:00Z'])).toEqual({
      offsetMinutes: -60
    })
  })

  it('uses the most common rounded offset across a batch, ignoring a lone outlier', () => {
    const photoTimestamps = [
      '2026-07-01T16:00:00Z', // +2h
      '2026-07-01T16:01:00Z', // +2h (rounds to same bucket)
      '2026-07-01T15:59:00Z', // +2h (rounds to same bucket)
      '2026-07-01T20:00:00Z' // +6h — a single photo with a wrong camera clock
    ]
    expect(detectTimezoneOffset(trackStart, photoTimestamps)).toEqual({ offsetMinutes: 120 })
  })

  it('breaks ties deterministically by the first offset encountered', () => {
    const photoTimestamps = [
      '2026-07-01T16:00:00Z', // +2h
      '2026-07-01T13:00:00Z' // -1h — an even split, first value wins
    ]
    expect(detectTimezoneOffset(trackStart, photoTimestamps)).toEqual({ offsetMinutes: 120 })
  })

  it('proposes 0 when given no photo timestamps at all', () => {
    expect(detectTimezoneOffset(trackStart, [])).toEqual({ offsetMinutes: 0 })
  })
})
