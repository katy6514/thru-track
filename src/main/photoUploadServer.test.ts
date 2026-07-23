import { describe, it, expect } from 'vitest'
import { pickLanAddress, startPhotoUploadServer } from './photoUploadServer'
import { readFile } from 'fs/promises'
import { join } from 'path'

describe('pickLanAddress', () => {
  it('skips internal (loopback) interfaces', () => {
    const address = pickLanAddress({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
    })
    expect(address).toBeNull()
  })

  it('skips IPv6 interfaces', () => {
    const address = pickLanAddress({
      en0: [{ address: 'fe80::1', family: 'IPv6', internal: false }]
    })
    expect(address).toBeNull()
  })

  it('picks the first non-internal IPv4 address', () => {
    const address = pickLanAddress({
      lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: 'fe80::1', family: 'IPv6', internal: false },
        { address: '192.168.1.42', family: 'IPv4', internal: false }
      ]
    })
    expect(address).toBe('192.168.1.42')
  })

  it('returns null when nothing usable is found', () => {
    expect(pickLanAddress({})).toBeNull()
  })
})

describe('startPhotoUploadServer', () => {
  it('rejects a request with a missing or wrong token', async () => {
    const server = await startPhotoUploadServer(() => {})
    try {
      const res = await fetch(server.url.replace(/\?t=.*/, '?t=wrong'))
      expect(res.status).toBe(401)
    } finally {
      server.stop()
    }
  })

  it('serves the upload page at the token-bearing URL', async () => {
    const server = await startPhotoUploadServer(() => {})
    try {
      const res = await fetch(server.url)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Send photos to Thru Track')
    } finally {
      server.stop()
    }
  })

  it('accepts an uploaded file and reports it to the callback', async () => {
    const received: string[] = []
    const server = await startPhotoUploadServer((files) => {
      for (const f of files) received.push(f.originalName)
    })
    try {
      const fixturePath = join(__dirname, '__fixtures__/photo-with-exif.jpg')
      const buffer = await readFile(fixturePath)
      const formData = new FormData()
      formData.append('photos', new Blob([buffer]), 'photo-with-exif.jpg')

      const uploadUrl = server.url.replace('/?t=', '/upload?t=')
      const res = await fetch(uploadUrl, { method: 'POST', body: formData })
      expect(res.status).toBe(200)

      // The callback fires once busboy finishes writing the file to disk, which happens
      // synchronously within the request/response cycle above, so no polling is needed.
      expect(received).toEqual(['photo-with-exif.jpg'])
    } finally {
      server.stop()
    }
  })

  it('generates a QR code data URI for the upload URL', async () => {
    const server = await startPhotoUploadServer(() => {})
    try {
      expect(server.qrDataUri.startsWith('data:image/png;base64,')).toBe(true)
    } finally {
      server.stop()
    }
  })
})
