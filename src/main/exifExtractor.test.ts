import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { extractExifData } from './exifExtractor'

const FIXTURES_DIR = join(__dirname, '__fixtures__')

describe('extractExifData', () => {
  it('extracts GPS and timestamp from a photo with EXIF data', async () => {
    const buffer = await readFile(join(FIXTURES_DIR, 'photo-with-exif.jpg'))
    const result = await extractExifData(buffer)

    expect(result.lat).toBeCloseTo(46.8523, 3)
    expect(result.lng).toBeCloseTo(-121.7603, 3)
    expect(result.timestamp).not.toBeNull()
    // The fixture's DateTimeOriginal is "2026:07:01 14:05:30" (no timezone, as real EXIF never
    // carries one) — just confirm it parsed into a real, sane instant rather than asserting an
    // exact UTC string, since exifr resolves it against the local system timezone.
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
