const THIRTY_MIN_MS = 30 * 60 * 1000

export interface OffsetDetectionResult {
  // Minutes a photo batch's own EXIF clock appears to be ahead of the track's clock. Positive
  // means the camera reads later than the track (subtract this many minutes from a photo's EXIF
  // timestamp to align it); negative means the camera reads earlier (add). Always a multiple of
  // 30 — see the rounding rationale below — and 0 means "no meaningful offset detected."
  offsetMinutes: number
}

// Rounds a raw millisecond difference to the nearest 30 minutes. Real-world timezone offsets are
// always a whole-hour or half-hour amount (e.g. UTC+5:30, UTC+9:45 is the rare exception, but
// 30-minute granularity covers the vast majority of real zones a hiker would encounter) — so
// rounding to the nearest half-hour, rather than the nearest whole hour, avoids permanently
// mis-correcting a batch shot in a half-hour-offset zone. A raw diff smaller than 15 minutes
// (half of the 30-minute bucket) rounds down to 0 automatically, which is exactly the "no
// meaningful offset" behavior the acceptance criteria ask for — a photo's clock is rarely
// perfectly synced to the GPS recorder's, so a couple of minutes of drift shouldn't produce a
// spurious correction.
function roundToNearestHalfHourMinutes(diffMs: number): number {
  return Math.round(diffMs / THIRTY_MIN_MS) * 30
}

/**
 * Detects the likely timezone offset between a track's own clock (its GPX start timestamp,
 * assumed correct/UTC-derived) and a batch of photos' EXIF clocks, which may have been set to
 * whatever timezone the camera/phone happened to be in (often not the hiker's current one, or
 * just never adjusted for DST).
 *
 * Aggregation strategy: rather than trusting a single representative photo (fragile — one photo
 * from a second camera with a stale or misconfigured clock would throw the whole batch off), each
 * photo's raw diff-from-track-start is independently rounded to the nearest 30 minutes, and the
 * *mode* (most common rounded value) across the batch is proposed. This is robust to a lone
 * outlier as long as most of the batch's cameras agree on the same real-world offset, which is
 * the overwhelmingly common case (one device took the whole batch). Ties are broken by the first
 * offset value encountered in `photoTimestamps`, making the result deterministic regardless of Map
 * iteration order.
 *
 * Any photo timestamp that fails to parse is silently skipped (defensive — callers are expected to
 * have already filtered to photos with a real EXIF timestamp). If none parse, proposes 0.
 */
export function detectTimezoneOffset(
  trackStartIso: string,
  photoTimestamps: string[]
): OffsetDetectionResult {
  const trackStartMs = Date.parse(trackStartIso)

  const roundedOffsets = photoTimestamps
    .map((ts) => Date.parse(ts))
    .filter((ms) => !Number.isNaN(ms))
    .map((photoMs) => roundToNearestHalfHourMinutes(photoMs - trackStartMs))

  if (roundedOffsets.length === 0) return { offsetMinutes: 0 }

  const counts = new Map<number, number>()
  for (const offset of roundedOffsets) {
    counts.set(offset, (counts.get(offset) ?? 0) + 1)
  }

  let bestOffset = roundedOffsets[0]
  let bestCount = 0
  for (const offset of roundedOffsets) {
    const count = counts.get(offset) as number
    if (count > bestCount) {
      bestCount = count
      bestOffset = offset
    }
  }

  return { offsetMinutes: bestOffset }
}
