import { randomBytes, randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server } from 'http'
import { networkInterfaces, tmpdir } from 'os'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import busboy from 'busboy'
import QRCode from 'qrcode'

// How long the server stays up with no requests before it shuts itself down — a same-network
// upload session is meant to be short-lived (walk over to the trailhead wifi, send photos, done),
// not something that lingers as a silent background listener.
const IDLE_TIMEOUT_MS = 10 * 60 * 1000

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100MB per request, generous for a batch of phone photos

export interface UploadedFile {
  filePath: string
  originalName: string
}

export interface StartedUploadServer {
  url: string
  qrDataUri: string
  stop: () => void
}

// Picks the machine's LAN-facing IPv4 address so the URL shown to the hiker is one their phone
// can actually reach over the same wifi/hotspot — `internal` interfaces (loopback) are useless for
// this since the whole point is a second device connecting in. Exported for unit testing without
// needing to fake the real network stack.
export function pickLanAddress(
  interfaces: NodeJS.Dict<{ address: string; family: string; internal: boolean }[]>
): string | null {
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (!info.internal && info.family === 'IPv4') {
        return info.address
      }
    }
  }
  return null
}

// Starts a short-lived local HTTP server bound to the machine's LAN address so a phone on the
// same network can open a plain upload page and send photos straight to this desktop app — no
// cloud intermediary, no companion app to install. See issue #33 for the full design rationale.
//
// `onFilesReceived` fires once per completed upload request with the temp-disk paths of whatever
// was uploaded; the caller (ipc.ts) is responsible for running those through the same EXIF/
// timezone-offset pipeline used by the regular file-picker import, so both paths share identical
// matching logic.
export function startPhotoUploadServer(
  onFilesReceived: (files: UploadedFile[]) => void
): Promise<StartedUploadServer> {
  const token = randomBytes(16).toString('hex')
  const address = pickLanAddress(networkInterfaces())
  if (!address) {
    return Promise.reject(
      new Error('No LAN network address found — connect to wifi and try again.')
    )
  }

  let idleTimer: NodeJS.Timeout
  const resetIdleTimer = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => server.close(), IDLE_TIMEOUT_MS)
  }

  const uploadDir = join(tmpdir(), 'thru-track-phone-uploads', randomUUID())

  const server: Server = createServer((req, res) => {
    resetIdleTimer()
    const url = new URL(req.url ?? '/', 'http://placeholder')
    if (url.searchParams.get('t') !== token) {
      res.writeHead(401).end('Invalid or missing token')
      return
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(uploadPageHtml(token))
      return
    }

    if (req.method === 'POST' && url.pathname === '/upload') {
      handleUpload(req, uploadDir, MAX_UPLOAD_BYTES)
        .then((files) => {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }))
          if (files.length > 0) onFilesReceived(files)
        })
        .catch((err) => {
          res.writeHead(500).end(String(err instanceof Error ? err.message : err))
        })
      return
    }

    res.writeHead(404).end('Not found')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '0.0.0.0', async () => {
      const addressInfo = server.address()
      const port = typeof addressInfo === 'object' && addressInfo !== null ? addressInfo.port : 0
      const url = `http://${address}:${port}/?t=${token}`
      const qrDataUri = await QRCode.toDataURL(url)
      resetIdleTimer()
      resolve({
        url,
        qrDataUri,
        stop: () => {
          clearTimeout(idleTimer)
          server.close()
        }
      })
    })
  })
}

function handleUpload(
  req: IncomingMessage,
  uploadDir: string,
  maxBytes: number
): Promise<UploadedFile[]> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers, limits: { fileSize: maxBytes } })
    const files: UploadedFile[] = []
    const pendingWrites: Promise<void>[] = []

    bb.on('file', (_name, stream, info) => {
      const write = (async (): Promise<void> => {
        await mkdir(uploadDir, { recursive: true })
        const destPath = join(uploadDir, `${randomUUID()}-${info.filename}`)
        await new Promise<void>((res, rej) => {
          const out = createWriteStream(destPath)
          stream.pipe(out)
          out.on('finish', res)
          out.on('error', rej)
          stream.on('error', rej)
        })
        files.push({ filePath: destPath, originalName: info.filename })
      })()
      pendingWrites.push(write)
    })

    bb.on('close', () => {
      Promise.all(pendingWrites).then(() => resolve(files), reject)
    })
    bb.on('error', reject)

    req.pipe(bb)
  })
}

function uploadPageHtml(token: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Thru Track — send photos</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 20px; color: #1b1b1f; }
  h1 { font-size: 20px; }
  input[type=file] { display: block; margin: 20px 0; width: 100%; }
  button { font-size: 16px; padding: 12px 20px; border-radius: 8px; border: none; background: #2563eb; color: white; width: 100%; }
  button:disabled { background: #94a3b8; }
  #status { margin-top: 16px; font-size: 14px; }
  .ok { color: #157a3d; }
  .err { color: #d13c3c; }
</style>
</head>
<body>
  <h1>Send photos to Thru Track</h1>
  <p>Pick photos from this day, then send. They'll appear on your desktop's map/timeline shortly.</p>
  <input id="files" type="file" accept="image/*" multiple />
  <button id="send">Send photos</button>
  <div id="status"></div>
  <script>
    const token = ${JSON.stringify(token)}
    const input = document.getElementById('files')
    const button = document.getElementById('send')
    const status = document.getElementById('status')

    button.addEventListener('click', async () => {
      const files = input.files
      if (!files || files.length === 0) {
        status.textContent = 'Choose at least one photo first.'
        status.className = 'err'
        return
      }
      button.disabled = true
      status.textContent = 'Sending ' + files.length + ' photo(s)...'
      status.className = ''
      const formData = new FormData()
      for (const file of files) formData.append('photos', file)
      try {
        const response = await fetch('/upload?t=' + token, { method: 'POST', body: formData })
        if (!response.ok) throw new Error('Upload failed (' + response.status + ')')
        status.textContent = 'Sent! You can close this page or send more.'
        status.className = 'ok'
        input.value = ''
      } catch (err) {
        status.textContent = 'Something went wrong: ' + err.message
        status.className = 'err'
      } finally {
        button.disabled = false
      }
    })
  </script>
</body>
</html>`
}
