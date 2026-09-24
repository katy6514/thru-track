import { describe, it, expect } from 'vitest'
import { stateForPoint } from './stateForPoint'

describe('stateForPoint', () => {
  it('identifies a point in the interior of a state', () => {
    expect(stateForPoint(39.7392, -104.9903)).toBe('Colorado') // Denver
  })

  it('identifies a point near a mountain-state border', () => {
    expect(stateForPoint(46.8721, -113.994)).toBe('Montana') // Missoula
  })

  it('identifies a point in a Pacific-coast state', () => {
    expect(stateForPoint(47.6062, -122.3321)).toBe('Washington') // Seattle
  })

  it('identifies a point on an island state (MultiPolygon geometry)', () => {
    expect(stateForPoint(21.47, -158.02)).toBe('Hawaii') // central Oahu
  })

  it('returns null for a point in open ocean, outside any state', () => {
    expect(stateForPoint(0, 0)).toBeNull() // Gulf of Guinea
  })

  it('returns null for a point outside the US entirely', () => {
    expect(stateForPoint(48.8566, 2.3522)).toBeNull() // Paris
  })
})
