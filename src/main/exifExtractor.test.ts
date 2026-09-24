import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { extractExifData, resolveExifTimestamp } from './exifExtractor'

const FIXTURES_DIR = join(__dirname, '__fixtures__')

describe('extractExifData', () => {
  it('extracts GPS and timestamp from a photo with EXIF data', async () => {
    const buffer = await readFile(join(FIXTURES_DIR, 'photo-with-exif.jpg'))
    const result = await extractExifData(buffer)

    expect(result.lat).toBeCloseTo(46.8523, 3)
    expect(result.lng).toBeCloseTo(-121.7603, 3)
    expect(result.timestamp).not.toBeNull()
    // The fixture's DateTimeOriginal is "2026:07:01 14:05:30" with no GPS timestamp and no offset
    // tag at all — the one case resolveExifTimestamp can't resolve exactly (see its own tests
    // below), so this just confirms it still parses into *some* real, sane instant rather than
    // asserting an exact UTC string, since exifr resolves it against the local system timezone
    // when nothing better is available.
    expect(Number.isNaN(Date.parse(result.timestamp as string))).toBe(false)
  })

  it('returns all-null for a photo with no EXIF data at all', async () => {
    const buffer = await readFile(join(FIXTURES_DIR, 'photo-without-exif.jpg'))
    const result = await extractExifData(buffer)

    expect(result).toEqual({ timestamp: null, lat: null, lng: null })
  })

  it('returns all-null (rather than throwing) for a buffer that is not a real image', async () => {
    const result = await extractExifData(Buffer.from('not an image'))
    expect(result).toEqual({ timestamp: null, lat: null, lng: null })
  })
})

describe('resolveExifTimestamp', () => {
  // Mirrors exactly how exifr itself resolves DateTimeOriginal/CreateDate: constructed from local
  // (not UTC) components, so it round-trips through applyExifOffset's own local getters correctly
  // no matter what timezone the machine running this test happens to be set to.
  function localExifDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number
  ): Date {
    return new Date(year, month - 1, day, hour, minute, second)
  }

  it('prefers the GPS UTC timestamp when present, ignoring DateTimeOriginal entirely', () => {
    const result = resolveExifTimestamp({
      GPSDateStamp: '2026:09:15',
      GPSTimeStamp: '13:29:37',
      // A deliberately wrong local time/offset, to prove GPS wins outright rather than being
      // averaged or cross-checked against it.
      DateTimeOriginal: localExifDate(1999, 1, 1, 0, 0, 0),
      OffsetTimeOriginal: '+05:00'
    })
    expect(result).toBe('2026-09-15T13:29:37.000Z')
  })

  it('combines DateTimeOriginal with an explicit negative UTC offset', () => {
    // The real Blodgett Canyon case this whole fix exists for: a camera in Mountain Time
    // (UTC-6) with no GPS timestamp recorded, but a correct OffsetTimeOriginal tag.
    const result = resolveExifTimestamp({
      DateTimeOriginal: localExifDate(2026, 9, 15, 7, 29, 38),
      OffsetTimeOriginal: '-06:00'
    })
    expect(result).toBe('2026-09-15T13:29:38.000Z')
  })

  it('combines DateTimeOriginal with an explicit positive UTC offset', () => {
    const result = resolveExifTimestamp({
      DateTimeOriginal: localExifDate(2026, 9, 15, 18, 0, 0),
      OffsetTimeOriginal: '+05:30'
    })
    expect(result).toBe('2026-09-15T12:30:00.000Z')
  })

  it('falls back to OffsetTime when OffsetTimeOriginal is absent', () => {
    const result = resolveExifTimestamp({
      DateTimeOriginal: localExifDate(2026, 9, 15, 7, 29, 38),
      OffsetTime: '-06:00'
    })
    expect(result).toBe('2026-09-15T13:29:38.000Z')
  })

  it('falls back to CreateDate when DateTimeOriginal is absent', () => {
    const result = resolveExifTimestamp({
      CreateDate: localExifDate(2026, 9, 15, 7, 29, 38),
      OffsetTimeOriginal: '-06:00'
    })
    expect(result).toBe('2026-09-15T13:29:38.000Z')
  })

  it("falls back to exifr's own (system-timezone-dependent) resolution when there is no GPS timestamp and no offset tag at all", () => {
    const date = localExifDate(2026, 9, 15, 7, 29, 38)
    const result = resolveExifTimestamp({ DateTimeOriginal: date })
    expect(result).toBe(date.toISOString())
  })

  it('ignores a malformed GPS timestamp and falls through to the offset-combined path', () => {
    const result = resolveExifTimestamp({
      GPSDateStamp: 'not-a-date',
      GPSTimeStamp: '13:29:37',
      DateTimeOriginal: localExifDate(2026, 9, 15, 7, 29, 38),
      OffsetTimeOriginal: '-06:00'
    })
    expect(result).toBe('2026-09-15T13:29:38.000Z')
  })

  it('ignores a malformed offset tag and falls through to the unresolved fallback', () => {
    const date = localExifDate(2026, 9, 15, 7, 29, 38)
    const result = resolveExifTimestamp({ DateTimeOriginal: date, OffsetTimeOriginal: 'garbage' })
    expect(result).toBe(date.toISOString())
  })

  it('returns null when there is no usable date field at all', () => {
    expect(resolveExifTimestamp({})).toBeNull()
  })

  it('returns null when DateTimeOriginal is present but not a valid Date', () => {
    expect(resolveExifTimestamp({ DateTimeOriginal: new Date(NaN) })).toBeNull()
  })
})
