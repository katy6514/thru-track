import { describe, it, expect } from 'vitest'
import { parseInreachCsv, InreachCsvParseError } from './inreachCsvParser'

describe('parseInreachCsv', () => {
  it('parses a normal export, including a message with an embedded comma inside quotes', () => {
    const csv = [
      'Time UTC,Name,IMEI,Latitude,Longitude,Elevation,Velocity,Course,Event,Text,In Emergency',
      '"Jul 1, 2026 2:00:00 PM",Katy,300434000000000,46.85,-121.75,1200,0,0,Message,"At the trailhead, starting now",False',
      '"Jul 1, 2026 4:30:00 PM",Katy,300434000000000,46.90,-121.80,1800,2.5,90,Message,Reached the ridge,False'
    ].join('\n')

    const result = parseInreachCsv(csv)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      timestamp: '2026-07-01T14:00:00.000Z',
      lat: 46.85,
      lng: -121.75,
      content: 'At the trailhead, starting now'
    })
    expect(result[1].content).toBe('Reached the ridge')
    expect(result[1].lat).toBe(46.9)
    expect(result[1].lng).toBe(-121.8)
  })

  it('treats a marker-less "Time UTC" value as UTC rather than the local system timezone', () => {
    // A real inReach export's "Time UTC" column commonly has no explicit Z/offset marker at all
    // — naively parsed, that string would be interpreted as local time, silently shifting every
    // message by the importing machine's UTC offset. This must hold regardless of what timezone
    // the test happens to run in.
    const csv = [
      'Time UTC,Latitude,Longitude,Text',
      '"Jul 1, 2026 2:00:00 PM",46.85,-121.75,Hello'
    ].join('\n')

    const result = parseInreachCsv(csv)

    expect(result[0].timestamp).toBe('2026-07-01T14:00:00.000Z')
  })

  it('looks up columns by header name, tolerating a "Time"/"Date/Time UTC" variant', () => {
    const csv = ['Time,Latitude,Longitude,Text', '2026-07-01T14:00:00Z,46.85,-121.75,Hello'].join(
      '\n'
    )

    const result = parseInreachCsv(csv)

    expect(result).toEqual([
      { timestamp: '2026-07-01T14:00:00.000Z', lat: 46.85, lng: -121.75, content: 'Hello' }
    ])
  })

  it('throws InreachCsvParseError for a completely empty file (no header row)', () => {
    expect(() => parseInreachCsv('')).toThrow(InreachCsvParseError)
    expect(() => parseInreachCsv('   ')).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when a required column (message text) is missing entirely', () => {
    const csv = ['Time UTC,Latitude,Longitude', '2026-07-01T14:00:00Z,46.85,-121.75'].join('\n')
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when the timestamp column is unrecognized', () => {
    const csv = ['Foo,Latitude,Longitude,Text', 'bar,46.85,-121.75,Hello'].join('\n')
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when a row has an unparseable timestamp', () => {
    const csv = [
      'Time UTC,Latitude,Longitude,Text',
      'not-a-real-timestamp,46.85,-121.75,Hello'
    ].join('\n')
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when a row has an unparseable latitude', () => {
    const csv = [
      'Time UTC,Latitude,Longitude,Text',
      '2026-07-01T14:00:00Z,not-a-number,-121.75,Hello'
    ].join('\n')
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when a row has an out-of-range latitude', () => {
    const csv = ['Time UTC,Latitude,Longitude,Text', '2026-07-01T14:00:00Z,200,-121.75,Hello'].join(
      '\n'
    )
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('throws InreachCsvParseError when a row has an unparseable longitude', () => {
    const csv = [
      'Time UTC,Latitude,Longitude,Text',
      '2026-07-01T14:00:00Z,46.85,garbage,Hello'
    ].join('\n')
    expect(() => parseInreachCsv(csv)).toThrow(InreachCsvParseError)
  })

  it('allows an empty message text (a plain check-in with no note attached)', () => {
    const csv = ['Time UTC,Latitude,Longitude,Text', '2026-07-01T14:00:00Z,46.85,-121.75,'].join(
      '\n'
    )
    const result = parseInreachCsv(csv)
    expect(result[0].content).toBe('')
  })
})
