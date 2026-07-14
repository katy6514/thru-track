import type { TrackPoint } from '../../shared/types'
import { GAP_THRESHOLD_MS } from './splitTrackSegments'

export type InterpolationResult =
  | { status: 'ok'; lat: number; lng: number }
  | { status: 'gap' }
  | { status: 'out-of-range' }

/**
 * Resolves a lat/lng for a given moment in a track's day, by linearly interpolating
 * between the two track points immediately surrounding it in time.
 *
 * Assumes `points` is already ordered by timestamp ascending and fully timed (as
 * returned by `Repository.getTrackPoints` for a non-timeless track) — a timeless
 * track has no time axis to place a timestamp on in the first place, so callers
 * shouldn't be scrubbing a timeline for one at all.
 *
 * Returns `'out-of-range'` when the timestamp falls before the first or after the
 * last recorded point (nothing to interpolate between), and `'gap'` when it falls
 * between two points that are farther apart than {@link GAP_THRESHOLD_MS} — the
 * same threshold used to decide where the map polyline breaks, so "the timeline
 * says you're in a gap" and "the map shows a broken line here" always agree.
 */
export function interpolatePosition(points: TrackPoint[], timestampMs: number): InterpolationResult {
  if (points.length === 0) return { status: 'out-of-range' }

  const times = points.map((p) => Date.parse(p.timestamp as string))

  if (timestampMs < times[0] || timestampMs > times[times.length - 1]) {
    return { status: 'out-of-range' }
  }

  for (let i = 0; i < points.length; i++) {
    if (times[i] === timestampMs) {
      return { status: 'ok', lat: points[i].lat, lng: points[i].lng }
    }
    if (times[i] > timestampMs) {
      const before = points[i - 1]
      const after = points[i]
      const beforeMs = times[i - 1]
      const afterMs = times[i]

      if (afterMs - beforeMs > GAP_THRESHOLD_MS) {
        return { status: 'gap' }
      }

      const fraction = (timestampMs - beforeMs) / (afterMs - beforeMs)
      return {
        status: 'ok',
        lat: before.lat + (after.lat - before.lat) * fraction,
        lng: before.lng + (after.lng - before.lng) * fraction
      }
    }
  }

  // Unreachable given the out-of-range check above, but keeps the function total.
  return { status: 'out-of-range' }
}
