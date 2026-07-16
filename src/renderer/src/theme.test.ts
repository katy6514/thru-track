import { describe, it, expect } from 'vitest'
import { getThemeForTime } from './theme'

describe('getThemeForTime', () => {
  it('returns light in the morning', () => {
    expect(getThemeForTime(new Date('2026-07-01T08:00:00'))).toBe('light')
  })

  it('returns light right up to the evening boundary', () => {
    expect(getThemeForTime(new Date('2026-07-01T17:59:00'))).toBe('light')
  })

  it('returns dark at night', () => {
    expect(getThemeForTime(new Date('2026-07-01T22:00:00'))).toBe('dark')
  })

  it('returns dark in the early morning before the light boundary', () => {
    expect(getThemeForTime(new Date('2026-07-01T05:59:00'))).toBe('dark')
  })

  it('switches to light exactly at the start hour', () => {
    expect(getThemeForTime(new Date('2026-07-01T06:00:00'))).toBe('light')
  })

  it('switches to dark exactly at the end hour', () => {
    expect(getThemeForTime(new Date('2026-07-01T18:00:00'))).toBe('dark')
  })
})
