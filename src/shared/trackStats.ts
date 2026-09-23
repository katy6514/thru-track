import type { TrackPoint } from './types'
import { splitTrackIntoSegments } from './splitTrackSegments'

const EARTH_RADIUS_MILES = 3958.7613
const METERS_TO_FEET = 3.28084

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

// Great-circle distance between two points, in miles — the standard haversine formula.
function haversineMiles(a: TrackPoint, b: TrackPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

export interface TrackStats {
  distanceMiles: number
  // null when the track carries no elevation data at all (every point's elevation is null) —
  // distinct from 0, which means real elevation data that just never went uphill.
  elevationGainFeet: number | null
}

/**
 * Total distance and cumulative elevation gain for a track.
 *
 * Both are computed per-segment via {@link splitTrackIntoSegments} rather than across the whole
 * point list — the same gap-detection the map's own polyline rendering uses, so a recording
 * pause (lunch stop, dead battery) doesn't add a straight-line "teleport" distance between where
 * recording stopped and where it resumed, matching what the map visually shows.
 *
 * Elevation gain only counts ascents (positive deltas between consecutive points), the standard
 * "elevation gain" meaning — descents are ignored rather than netted out.
 */
export function computeTrackStats(points: TrackPoint[]): TrackStats {
  const segments = splitTrackIntoSegments(points)

  let distanceMiles = 0
  let elevationGainMeters = 0
  let hasElevation = false

  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      distanceMiles += haversineMiles(segment[i - 1], segment[i])

      const previousElevation = segment[i - 1].elevation
      const currentElevation = segment[i].elevation
      if (previousElevation !== null && currentElevation !== null) {
        hasElevation = true
        const delta = currentElevation - previousElevation
        if (delta > 0) elevationGainMeters += delta
      }
    }
  }

  return {
    distanceMiles,
    elevationGainFeet: hasElevation ? elevationGainMeters * METERS_TO_FEET : null
  }
}
