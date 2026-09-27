import { describe, it, expect } from 'vitest'
import { clusterTimelineItems, type TimelineItem } from './clusterTimelineItems'

// A tidy 1-hour track, from t=0 to t=3_600_000ms — real values would be epoch-ms but small round
// numbers make the math easy to verify by eye. 1% of this span is 36_000ms (36s).
const trackStartMs = 0
const trackEndMs = 3_600_000

function item(kind: TimelineItem['kind'], id: number, ms: number): TimelineItem {
  return { kind, id, ms }
}

describe('clusterTimelineItems', () => {
  it('puts each item in its own cluster when they are far apart', () => {
    const items = [
      item('message', 1, 0),
      item('photo', 2, 1_800_000),
      item('message', 3, 3_600_000)
    ]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters.map((c) => c.items.length)).toEqual([1, 1, 1])
    expect(clusters.map((c) => c.percent)).toEqual([0, 50, 100])
  })

  it('groups two items within the threshold into one cluster', () => {
    // 1% apart (36s) — under the 2% threshold.
    const items = [item('photo', 1, 0), item('photo', 2, 36_000)]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].items.map((i) => i.id)).toEqual([1, 2])
  })

  it('keeps items in separate clusters when exactly at the threshold', () => {
    // 2% apart (72s) — not under the threshold, so no grouping.
    const items = [item('photo', 1, 0), item('photo', 2, 72_000)]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters).toHaveLength(2)
  })

  it('chains a run of close items into one cluster via single-linkage', () => {
    // Each consecutive pair is 1% apart, but the first and last are 3% apart — still one cluster
    // since clustering is decided by the gap to the previous item, not the cluster's full span.
    const items = [item('message', 1, 0), item('photo', 2, 36_000), item('message', 3, 72_000)]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].items.map((i) => i.id)).toEqual([1, 2, 3])
  })

  it("centers a cluster's position on the average of its members, not the first member", () => {
    const items = [item('photo', 1, 0), item('photo', 2, 36_000)]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters[0].percent).toBeCloseTo(0.5, 5)
  })

  it('mixes items of different kinds into the same cluster', () => {
    const items = [item('message', 1, 0), item('photo', 2, 10_000), item('message', 3, 20_000)]
    const clusters = clusterTimelineItems(items, trackStartMs, trackEndMs)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].items.map((i) => i.kind)).toEqual(['message', 'photo', 'message'])
  })

  it('returns an empty array for no items', () => {
    expect(clusterTimelineItems([], trackStartMs, trackEndMs)).toEqual([])
  })

  it('does not divide by zero when the track has no duration', () => {
    const items = [item('message', 1, 5_000), item('photo', 2, 5_000)]
    const clusters = clusterTimelineItems(items, 5_000, 5_000)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].percent).toBe(0)
  })
})
