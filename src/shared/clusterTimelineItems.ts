// A few photos taken two minutes apart at a viewpoint land on nearly the same spot on a
// full-day timeline strip — close enough that their marker dots overlap and none of them are
// individually clickable. Rather than making the hiker zoom the whole timeline in to separate
// them (a separate mode with its own controls and state), items within CLUSTER_THRESHOLD_PERCENT
// of each other group into one cluster marker that opens a small picker on click.

export interface TimelineItem {
  kind: 'note' | 'photo' | 'message'
  id: number
  ms: number
}

export interface TimelineCluster {
  items: TimelineItem[]
  percent: number
}

// How close two items' positions (as a percent of the full track duration) have to be to count
// as visually overlapping. 2% of a typical ~10-hour hiking day is about 12 minutes — close enough
// that two dots would touch on a normal-width timeline strip.
export const CLUSTER_THRESHOLD_PERCENT = 2

function percentOf(ms: number, trackStartMs: number, spanMs: number): number {
  return spanMs > 0 ? ((ms - trackStartMs) / spanMs) * 100 : 0
}

/**
 * Groups timeline items into clusters by proximity along the [trackStartMs, trackEndMs] axis.
 * Single-linkage: items are sorted by position, then grouped whenever the gap to the previous
 * item is under {@link CLUSTER_THRESHOLD_PERCENT} — so a chain of items each close to the next
 * clusters together even if the first and last are farther apart than the threshold alone. A
 * cluster's displayed position is the average of its members', so the marker sits at their
 * midpoint rather than snapping to whichever member happened to sort first.
 */
export function clusterTimelineItems(
  items: TimelineItem[],
  trackStartMs: number,
  trackEndMs: number
): TimelineCluster[] {
  const spanMs = trackEndMs - trackStartMs

  const sorted = [...items].sort((a, b) => a.ms - b.ms)

  const clusters: TimelineCluster[] = []
  let lastPercent: number | null = null
  for (const item of sorted) {
    const percent = percentOf(item.ms, trackStartMs, spanMs)
    const current = clusters[clusters.length - 1]
    if (current && lastPercent !== null && percent - lastPercent < CLUSTER_THRESHOLD_PERCENT) {
      current.items.push(item)
    } else {
      clusters.push({ items: [item], percent })
    }
    lastPercent = percent
  }

  for (const cluster of clusters) {
    cluster.percent =
      cluster.items.reduce((sum, item) => sum + percentOf(item.ms, trackStartMs, spanMs), 0) /
      cluster.items.length
  }

  return clusters
}
