import { describe, it, expect } from 'vitest'
import { orderPhotosChronologically } from './orderPhotos'
import type { Photo } from './types'

function photo(id: number, timestamp: string | null): Photo {
  return {
    id,
    trackId: 1,
    filepath: `${id}.jpg`,
    timestamp,
    lat: null,
    lng: null,
    caption: null,
    createdAt: '2026-09-15T00:00:00Z'
  }
}

describe('orderPhotosChronologically', () => {
  it('sorts timestamped photos oldest first', () => {
    const result = orderPhotosChronologically([
      photo(1, '2026-09-15T12:00:00Z'),
      photo(2, '2026-09-15T09:00:00Z'),
      photo(3, '2026-09-15T15:00:00Z')
    ])
    expect(result.map((p) => p.id)).toEqual([2, 1, 3])
  })

  it('sorts every photo with no timestamp after every timestamped photo', () => {
    const result = orderPhotosChronologically([
      photo(1, null),
      photo(2, '2026-09-15T09:00:00Z'),
      photo(3, null)
    ])
    expect(result.map((p) => p.id)).toEqual([2, 1, 3])
  })

  it('does not mutate the input array', () => {
    const input = [photo(1, '2026-09-15T12:00:00Z'), photo(2, '2026-09-15T09:00:00Z')]
    const result = orderPhotosChronologically(input)
    expect(result).not.toBe(input)
    expect(input.map((p) => p.id)).toEqual([1, 2])
  })
})
