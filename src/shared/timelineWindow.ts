// The timeline's "visible window" — the [startMs, endMs] slice of the track's full time range
// that's currently shown on the slider/marker strip. Defaults to the full track range and can be
// narrowed (zoom in), widened back up (zoom out), or shifted (pan) without ever exceeding the
// track's actual bounds. Kept as a pure module (no React/DOM) so the clamping/centering edge
// cases here — which are exactly the kind of thing that's easy to get subtly wrong — can be unit
// tested in isolation, the same way positionInterpolator.ts and splitTrackSegments.ts are.

export interface TimeWindow {
  startMs: number
  endMs: number
}

// A floor on how narrow zooming in can make the window, so repeated zoom-in presses can't
// collapse it to (or past) zero width. 15 seconds is comfortably narrower than any realistic
// "clustered items" case this issue targets, while still leaving a nonzero span to render against.
export const MIN_WINDOW_MS = 15_000

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Shared by zoomIn/zoomOut: recenters a window of `newSpanMs` on `centerMs`, then slides it
// (without shrinking it further) back inside `bounds` if it would otherwise overhang either edge.
function windowAround(newSpanMs: number, centerMs: number, bounds: TimeWindow): TimeWindow {
  const boundsSpan = bounds.endMs - bounds.startMs
  const span = clamp(newSpanMs, Math.min(MIN_WINDOW_MS, boundsSpan), boundsSpan)
  const clampedCenter = clamp(centerMs, bounds.startMs, bounds.endMs)

  let startMs = clampedCenter - span / 2
  let endMs = clampedCenter + span / 2

  if (startMs < bounds.startMs) {
    startMs = bounds.startMs
    endMs = startMs + span
  } else if (endMs > bounds.endMs) {
    endMs = bounds.endMs
    startMs = endMs - span
  }

  // Defensive final clamp for floating-point edge cases (e.g. span === boundsSpan exactly).
  return {
    startMs: clamp(startMs, bounds.startMs, bounds.endMs),
    endMs: clamp(endMs, bounds.startMs, bounds.endMs)
  }
}

/**
 * Halves the window's width, centered on `centerMs` (typically the current scrub position) —
 * this is what makes items that overlap at full-day scale spread out and become individually
 * clickable. Never narrower than {@link MIN_WINDOW_MS} (or the track's own span, if that's
 * smaller), and never extends past `bounds`.
 */
export function zoomIn(window: TimeWindow, bounds: TimeWindow, centerMs: number): TimeWindow {
  const currentSpan = window.endMs - window.startMs
  return windowAround(currentSpan / 2, centerMs, bounds)
}

/**
 * Doubles the window's width, centered on `centerMs`, clamped back down to the full `bounds`
 * range once doubling would exceed it (so repeated zoom-out presses settle on the full track
 * range rather than overshooting).
 */
export function zoomOut(window: TimeWindow, bounds: TimeWindow, centerMs: number): TimeWindow {
  const currentSpan = window.endMs - window.startMs
  return windowAround(currentSpan * 2, centerMs, bounds)
}

/**
 * Shifts the window earlier or later by `fraction` of its own width (default half a window's
 * width per press), clamped so it never extends past the track's actual start/end — panning
 * against an edge holds the window flush with that edge rather than sliding it out of bounds.
 */
export function pan(
  window: TimeWindow,
  bounds: TimeWindow,
  direction: 'earlier' | 'later',
  fraction = 0.5
): TimeWindow {
  const span = window.endMs - window.startMs
  const shift = span * fraction * (direction === 'earlier' ? -1 : 1)

  let startMs = window.startMs + shift
  let endMs = window.endMs + shift

  if (startMs < bounds.startMs) {
    startMs = bounds.startMs
    endMs = startMs + span
  } else if (endMs > bounds.endMs) {
    endMs = bounds.endMs
    startMs = endMs - span
  }

  return {
    startMs: clamp(startMs, bounds.startMs, bounds.endMs),
    endMs: clamp(endMs, bounds.startMs, bounds.endMs)
  }
}

/** Clamps an absolute epoch-ms instant (e.g. the current scrub position) into a window's bounds. */
export function clampToWindow(ms: number, window: TimeWindow): number {
  return clamp(ms, window.startMs, window.endMs)
}

/**
 * Converts an absolute epoch-ms instant into a 0-100 position within `window`, for positioning a
 * timeline marker — or `null` if it falls outside the window entirely, so callers can skip
 * rendering it rather than clamping it to a nonsensical edge position.
 */
export function percentInWindow(ms: number, window: TimeWindow): number | null {
  const span = window.endMs - window.startMs
  if (span <= 0) return null
  const pct = ((ms - window.startMs) / span) * 100
  if (pct < 0 || pct > 100) return null
  return pct
}
