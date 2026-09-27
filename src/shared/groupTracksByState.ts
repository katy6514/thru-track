import type { Track, TrackPoint } from './types'
import { stateForPoint } from './stateForPoint'

// A day's own GPS track can run to thousands of points — sampling a bounded, evenly-spaced subset
// keeps state classification fast without needing every single point to know roughly how a track
// is distributed across state lines.
const MAX_SAMPLES_PER_TRACK = 25

// A track's dominant state must cover at least this fraction of its sampled points to count as
// "cleanly" in that state. Below this, the track genuinely straddles more than one state — not
// just its first point landing near a line — and is treated as ambiguous.
const DOMINANCE_THRESHOLD = 0.9

const UNKNOWN_LABEL = 'Other'

export interface StateGroup {
  // A plain state name for an ordinary group, or two states joined with " / " for a border
  // cluster (see clusterClassifications) — or UNKNOWN_LABEL when no track in the group resolved
  // to any state at all.
  label: string
  // The real state name(s) behind `label`, in first-seen order — empty for the unknown group.
  states: string[]
  tracks: Track[]
}

export interface TrackClassification {
  track: Track
  // The state most of the track's sampled points fall in — null only when no sampled point
  // resolved to any state (open ocean, outside the bundled boundaries entirely).
  dominant: string | null
  // True when `dominant` didn't clearly cover the track's own points (see DOMINANCE_THRESHOLD).
  ambiguous: boolean
}

function sampleIndices(length: number, maxSamples: number): number[] {
  if (length <= maxSamples) return Array.from({ length }, (_, i) => i)
  const indices = new Set<number>()
  for (let i = 0; i < maxSamples; i++) {
    indices.add(Math.round((i * (length - 1)) / (maxSamples - 1)))
  }
  return Array.from(indices)
}

function classifyTrack(track: Track, points: TrackPoint[] | undefined): TrackClassification {
  if (!points || points.length === 0) return { track, dominant: null, ambiguous: false }

  const counts = new Map<string, number>()
  let total = 0
  for (const index of sampleIndices(points.length, MAX_SAMPLES_PER_TRACK)) {
    const state = stateForPoint(points[index].lat, points[index].lng)
    if (state === null) continue
    counts.set(state, (counts.get(state) ?? 0) + 1)
    total++
  }

  if (total === 0) return { track, dominant: null, ambiguous: false }

  let dominant = ''
  let dominantCount = 0
  for (const [state, count] of counts) {
    if (count > dominantCount) {
      dominant = state
      dominantCount = count
    }
  }

  return { track, dominant, ambiguous: dominantCount / total < DOMINANCE_THRESHOLD }
}

// A run of consecutive tracks that share the same clean dominant state, run-length-encoded into
// one unit — or a single individually ambiguous track standing alone. This is what the
// border-detection pass below actually operates on, rather than raw per-track classifications.
interface Block {
  // null only for a track (or run of them) that resolved to no state at all.
  state: string | null
  ambiguous: boolean
  tracks: Track[]
}

// A track with no GPS data at all (most commonly a zero day — a rest day has no path to sample)
// carries no information about which state it happened in, but it definitely happened *somewhere
// along the trip*, physically alongside whatever state the days around it were in. Rather than
// treat it like a genuinely unresolvable track (which would force a hard break — splitting an
// otherwise long, clean run into repeated same-state groups with "Other" wedged between them,
// once per zero day), it's folded into whichever block it's adjacent to: onto the tail of the
// block already in progress, or — if it comes before any real block has started yet — held until
// the first one appears and prepended to it instead. Only a stretch with no real block at all
// (the whole trip has no GPS data) falls through to becoming its own unresolvable block.
function buildBlocks(classifications: TrackClassification[]): Block[] {
  const blocks: Block[] = []
  let leadingNoDataTracks: Track[] = []
  for (const c of classifications) {
    if (c.dominant === null) {
      const previous = blocks[blocks.length - 1]
      if (previous) previous.tracks.push(c.track)
      else leadingNoDataTracks.push(c.track)
      continue
    }
    const previous = blocks[blocks.length - 1]
    if (previous && !previous.ambiguous && !c.ambiguous && previous.state === c.dominant) {
      previous.tracks.push(c.track)
      continue
    }
    blocks.push({ state: c.dominant, ambiguous: c.ambiguous, tracks: [c.track] })
    if (leadingNoDataTracks.length > 0) {
      blocks[blocks.length - 1].tracks.unshift(...leadingNoDataTracks)
      leadingNoDataTracks = []
    }
  }
  if (leadingNoDataTracks.length > 0) {
    blocks.push({ state: null, ambiguous: false, tracks: leadingNoDataTracks })
  }
  return blocks
}

interface Cluster {
  states: string[]
  tracks: Track[]
}

// A clean (non-ambiguous) block this long or longer represents a genuinely settled stretch in one
// state — days of committed hiking, not a brief touch — and can never be absorbed into a border
// cluster, no matter how close it sits to one. Without this, a long clean run sitting right next
// to a short oscillating stretch (the common real shape: weeks settled in one state, then a few
// days hugging a border, then weeks settled in the next) would get swallowed whole into the
// border group the moment that first state's name happened to recur nearby — see this module's
// test file for the real trip that motivated this constant.
const SETTLED_MIN_TRACKS = 3

function isSettled(block: Block): boolean {
  return !block.ambiguous && block.tracks.length >= SETTLED_MIN_TRACKS
}

// Detects a "border region" — a maximal, unbroken stretch of not-yet-settled blocks confined to
// at most two real states — and merges it into one shared group, instead of letting it fragment
// into alternating single-state groups (or splitting one genuinely mixed track's own days across
// two buckets by whichever state its first point happened to land in). A stretch only merges when
// it actually shows border-like behavior: a state recurring after the trip had already moved on
// from it, or an individually ambiguous track sitting in it. A single clean A-then-B transition —
// the common case, crossing a state line once — is left as two ordinary separate groups, exactly
// like every *other* boundary in a trip.
function clusterBlocks(blocks: Block[]): Cluster[] {
  const clusters: Cluster[] = []
  let i = 0
  while (i < blocks.length) {
    if (blocks[i].state === null) {
      clusters.push({ states: [], tracks: blocks[i].tracks })
      i++
      continue
    }

    if (isSettled(blocks[i])) {
      clusters.push({ states: [blocks[i].state as string], tracks: blocks[i].tracks })
      i++
      continue
    }

    // Greedily grow a window starting at i as far as possible while it touches at most two
    // distinct real states and never crosses into a settled block — every block along the way,
    // ambiguous or not, counts its own dominant state toward that two-state limit.
    const statesSeen: string[] = []
    let hasAmbiguous = false
    let j = i
    while (j < blocks.length) {
      const block = blocks[j]
      if (block.state === null || isSettled(block)) break
      if (block.ambiguous) hasAmbiguous = true
      if (!statesSeen.includes(block.state)) {
        if (statesSeen.length === 2) break
        statesSeen.push(block.state)
      }
      j++
    }

    const windowBlocks = blocks.slice(i, j)
    const realBlockCount = windowBlocks.filter((b) => !b.ambiguous).length
    // realBlockCount >= 3 with only 2 distinct real states means (by the pigeonhole principle)
    // at least one of them repeats — the actual oscillation signal.
    const isBorder =
      windowBlocks.length > 1 && (hasAmbiguous || (statesSeen.length === 2 && realBlockCount >= 3))

    if (isBorder) {
      clusters.push({ states: statesSeen, tracks: windowBlocks.flatMap((b) => b.tracks) })
      i = j
    } else {
      clusters.push({ states: [blocks[i].state as string], tracks: blocks[i].tracks })
      i++
    }
  }
  return clusters
}

// Turns a date-ordered list of per-track state classifications into display groups: ordinary
// single-state groups, border clusters (see clusterBlocks), and — merged into one, always last —
// an "Other" group for any track that resolved to no state at all. Exported separately from
// groupTracksByState below so the clustering logic itself can be tested with plain synthetic
// classifications, without needing real coordinates.
export function clusterClassifications(classifications: TrackClassification[]): StateGroup[] {
  const clusters = clusterBlocks(buildBlocks(classifications))

  const known = clusters.filter((c) => c.states.length > 0)
  const unknownTracks = clusters.filter((c) => c.states.length === 0).flatMap((c) => c.tracks)

  const groups: StateGroup[] = known.map((cluster) => ({
    label: cluster.states.join(' / '),
    states: cluster.states,
    tracks: cluster.tracks
  }))
  if (unknownTracks.length > 0) {
    groups.push({ label: UNKNOWN_LABEL, states: [], tracks: unknownTracks })
  }
  return groups
}

// Groups tracks by the US state(s) they were hiked through — in first-occurrence order, which
// (since `tracks` is already date-sorted) reads as the order the trip actually visited each
// state. See clusterClassifications for how a border-hugging stretch becomes one shared group
// instead of fragmenting by whichever side of the line each day's first point landed on.
export function groupTracksByState(
  tracks: Track[],
  pointsByTrackId: Map<number, TrackPoint[]>
): StateGroup[] {
  const classifications = tracks.map((track) => classifyTrack(track, pointsByTrackId.get(track.id)))
  return clusterClassifications(classifications)
}
