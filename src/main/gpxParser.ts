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
  name?: string
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

  const name = tracks[0].name?.trim() || null
  const points: TrackPoint[] = []

  for (const trk of tracks) {
    for (const seg of trk.trkseg ?? []) {
      for (const trkpt of seg.trkpt ?? []) {
        const lat = trkpt['@_lat']
        const lng = trkpt['@_lon']
        const timestamp = trkpt.time
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          throw new GpxParseError('Track point is missing lat/lon coordinates')
        }
        if (!timestamp) {
          throw new GpxParseError('Track point is missing a <time> value')
        }
        points.push({
          lat,
          lng,
          elevation: typeof trkpt.ele === 'number' ? trkpt.ele : null,
          timestamp
        })
      }
    }
  }

  if (points.length === 0) {
    throw new GpxParseError('GPX file contains no track points')
  }

  points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  return { name, points }
}
