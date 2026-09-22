import { describe, it, expect } from 'vitest'
import { hashPhotoContent } from './fileStorageManager'

describe('hashPhotoContent', () => {
  it('produces the same hash for identical bytes', () => {
    const a = Buffer.from('same photo bytes')
    const b = Buffer.from('same photo bytes')
    expect(hashPhotoContent(a)).toBe(hashPhotoContent(b))
  })

  it('produces different hashes for different bytes', () => {
    const a = Buffer.from('photo one')
    const b = Buffer.from('photo two')
    expect(hashPhotoContent(a)).not.toBe(hashPhotoContent(b))
  })
})
