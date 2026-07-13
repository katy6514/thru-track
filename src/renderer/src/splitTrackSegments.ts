import type { TrackPoint } from '../../shared/types'

/**
 * Maximum gap (in milliseconds) between two consecutive track points before
 * they're considered part of separate recording segments.
 *
 * GPX import (issue #4) flattens any multi-segment structure from the source
 * file into a single ordered list of `track_points` with no explicit
 * segment/gap marker, so a gap has to be inferred purely from the time delta
 * between consecutive points. During active GPS recording, points are
 * typically logged every few seconds up to a couple of minutes apart. A gap
 * of 15 minutes or more almost always means the device lost signal, was
 * paused, or was powered off (e.g. a lunch stop, a tunnel, an overnight
 * pause) — not that the hiker actually covered that ground in one
 * continuous straight burst. Splitting there avoids drawing an impossible
 * "teleport" line across the gap, while staying long enough that ordinary
 * recording pauses of a few minutes don't get fragmented into spurious
 * extra segments.
 */
export const GAP_THRESHOLD_MS = 15 * 60 * 1000

/**
 * Splits an ordered array of track points into contiguous runs ("segments"),
 * breaking wherever the time between two consecutive points exceeds
 * {@link GAP_THRESHOLD_MS}. Each returned segment is meant to be rendered as
 * its own polyline, so a real-world gap in the recording shows up as a
 * visual break rather than a straight line bridging it.
 *
 * Assumes `points` is already ordered by timestamp ascending (as returned by
 * `Repository.getTrackPoints`).
 */
export function splitTrackIntoSegments(points: TrackPoint[]): TrackPoint[][] {
  if (points.length === 0) return []

  // A timeless track (e.g. a route retraced in CalTopo rather than recorded live) has no
  // per-point timestamps to compute a gap from — there's no way to tell a real pause from
  // ordinary path geometry, so it always renders as one unbroken polyline.
  if (points[0].timestamp === null) return [points]

  const segments: TrackPoint[][] = [[points[0]]]

  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    const deltaMs = Date.parse(current.timestamp as string) - Date.parse(previous.timestamp as string)

    if (deltaMs > GAP_THRESHOLD_MS) {
      segments.push([current])
    } else {
      segments[segments.length - 1].push(current)
    }
  }

  return segments
}
