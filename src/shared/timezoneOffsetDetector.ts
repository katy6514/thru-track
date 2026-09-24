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
 * Detects the likely timezone offset between a track's own clock (its GPX timestamps, assumed
 * correct/UTC-derived) and a batch of photos' EXIF clocks, which may have been set to whatever
 * timezone the camera/phone happened to be in (often not the hiker's current one, or just never
 * adjusted for DST).
 *
 * Comparison strategy: a photo taken partway through the day naturally has a timestamp hours
 * after the track's *start* even with a perfectly correct clock — comparing each photo
 * individually against `trackStartIso` would conflate "how far into the hike this photo was
 * taken" with "how wrong the camera's clock is," which are unrelated quantities (this was a real
 * bug: a photo taken 7 hours into a hike produced a spurious ~7-hour "correction" that then got
 * applied to the whole batch, corrupting photos that never needed it). Since every photo in a
 * batch shares one camera and therefore one constant clock error, the batch's own midpoint (the
 * average of its earliest and latest timestamps) compared against the track's midpoint isolates
 * that constant far more reliably than any single photo's raw diff from track start — it's
 * unaffected by *when during the hike* photos happen to have been taken, only by the batch's
 * overall position relative to the track in time.
 *
 * Any photo timestamp that fails to parse is silently skipped (defensive — callers are expected to
 * have already filtered to photos with a real EXIF timestamp). If none parse, proposes 0.
 */
export function detectTimezoneOffset(
  trackStartIso: string,
  trackEndIso: string,
  photoTimestamps: string[]
): OffsetDetectionResult {
  const photoMsValues = photoTimestamps
    .map((ts) => Date.parse(ts))
    .filter((ms) => !Number.isNaN(ms))

  if (photoMsValues.length === 0) return { offsetMinutes: 0 }

  const batchMidMs = (Math.min(...photoMsValues) + Math.max(...photoMsValues)) / 2
  const trackMidMs = (Date.parse(trackStartIso) + Date.parse(trackEndIso)) / 2

  return { offsetMinutes: roundToNearestHalfHourMinutes(batchMidMs - trackMidMs) }
}

// A real camera-clock error (wrong timezone, DST never adjusted, clock never set) is rarely more
// than a few hours — beyond this, an offset is far more likely to mean "these photos belong to a
// different day" than "this camera's clock is unusually wrong." Exported so callers can cheaply
// skip the cross-track lookup suggestBetterTrack needs (see below) when a track's own offset is
// already this plausible, rather than always querying every other track in the trip.
export const PLAUSIBLE_DRIFT_MINUTES = 180

// One other track's own date/name plus its recorded time span — everything suggestBetterTrack
// needs to test whether a photo batch actually fits it better than the track it was imported to.
export interface TrackTimeRange {
  trackId: number
  name: string
  date: string
  startIso: string
  endIso: string
}

export interface TrackSuggestion {
  trackId: number
  name: string
  date: string
  offsetMinutes: number
}

// Catches the "wrong track, not a wrong clock" mistake: a hiker importing today's photos onto
// yesterday's track (or vice versa) sees the same shape of result — a big proposed offset — as a
// genuinely broken camera clock, but the fix is completely different (open the right track, not
// apply a 42-hour "correction"). When this track's own offset is already implausible for real
// clock drift, checks every other track in the trip for one the same batch would fit *plausibly*
// instead, and returns whichever such track needs the smallest correction — the strongest
// candidate for "this is actually where these photos belong." Returns null when this track's own
// offset is already plausible (the common case, and by far the most likely explanation), or when
// no other track fits any better.
export function suggestBetterTrack(
  currentOffsetMinutes: number,
  photoTimestamps: string[],
  otherTracks: TrackTimeRange[]
): TrackSuggestion | null {
  if (Math.abs(currentOffsetMinutes) <= PLAUSIBLE_DRIFT_MINUTES) return null

  let best: TrackSuggestion | null = null
  for (const track of otherTracks) {
    const { offsetMinutes } = detectTimezoneOffset(track.startIso, track.endIso, photoTimestamps)
    if (Math.abs(offsetMinutes) > PLAUSIBLE_DRIFT_MINUTES) continue
    if (best === null || Math.abs(offsetMinutes) < Math.abs(best.offsetMinutes)) {
      best = { trackId: track.trackId, name: track.name, date: track.date, offsetMinutes }
    }
  }
  return best
}
