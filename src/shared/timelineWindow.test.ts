import { describe, it, expect } from 'vitest'
import {
  zoomIn,
  zoomOut,
  pan,
  clampToWindow,
  percentInWindow,
  MIN_WINDOW_MS,
  type TimeWindow
} from './timelineWindow'

// A tidy 1-hour track, from t=0 to t=3_600_000ms, used as `bounds` throughout — real values would
// be epoch-ms but small round numbers make the math easy to verify by eye.
const bounds: TimeWindow = { startMs: 0, endMs: 3_600_000 }

describe('zoomIn', () => {
  it('halves the window width, centered on the given point', () => {
    const result = zoomIn(bounds, bounds, 1_800_000) // center of the full range
    expect(result).toEqual({ startMs: 900_000, endMs: 2_700_000 })
  })

  it('slides the window back inside bounds rather than overhanging the start', () => {
    // Centering a half-width window on t=0 would put half of it before the track even starts.
    const result = zoomIn(bounds, bounds, 0)
    expect(result.startMs).toBe(0)
    expect(result.endMs).toBe(1_800_000)
  })

  it('slides the window back inside bounds rather than overhanging the end', () => {
    const result = zoomIn(bounds, bounds, 3_600_000)
    expect(result.endMs).toBe(3_600_000)
    expect(result.startMs).toBe(1_800_000)
  })

  it('never narrows past MIN_WINDOW_MS', () => {
    const tiny: TimeWindow = { startMs: 1_000_000, endMs: 1_000_000 + MIN_WINDOW_MS }
    const result = zoomIn(tiny, bounds, 1_000_000 + MIN_WINDOW_MS / 2)
    expect(result.endMs - result.startMs).toBe(MIN_WINDOW_MS)
  })

  it('repeated zoom-ins converge on MIN_WINDOW_MS rather than collapsing to zero', () => {
    let window = bounds
    const center = 1_800_000
    for (let i = 0; i < 30; i++) {
      window = zoomIn(window, bounds, center)
    }
    expect(window.endMs - window.startMs).toBe(MIN_WINDOW_MS)
  })
})

describe('zoomOut', () => {
  it('doubles the window width, centered on the given point', () => {
    const narrow: TimeWindow = { startMs: 1_000_000, endMs: 1_200_000 }
    const result = zoomOut(narrow, bounds, 1_100_000)
    expect(result).toEqual({ startMs: 900_000, endMs: 1_300_000 })
  })

  it('clamps back down to the full bounds once doubling would exceed it', () => {
    const almostFull: TimeWindow = { startMs: 100_000, endMs: 3_500_000 }
    const result = zoomOut(almostFull, bounds, 1_800_000)
    expect(result).toEqual(bounds)
  })

  it('repeated zoom-outs settle on the full track range without overshooting', () => {
    let window: TimeWindow = { startMs: 1_700_000, endMs: 1_900_000 }
    for (let i = 0; i < 30; i++) {
      window = zoomOut(window, bounds, 1_800_000)
    }
    expect(window).toEqual(bounds)
  })
})

describe('pan', () => {
  const narrow: TimeWindow = { startMs: 1_000_000, endMs: 1_200_000 } // 200_000ms wide

  it('shifts the window later by a fraction of its width', () => {
    const result = pan(narrow, bounds, 'later', 0.5)
    expect(result).toEqual({ startMs: 1_100_000, endMs: 1_300_000 })
  })

  it('shifts the window earlier by a fraction of its width', () => {
    const result = pan(narrow, bounds, 'earlier', 0.5)
    expect(result).toEqual({ startMs: 900_000, endMs: 1_100_000 })
  })

  it('holds the window flush against the start bound rather than panning past it', () => {
    const nearStart: TimeWindow = { startMs: 50_000, endMs: 250_000 }
    const result = pan(nearStart, bounds, 'earlier', 0.5)
    expect(result).toEqual({ startMs: 0, endMs: 200_000 })
  })

  it('holds the window flush against the end bound rather than panning past it', () => {
    const nearEnd: TimeWindow = { startMs: 3_400_000, endMs: 3_600_000 }
    const result = pan(nearEnd, bounds, 'later', 0.5)
    expect(result).toEqual({ startMs: 3_400_000, endMs: 3_600_000 })
  })

  it('preserves window width across a clamped pan', () => {
    const nearStart: TimeWindow = { startMs: 50_000, endMs: 250_000 }
    const result = pan(nearStart, bounds, 'earlier', 0.5)
    expect(result.endMs - result.startMs).toBe(200_000)
  })
})

describe('clampToWindow', () => {
  const window: TimeWindow = { startMs: 1_000_000, endMs: 1_200_000 }

  it('leaves a value already inside the window unchanged', () => {
    expect(clampToWindow(1_100_000, window)).toBe(1_100_000)
  })

  it('clamps a value below the window to its start', () => {
    expect(clampToWindow(500_000, window)).toBe(1_000_000)
  })

  it('clamps a value above the window to its end', () => {
    expect(clampToWindow(2_000_000, window)).toBe(1_200_000)
  })
})

describe('percentInWindow', () => {
  const window: TimeWindow = { startMs: 1_000_000, endMs: 1_200_000 }

  it('places the window start at 0%', () => {
    expect(percentInWindow(1_000_000, window)).toBe(0)
  })

  it('places the window end at 100%', () => {
    expect(percentInWindow(1_200_000, window)).toBe(100)
  })

  it('places the midpoint at 50%', () => {
    expect(percentInWindow(1_100_000, window)).toBe(50)
  })

  it('returns null for a point before the window', () => {
    expect(percentInWindow(999_999, window)).toBeNull()
  })

  it('returns null for a point after the window', () => {
    expect(percentInWindow(1_200_001, window)).toBeNull()
  })

  it('returns null for a zero-width window', () => {
    expect(percentInWindow(1_000_000, { startMs: 1_000_000, endMs: 1_000_000 })).toBeNull()
  })
})
