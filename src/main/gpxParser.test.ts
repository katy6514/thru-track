import { describe, it, expect } from 'vitest'
import { parseGpx, GpxParseError } from './gpxParser'

function gpx(trkContent: string): string {
  return `<?xml version="1.0"?>
<gpx version="1.1">
  <trk>
    ${trkContent}
  </trk>
</gpx>`
}

describe('parseGpx', () => {
  it('parses a normal track into ordered points', () => {
    const xml = gpx(`
      <name>Day 1</name>
      <trkseg>
        <trkpt lat="46.85" lon="-121.75">
          <ele>1200.5</ele>
          <time>2026-07-01T14:00:00Z</time>
        </trkpt>
        <trkpt lat="46.86" lon="-121.76">
          <ele>1210.5</ele>
          <time>2026-07-01T14:01:00Z</time>
        </trkpt>
      </trkseg>
    `)

    const result = parseGpx(xml)

    expect(result.name).toBe('Day 1')
    expect(result.points).toEqual([
      { lat: 46.85, lng: -121.75, elevation: 1200.5, timestamp: '2026-07-01T14:00:00Z' },
      { lat: 46.86, lng: -121.76, elevation: 1210.5, timestamp: '2026-07-01T14:01:00Z' }
    ])
  })

  it('preserves a gap across two track segments instead of fabricating points', () => {
    const xml = gpx(`
      <trkseg>
        <trkpt lat="46.85" lon="-121.75">
          <ele>1200</ele>
          <time>2026-07-01T14:00:00Z</time>
        </trkpt>
        <trkpt lat="46.86" lon="-121.76">
          <ele>1210</ele>
          <time>2026-07-01T14:01:00Z</time>
        </trkpt>
      </trkseg>
      <trkseg>
        <trkpt lat="46.90" lon="-121.80">
          <ele>1300</ele>
          <time>2026-07-01T16:00:00Z</time>
        </trkpt>
      </trkseg>
    `)

    const result = parseGpx(xml)

    expect(result.points).toHaveLength(3)
    expect(result.points.map((p) => p.timestamp)).toEqual([
      '2026-07-01T14:00:00Z',
      '2026-07-01T14:01:00Z',
      '2026-07-01T16:00:00Z'
    ])
  })

  it('sorts out-of-order points chronologically', () => {
    const xml = gpx(`
      <trkseg>
        <trkpt lat="1" lon="1"><time>2026-07-01T14:05:00Z</time></trkpt>
        <trkpt lat="2" lon="2"><time>2026-07-01T14:00:00Z</time></trkpt>
      </trkseg>
    `)

    const result = parseGpx(xml)

    expect(result.points.map((p) => p.timestamp)).toEqual([
      '2026-07-01T14:00:00Z',
      '2026-07-01T14:05:00Z'
    ])
  })

  it('treats a missing elevation as null rather than throwing', () => {
    const xml = gpx(`
      <trkseg>
        <trkpt lat="46.85" lon="-121.75"><time>2026-07-01T14:00:00Z</time></trkpt>
      </trkseg>
    `)

    const result = parseGpx(xml)

    expect(result.points[0].elevation).toBeNull()
  })

  it('throws GpxParseError for an empty file', () => {
    expect(() => parseGpx('')).toThrow(GpxParseError)
    expect(() => parseGpx('   ')).toThrow(GpxParseError)
  })

  it('throws GpxParseError for invalid XML', () => {
    expect(() => parseGpx('not xml at all <<>>')).toThrow(GpxParseError)
  })

  it('throws GpxParseError when there is no <trk> element', () => {
    expect(() => parseGpx('<?xml version="1.0"?><gpx></gpx>')).toThrow(GpxParseError)
  })

  it('throws GpxParseError when a track has no points', () => {
    const xml = gpx('<trkseg></trkseg>')
    expect(() => parseGpx(xml)).toThrow(GpxParseError)
  })

  it('throws GpxParseError when a track point is missing a timestamp', () => {
    const xml = gpx(`
      <trkseg>
        <trkpt lat="46.85" lon="-121.75"><ele>1200</ele></trkpt>
      </trkseg>
    `)
    expect(() => parseGpx(xml)).toThrow(GpxParseError)
  })

  it('throws GpxParseError when a track point is missing coordinates', () => {
    const xml = gpx(`
      <trkseg>
        <trkpt><time>2026-07-01T14:00:00Z</time></trkpt>
      </trkseg>
    `)
    expect(() => parseGpx(xml)).toThrow(GpxParseError)
  })
})
