import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { TrackPoint } from '../shared/types'

export class GpxParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  isArray: (name) => ['trk', 'trkseg', 'trkpt'].includes(name)
})

interface RawTrkpt {
  '@_lat'?: number
  '@_lon'?: number
  ele?: number
  time?: string
}

interface RawTrk {
  // fast-xml-parser coerces tag text into a number/boolean when it looks like one
  // (e.g. a Garmin-style numeric track name like "20260701140000"), so this is not
  // guaranteed to be a string at runtime despite GPX's <name> always being text.
  name?: string | number | boolean
  trkseg?: { trkpt?: RawTrkpt[] }[]
}

interface RawGpx {
  gpx?: {
    trk?: RawTrk[]
  }
}

export interface ParsedGpxTrack {
  name: string | null
  points: TrackPoint[]
}

export function parseGpx(xml: string): ParsedGpxTrack {
  if (!xml || !xml.trim()) {
    throw new GpxParseError('GPX file is empty')
  }

  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    throw new GpxParseError(`GPX file is not valid XML: ${validation.err.msg}`)
  }

  const parsed = parser.parse(xml) as RawGpx
  const tracks = parsed.gpx?.trk
  if (!tracks || tracks.length === 0) {
    throw new GpxParseError('No <trk> track found in GPX file')
  }

  const rawName = tracks[0].name
  const name = rawName !== undefined ? String(rawName).trim() || null : null

  // Collected with raw (possibly absent) time strings first — whether the track is "timed" or
  // "timeless" can only be decided once we've seen every point, not while looping over them.
  const rawPoints: { lat: number; lng: number; elevation: number | null; rawTime: string | null }[] =
    []

  for (const trk of tracks) {
    for (const seg of trk.trkseg ?? []) {
      for (const trkpt of seg.trkpt ?? []) {
        const lat = trkpt['@_lat']
        const lng = trkpt['@_lon']
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          throw new GpxParseError('Track point is missing lat/lon coordinates')
        }
        const rawTime = trkpt.time !== undefined && trkpt.time !== null ? String(trkpt.time) : null
        rawPoints.push({
          lat,
          lng,
          elevation: typeof trkpt.ele === 'number' ? trkpt.ele : null,
          rawTime
        })
      }
    }
  }

  if (rawPoints.length === 0) {
    throw new GpxParseError('GPX file contains no track points')
  }

  // A track is only treated as time-based if EVERY point has a timestamp. A CalTopo-style route
  // retraced after the fact (rather than recorded live) has no <time> on any point — that's a
  // fully timeless track, handled below. A track with SOME but not all points timestamped is
  // treated as timeless too: partial interpolation is more misleading than none, and real GPX
  // exporters don't produce this shape (it only ever comes from Frankensteining two files together).
  const isTimed = rawPoints.every((p) => p.rawTime !== null)

  let points: TrackPoint[]

  if (isTimed) {
    points = rawPoints.map((p) => {
      if (Number.isNaN(Date.parse(p.rawTime as string))) {
        throw new GpxParseError(`Track point has an unparseable <time> value: "${p.rawTime}"`)
      }
      return { lat: p.lat, lng: p.lng, elevation: p.elevation, timestamp: p.rawTime }
    })
    // Chronological order only makes sense when every point actually has a time to sort by.
    points.sort((a, b) => Date.parse(a.timestamp as string) - Date.parse(b.timestamp as string))
  } else {
    // No time axis to sort by — preserve the file's own point order, which is the traced path order.
    points = rawPoints.map((p) => ({ lat: p.lat, lng: p.lng, elevation: p.elevation, timestamp: null }))
  }

  return { name, points }
}
