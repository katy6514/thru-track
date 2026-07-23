import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type {
  Track,
  TrackPoint,
  JournalNote,
  Photo,
  PendingPhoto,
  PhotoImportNeedsOffset,
  Message
} from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../../../shared/splitTrackSegments'
import { interpolatePosition } from '../../../shared/positionInterpolator'
import {
  zoomIn as zoomWindowIn,
  zoomOut as zoomWindowOut,
  pan as panWindow,
  clampToWindow,
  percentInWindow,
  type TimeWindow
} from '../../../shared/timelineWindow'
import SidePanel from './SidePanel'

// Leaflet's default marker icon references relative image paths that resolve fine when its CSS
// is served as-is, but break once a bundler (Vite here) rewrites asset URLs — the icon silently
// 404s and renders as a broken-image placeholder. Re-pointing it at the bundler-resolved URLs is
// the standard fix; without this every marker on the map would be invisible/broken.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
})

// A photo pin needs to read as visually distinct from the plain default marker (track start /
// scrub position) at a glance. Built as a CSS-styled divIcon rather than another image asset —
// that sidesteps the exact bundler-rewritten-asset-path problem the comment above works around,
// with one less image import to get wrong.
const photoIcon = L.divIcon({
  className: 'photo-map-marker',
  html: '<div class="photo-map-marker-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
})

interface TrackDetailProps {
  track: Track
  onBack: () => void
  onWriteJournal: () => void
}

function renderTrackMap(
  container: HTMLDivElement,
  points: TrackPoint[]
): { map: L.Map; marker: L.Marker | null; messageLayer: L.LayerGroup } {
  const map = L.map(container)

  // A satellite message always carries its own GPS position (unlike a photo or a journal note),
  // so its map markers are populated by a separate effect keyed on the `messages` state — this
  // empty layer group is just the place they get added to, independent of whether the track
  // itself is timed.
  const messageLayer = L.layerGroup().addTo(map)

  // OpenTopoMap renders contour lines and hillshading from SRTM elevation data on top of OSM
  // data — chosen over a plain street basemap so elevation is visible at a glance, and over
  // options like Thunderforest since it needs no API key/signup. Its tile server only produces
  // tiles up to z17 (beyond that there's no more source detail to show).
  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17
  }).addTo(map)

  if (points.length === 0) {
    map.setView([0, 0], 2)
    return { map, marker: null, messageLayer }
  }

  // A track with a time gap (e.g. a paused/lost-signal recorder) is split
  // into separate contiguous runs and rendered as separate polylines, so
  // the gap shows up as a visual break rather than a straight line jumping
  // across it.
  const segments = splitTrackIntoSegments(points)
  const allLatLngs: L.LatLngExpression[] = []

  for (const segment of segments) {
    const latLngs: L.LatLngExpression[] = segment.map((p) => [p.lat, p.lng])
    L.polyline(latLngs, { color: '#2563eb', weight: 4 }).addTo(map)
    allLatLngs.push(...latLngs)
  }

  map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] })

  // Only a timed track has a timeline to scrub, so only it gets a position marker — a timeless
  // track (e.g. a CalTopo retrace) has no per-point time to place a marker at a moment of.
  const isTimed = points[0].timestamp !== null
  const marker = isTimed ? L.marker([points[0].lat, points[0].lng]).addTo(map) : null

  return { map, marker, messageLayer }
}

// Converts an epoch-ms instant into the local-time string a `datetime-local` input expects
// ("YYYY-MM-DDTHH:mm"). Deliberately uses local time-of-day components (not UTC) since that's
// what a `datetime-local` input always displays/edits — round-tripping through `new Date(value)`
// on submit reconstructs the correct instant regardless of timezone.
function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatNoteTitle(note: JournalNote): string {
  return note.timestamp ? new Date(note.timestamp).toLocaleString() : 'Note'
}

function formatPhotoTitle(photo: Photo): string {
  return photo.timestamp ? new Date(photo.timestamp).toLocaleString() : 'Photo'
}

function formatMessageTitle(message: Message): string {
  return new Date(message.timestamp).toLocaleString()
}

// Renders a signed minutes offset in a readable "+2h 30m" (or "-1h", "+45m", "no offset") form
// for the confirmation prompt, rather than a bare (and easy to misread) minutes count.
function formatOffset(minutes: number): string {
  if (minutes === 0) return 'no offset'
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  if (hours === 0) return `${sign}${mins}m`
  if (mins === 0) return `${sign}${hours}h`
  return `${sign}${hours}h ${mins}m`
}

// Which side-panel item (if any) is currently open. A note, a photo, and a message can never be
// open at the same time — this is a single discriminated slot rather than several independent
// "selected id" states, so selecting one always closes whichever other kind was open.
type SelectedItem =
  | { kind: 'note'; id: number }
  | { kind: 'photo'; id: number }
  | { kind: 'message'; id: number }
  | null

function TrackDetail({ track, onBack, onWriteJournal }: TrackDetailProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const photoMarkersRef = useRef<L.Marker[]>([])
  const messageLayerRef = useRef<L.LayerGroup | null>(null)
  const [error, setError] = useState('')
  const [points, setPoints] = useState<TrackPoint[] | null>(null)
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const [scrubStatus, setScrubStatus] = useState<'ok' | 'gap' | 'out-of-range'>('ok')
  // The timeline's currently-visible [startMs, endMs] slice — defaults to the full track range
  // and narrows/shifts via the zoom/pan controls below. Kept separate from trackStartMs/
  // trackEndMs (the track's fixed full-day bounds) so those bounds stay available to clamp
  // zooming/panning against even while `visibleWindow` itself is narrower.
  const [visibleWindow, setVisibleWindow] = useState<TimeWindow | null>(null)

  const [notes, setNotes] = useState<JournalNote[]>([])
  const [noteContent, setNoteContent] = useState('')
  const [noteTimestampInput, setNoteTimestampInput] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState('')
  // Once the hiker edits the timestamp field directly, stop overwriting it as the timeline is
  // scrubbed — "defaults to the current scrub position" should only apply until they've made
  // their own choice.
  const noteTimestampTouchedRef = useRef(false)

  const [photos, setPhotos] = useState<Photo[]>([])
  const [importingPhotos, setImportingPhotos] = useState(false)
  const [photoError, setPhotoError] = useState('')
  // Set when photos:import comes back with needsOffsetConfirm — a timed track and at least one
  // EXIF timestamp in the batch means there's an actual offset to confirm/adjust before this
  // batch is stored. Nothing has been copied to managed storage or written to the DB yet at this
  // point, so canceling out of this prompt simply discards `pending` — no cleanup needed.
  const [pendingOffsetImport, setPendingOffsetImport] = useState<{
    pending: PendingPhoto[]
    proposedOffsetMinutes: number
  } | null>(null)
  const [offsetInput, setOffsetInput] = useState('0')

  // Set while a phone-upload session (issue #33) is running: the URL/QR the hiker's phone
  // connects to. Null means no session is active — the server itself is only running on the main
  // process while this is non-null.
  const [phoneUploadSession, setPhoneUploadSession] = useState<{
    url: string
    qrDataUri: string
  } | null>(null)
  const [startingPhoneUpload, setStartingPhoneUpload] = useState(false)
  const [phoneUploadError, setPhoneUploadError] = useState('')

  const [messages, setMessages] = useState<Message[]>([])
  const [importingMessages, setImportingMessages] = useState(false)
  const [messageError, setMessageError] = useState('')

  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [photoDataUri, setPhotoDataUri] = useState<string | null>(null)
  const [photoDataLoading, setPhotoDataLoading] = useState(false)
  const [photoDataError, setPhotoDataError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    setPoints(null)
    setScrubMs(null)
    setScrubStatus('ok')
    // A stale zoom/pan window from a previously-viewed track must never leak into a newly-opened
    // one — reset alongside scrubMs/points below, and re-derived to the full range once the new
    // track's points load (see the .then callback).
    setVisibleWindow(null)
    setNotes([])
    setPhotos([])
    setMessages([])
    setSelectedItem(null)
    setNoteContent('')
    setNoteTimestampInput('')
    setNoteError('')
    setPhotoError('')
    setMessageError('')
    setPendingOffsetImport(null)
    setOffsetInput('0')
    // A phone-upload session is scoped to the track it was started from — switching tracks (or
    // unmounting) must not leave a server running against the day the hiker just navigated away
    // from, so stop it here rather than requiring an explicit "Done" click every time.
    window.api.photoUpload.stop()
    setPhoneUploadSession(null)
    setPhoneUploadError('')
    noteTimestampTouchedRef.current = false

    Promise.all([
      window.api.tracks.getPoints(track.id),
      window.api.notes.list(track.id),
      window.api.photos.list(track.id),
      window.api.messages.list(track.id)
    ])
      .then(([fetchedPoints, fetchedNotes, fetchedPhotos, fetchedMessages]) => {
        if (cancelled || !mapContainerRef.current) return
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        photoMarkersRef.current = []
        const { map, marker, messageLayer } = renderTrackMap(mapContainerRef.current, fetchedPoints)
        mapRef.current = map
        markerRef.current = marker
        messageLayerRef.current = messageLayer
        setPoints(fetchedPoints)
        setNotes(fetchedNotes)
        setPhotos(fetchedPhotos)
        setMessages(fetchedMessages)
        if (fetchedPoints.length > 0 && fetchedPoints[0].timestamp !== null) {
          const startMs = Date.parse(fetchedPoints[0].timestamp as string)
          const endMs = Date.parse(fetchedPoints[fetchedPoints.length - 1].timestamp as string)
          setScrubMs(startMs)
          setVisibleWindow({ startMs, endMs })
        }
      })
      .catch((err) => {
        if (!cancelled) setError(cleanErrorMessage(err))
      })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRef.current = null
      photoMarkersRef.current = []
      messageLayerRef.current = null
    }
  }, [track.id])

  // Message markers are re-rendered onto the map's message layer whenever `messages` changes —
  // both on initial track load and after a fresh CSV import — rather than only once at map
  // creation, so a newly imported batch shows up on the map immediately without reloading the
  // track. A message's marker uses its own lat/lng straight from the CSV, independent of whether
  // the track itself is timed (unlike the track's own position marker above).
  useEffect(() => {
    const layer = messageLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const message of messages) {
      L.circleMarker([message.lat, message.lng], {
        radius: 7,
        weight: 2,
        color: '#0d9488',
        fillColor: '#2dd4bf',
        fillOpacity: 0.9
      })
        .bindTooltip(message.content || '(no message text)')
        .on('click', () => setSelectedItem({ kind: 'message', id: message.id }))
        .addTo(layer)
    }
  }, [messages])

  const isTimed = points !== null && points.length > 0 && points[0].timestamp !== null
  const trackStartMs = isTimed && points ? Date.parse(points[0].timestamp as string) : null
  const trackEndMs =
    isTimed && points ? Date.parse(points[points.length - 1].timestamp as string) : null

  // Keeps the map's photo pins in sync with the `photos` state, independent of the initial
  // track-load effect above — this also fires right after a fresh batch is imported, without
  // needing to re-fetch points/notes or rebuild the whole map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const existing of photoMarkersRef.current) existing.remove()
    photoMarkersRef.current = []

    for (const photo of photos) {
      if (photo.lat === null || photo.lng === null) continue
      const marker = L.marker([photo.lat, photo.lng], { icon: photoIcon }).addTo(map)
      marker.on('click', () => setSelectedItem({ kind: 'photo', id: photo.id }))
      photoMarkersRef.current.push(marker)
    }
  }, [photos])

  // Keep the "add note" timestamp field defaulted to wherever the timeline is currently
  // scrubbed to, until the hiker starts editing it themselves.
  useEffect(() => {
    if (scrubMs !== null && !noteTimestampTouchedRef.current) {
      setNoteTimestampInput(toDatetimeLocalValue(scrubMs))
    }
  }, [scrubMs])

  // The single place that moves the map marker to match an absolute epoch-ms instant — shared by
  // the slider's onChange below and by the zoom/pan handlers (which need to re-sync the marker
  // whenever narrowing/shifting the visible window clamps `scrubMs` to a new position), so there's
  // only ever one implementation of "move the marker" to keep correct.
  const applyScrub = (ms: number): void => {
    if (!points) return
    setScrubMs(ms)

    const result = interpolatePosition(points, ms)
    setScrubStatus(result.status)
    if (result.status === 'ok' && markerRef.current) {
      markerRef.current.setLatLng([result.lat, result.lng])
      markerRef.current.setOpacity(1)
    } else if (markerRef.current) {
      // A gap (or, defensively, an out-of-range scrub) has no real position to show — hiding
      // the marker is more honest than leaving it sitting at the last known point, which would
      // read as "this is where you were" rather than "we don't actually know."
      markerRef.current.setOpacity(0)
    }
  }

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    applyScrub(Number(e.target.value))
  }

  // Applies a zoom/pan window change: updates `visibleWindow`, then re-syncs `scrubMs` and the map
  // marker through the exact same `applyScrub` path a manual slider drag uses — if the scrub
  // position falls outside the new window it's clamped to the nearest edge, exactly like a normal
  // scrub to that instant would behave.
  const applyWindowChange = (newWindow: TimeWindow): void => {
    setVisibleWindow(newWindow)
    if (scrubMs !== null) {
      applyScrub(clampToWindow(scrubMs, newWindow))
    }
  }

  const handleZoomIn = (): void => {
    if (!visibleWindow || trackStartMs === null || trackEndMs === null || scrubMs === null) return
    const bounds: TimeWindow = { startMs: trackStartMs, endMs: trackEndMs }
    applyWindowChange(zoomWindowIn(visibleWindow, bounds, scrubMs))
  }

  const handleZoomOut = (): void => {
    if (!visibleWindow || trackStartMs === null || trackEndMs === null || scrubMs === null) return
    const bounds: TimeWindow = { startMs: trackStartMs, endMs: trackEndMs }
    applyWindowChange(zoomWindowOut(visibleWindow, bounds, scrubMs))
  }

  const handlePan = (direction: 'earlier' | 'later'): void => {
    if (!visibleWindow || trackStartMs === null || trackEndMs === null) return
    const bounds: TimeWindow = { startMs: trackStartMs, endMs: trackEndMs }
    applyWindowChange(panWindow(visibleWindow, bounds, direction))
  }

  const isFullyZoomedOut =
    !!visibleWindow &&
    trackStartMs !== null &&
    trackEndMs !== null &&
    visibleWindow.startMs <= trackStartMs &&
    visibleWindow.endMs >= trackEndMs

  const handleAddNote = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const content = noteContent.trim()
    if (!content) return
    // A timed track's note is pinned to a moment on the timeline; a timeless track has no time
    // axis at all, so its notes are simply stored without one (see JournalNote's doc comment).
    if (isTimed && !noteTimestampInput) return

    setSavingNote(true)
    setNoteError('')
    try {
      const timestamp = isTimed ? new Date(noteTimestampInput).toISOString() : null
      await window.api.notes.create(track.id, content, timestamp)
      const updated = await window.api.notes.list(track.id)
      setNotes(updated)
      setNoteContent('')
    } catch (err) {
      setNoteError(cleanErrorMessage(err))
    } finally {
      setSavingNote(false)
    }
  }

  // Shared by the file-picker import below and the phone-upload event listener further down —
  // both paths resolve to the same Photo[] | PhotoImportNeedsOffset shape, so a batch that needs
  // an offset confirmation surfaces through the same prompt regardless of where it came from.
  const applyPhotoImportResult = (result: Photo[] | PhotoImportNeedsOffset): void => {
    if ('needsOffsetConfirm' in result) {
      // Nothing has been stored yet — hold the pending batch until the hiker confirms (or
      // adjusts) the proposed offset via handleConfirmOffset below.
      setPendingOffsetImport({
        pending: result.pending,
        proposedOffsetMinutes: result.proposedOffsetMinutes
      })
      setOffsetInput(String(result.proposedOffsetMinutes))
    } else if (result.length > 0) {
      window.api.photos.list(track.id).then(setPhotos)
    }
  }

  const handleImportPhotos = async (): Promise<void> => {
    setImportingPhotos(true)
    setPhotoError('')
    try {
      const result = await window.api.photos.import(track.id)
      applyPhotoImportResult(result)
    } catch (err) {
      setPhotoError(cleanErrorMessage(err))
    } finally {
      setImportingPhotos(false)
    }
  }

  const handleStartPhoneUpload = async (): Promise<void> => {
    setStartingPhoneUpload(true)
    setPhoneUploadError('')
    try {
      const session = await window.api.photoUpload.start(track.id)
      setPhoneUploadSession(session)
    } catch (err) {
      setPhoneUploadError(cleanErrorMessage(err))
    } finally {
      setStartingPhoneUpload(false)
    }
  }

  const handleStopPhoneUpload = async (): Promise<void> => {
    await window.api.photoUpload.stop()
    setPhoneUploadSession(null)
  }

  useEffect(() => {
    const unsubReceived = window.api.photoUpload.onBatchReceived(applyPhotoImportResult)
    const unsubError = window.api.photoUpload.onBatchError(setPhoneUploadError)
    return () => {
      unsubReceived()
      unsubError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id])

  const handleConfirmOffset = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!pendingOffsetImport) return
    const offsetMinutes = Number(offsetInput)
    if (!Number.isFinite(offsetMinutes)) return

    setImportingPhotos(true)
    setPhotoError('')
    try {
      await window.api.photos.importWithOffset(track.id, pendingOffsetImport.pending, offsetMinutes)
      setPendingOffsetImport(null)
      const updated = await window.api.photos.list(track.id)
      setPhotos(updated)
    } catch (err) {
      setPhotoError(cleanErrorMessage(err))
    } finally {
      setImportingPhotos(false)
    }
  }

  const handleCancelOffset = (): void => {
    // Nothing was ever copied/written for this batch — discarding the pending list is the whole
    // cancellation, no IPC call needed.
    setPendingOffsetImport(null)
  }

  const handleImportMessages = async (): Promise<void> => {
    setImportingMessages(true)
    setMessageError('')
    try {
      const result = await window.api.messages.importCsv(track.id)
      if (result === null) return // hiker canceled the file dialog
      const updated = await window.api.messages.list(track.id)
      setMessages(updated)
    } catch (err) {
      setMessageError(cleanErrorMessage(err))
    } finally {
      setImportingMessages(false)
    }
  }

  const selectedNote =
    selectedItem?.kind === 'note' ? (notes.find((n) => n.id === selectedItem.id) ?? null) : null
  const selectedPhoto =
    selectedItem?.kind === 'photo' ? (photos.find((p) => p.id === selectedItem.id) ?? null) : null
  const selectedMessage =
    selectedItem?.kind === 'message'
      ? (messages.find((m) => m.id === selectedItem.id) ?? null)
      : null

  // Fetches the actual image bytes (as a base64 data URI) only once a photo is selected — the
  // renderer can't read arbitrary local files itself, so the side panel shows a loading state
  // while main process reads the file and hands it back over IPC.
  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoDataUri(null)
      setPhotoDataError('')
      return
    }
    let cancelled = false
    setPhotoDataUri(null)
    setPhotoDataError('')
    setPhotoDataLoading(true)
    window.api.photos
      .getDataUri(selectedPhoto.id)
      .then((uri) => {
        if (!cancelled) setPhotoDataUri(uri)
      })
      .catch((err) => {
        if (!cancelled) setPhotoDataError(cleanErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setPhotoDataLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPhoto])

  // A photo only earns a timeline marker when the track itself is timed (there's a time axis to
  // place it on) AND the photo has its own EXIF timestamp. Everything else — every photo on a
  // timeless track, plus the rare timed-track photo with no EXIF timestamp at all — falls back
  // to the plain list below, the same way timeless-track notes do.
  const timelinePhotos = isTimed ? photos.filter((p) => p.timestamp !== null) : []
  const fallbackListPhotos = isTimed ? photos.filter((p) => p.timestamp === null) : photos

  // Items that fall outside the current visible window aren't rendered as markers at all (see
  // percentInWindow's null case below) — this count backs a small "N items outside this view"
  // notice so a hiker who's zoomed in isn't left wondering whether an item just vanished.
  const hiddenItemsCount = visibleWindow
    ? notes.filter(
        (n) =>
          n.timestamp !== null && percentInWindow(Date.parse(n.timestamp), visibleWindow) === null
      ).length +
      timelinePhotos.filter(
        (p) => percentInWindow(Date.parse(p.timestamp as string), visibleWindow) === null
      ).length +
      messages.filter((m) => percentInWindow(Date.parse(m.timestamp), visibleWindow) === null)
        .length
    : 0

  return (
    <div className="track-detail-layout">
      <div className="track-detail">
        <button type="button" className="back-link" onClick={onBack}>
          &larr; Back to tracks
        </button>

        <h1>{track.name}</h1>

        <div className="track-detail-actions">
          <button type="button" onClick={onWriteJournal}>
            Write journal entry
          </button>
          <button
            type="button"
            onClick={handleImportPhotos}
            disabled={importingPhotos || !!pendingOffsetImport}
          >
            {importingPhotos ? 'Importing photos…' : 'Import photos'}
          </button>
          <button type="button" onClick={handleImportMessages} disabled={importingMessages}>
            {importingMessages ? 'Importing…' : 'Import messages (CSV)'}
          </button>
          {phoneUploadSession ? (
            <button type="button" onClick={handleStopPhoneUpload}>
              Stop phone upload
            </button>
          ) : (
            <button type="button" onClick={handleStartPhoneUpload} disabled={startingPhoneUpload}>
              {startingPhoneUpload ? 'Starting…' : 'Upload from phone'}
            </button>
          )}
        </div>

        {phoneUploadSession && (
          <div className="phone-upload-panel">
            <img
              className="phone-upload-qr"
              src={phoneUploadSession.qrDataUri}
              alt="QR code linking to the phone upload page"
            />
            <div className="phone-upload-info">
              <p>
                On your phone, scan this code or open{' '}
                <span className="mono-inline">{phoneUploadSession.url}</span> while it&apos;s on
                the same wifi network (or tethered to this computer&apos;s hotspot).
              </p>
              <p className="phone-upload-hint">
                Photos you send there appear here automatically. Click &ldquo;Stop phone
                upload&rdquo; above when you&apos;re done.
              </p>
            </div>
          </div>
        )}
        {phoneUploadError && <p className="error">{phoneUploadError}</p>}

        {pendingOffsetImport && (
          <form className="offset-prompt" onSubmit={handleConfirmOffset}>
            <label htmlFor="offset-prompt-input">
              These photos&apos; timestamps look{' '}
              {formatOffset(pendingOffsetImport.proposedOffsetMinutes)} from the track&apos;s clock
              — apply this correction before placing them?
            </label>
            <div className="offset-prompt-controls">
              <input
                id="offset-prompt-input"
                type="number"
                step={1}
                className="offset-prompt-input"
                value={offsetInput}
                onChange={(e) => setOffsetInput(e.target.value)}
                aria-label="Offset in minutes"
                required
                autoFocus
              />
              <span className="offset-prompt-unit">
                minutes ({formatOffset(Number(offsetInput) || 0)})
              </span>
              <button type="submit" disabled={importingPhotos}>
                {importingPhotos ? 'Importing…' : 'Confirm'}
              </button>
              <button type="button" onClick={handleCancelOffset} disabled={importingPhotos}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && <p className="error">{error}</p>}
        {photoError && <p className="error">{photoError}</p>}
        {messageError && <p className="error">{messageError}</p>}
        {points?.length === 0 && (
          <p className="empty">This track has no GPS points to show on the map.</p>
        )}

        <div className="track-map" ref={mapContainerRef} />

        {isTimed &&
          trackStartMs !== null &&
          trackEndMs !== null &&
          scrubMs !== null &&
          visibleWindow !== null && (
            <div className="timeline">
              <div className="timeline-controls">
                <button
                  type="button"
                  className="timeline-control-button"
                  onClick={() => handlePan('earlier')}
                  disabled={visibleWindow.startMs <= trackStartMs}
                  aria-label="Pan earlier"
                  title="Pan earlier"
                >
                  &#9664;
                </button>
                <button
                  type="button"
                  className="timeline-control-button"
                  onClick={handleZoomOut}
                  disabled={isFullyZoomedOut}
                  aria-label="Zoom out"
                >
                  Zoom out
                </button>
                <button type="button" className="timeline-control-button" onClick={handleZoomIn}>
                  Zoom in
                </button>
                <button
                  type="button"
                  className="timeline-control-button"
                  onClick={() => handlePan('later')}
                  disabled={visibleWindow.endMs >= trackEndMs}
                  aria-label="Pan later"
                  title="Pan later"
                >
                  &#9654;
                </button>
                <span className="timeline-window-range">
                  {new Date(visibleWindow.startMs).toLocaleTimeString()} &ndash;{' '}
                  {new Date(visibleWindow.endMs).toLocaleTimeString()}
                </span>
              </div>
              <div className="timeline-track">
                <input
                  className="timeline-slider"
                  type="range"
                  min={visibleWindow.startMs}
                  max={visibleWindow.endMs}
                  step={1000}
                  value={scrubMs}
                  onChange={handleScrub}
                />
                <div className="timeline-markers">
                  {notes
                    .filter(
                      (note): note is JournalNote & { timestamp: string } => note.timestamp !== null
                    )
                    .map((note) => {
                      const noteMs = Date.parse(note.timestamp)
                      const pct = percentInWindow(noteMs, visibleWindow)
                      if (pct === null) return null
                      return (
                        <button
                          key={`note-${note.id}`}
                          type="button"
                          className="timeline-marker timeline-marker-note"
                          style={{ left: `${pct}%` }}
                          aria-label={`Note at ${new Date(noteMs).toLocaleTimeString()}: ${note.content}`}
                          title={note.content}
                          onClick={() => setSelectedItem({ kind: 'note', id: note.id })}
                        />
                      )
                    })}
                  {timelinePhotos.map((photo) => {
                    const photoMs = Date.parse(photo.timestamp as string)
                    const pct = percentInWindow(photoMs, visibleWindow)
                    if (pct === null) return null
                    return (
                      <button
                        key={`photo-${photo.id}`}
                        type="button"
                        className="timeline-marker timeline-marker-photo"
                        style={{ left: `${pct}%` }}
                        aria-label={`Photo at ${new Date(photoMs).toLocaleTimeString()}`}
                        title="Photo"
                        onClick={() => setSelectedItem({ kind: 'photo', id: photo.id })}
                      />
                    )
                  })}
                  {/* Distinguished from a note dot by shape/color (diamond, teal) since both can
                    appear on the same timeline. A message always has a timestamp (see Message's
                    doc comment), so unlike notes there's no null-timestamp case to filter out. */}
                  {messages.map((message) => {
                    const messageMs = Date.parse(message.timestamp)
                    const pct = percentInWindow(messageMs, visibleWindow)
                    if (pct === null) return null
                    return (
                      <button
                        key={`message-${message.id}`}
                        type="button"
                        className="timeline-marker timeline-marker-message"
                        style={{ left: `${pct}%` }}
                        aria-label={`Message at ${new Date(messageMs).toLocaleTimeString()}: ${message.content}`}
                        title={message.content}
                        onClick={() => setSelectedItem({ kind: 'message', id: message.id })}
                      />
                    )
                  })}
                </div>
              </div>
              <div className="timeline-status">
                <span>{new Date(scrubMs).toLocaleTimeString()}</span>
                {scrubStatus === 'gap' && (
                  <span className="timeline-gap-notice">No track data here (recording gap)</span>
                )}
                {hiddenItemsCount > 0 && (
                  <span className="timeline-hidden-notice">
                    {hiddenItemsCount} item{hiddenItemsCount === 1 ? '' : 's'} outside this view
                  </span>
                )}
              </div>
            </div>
          )}

        {points !== null && points.length > 0 && (
          <form className="note-form" onSubmit={handleAddNote}>
            {isTimed && (
              <input
                type="datetime-local"
                className="note-form-timestamp"
                value={noteTimestampInput}
                onChange={(e) => {
                  noteTimestampTouchedRef.current = true
                  setNoteTimestampInput(e.target.value)
                }}
                required
              />
            )}
            <input
              type="text"
              className="note-form-content"
              placeholder={isTimed ? 'Add a note at this moment…' : 'Add a note about this day…'}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              required
            />
            <button type="submit" disabled={savingNote}>
              {savingNote ? 'Adding…' : 'Add note'}
            </button>
          </form>
        )}
        {noteError && <p className="error">{noteError}</p>}

        {/* A timeless track has no timeline to place a marker on, so its notes are listed
            plainly instead — still clickable, still opening the same side panel. */}
        {!isTimed && notes.length > 0 && (
          <ul className="note-list">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className="note-list-item"
                  onClick={() => setSelectedItem({ kind: 'note', id: note.id })}
                >
                  {note.content}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Same fallback shape as the note list above: a timeless track has no timeline for any
            photo to sit on, and even a timed track can have a photo with no EXIF timestamp to
            place on it — both land here instead of being silently dropped. */}
        {fallbackListPhotos.length > 0 && (
          <>
            <h3 className="photo-list-heading">Photos</h3>
            <ul className="photo-list">
              {fallbackListPhotos.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    className="photo-list-item"
                    onClick={() => setSelectedItem({ kind: 'photo', id: photo.id })}
                  >
                    {formatPhotoTitle(photo)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Same timeless-track fallback as notes above: no time axis to place a dot on, so
            messages are listed plainly instead (still clickable, still on the map). */}
        {!isTimed && messages.length > 0 && (
          <ul className="message-list">
            {messages.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  className="message-list-item"
                  onClick={() => setSelectedItem({ kind: 'message', id: message.id })}
                >
                  {message.content || '(no message text)'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedNote && (
        <SidePanel title={formatNoteTitle(selectedNote)} onClose={() => setSelectedItem(null)}>
          <p>{selectedNote.content}</p>
        </SidePanel>
      )}

      {selectedPhoto && (
        <SidePanel title={formatPhotoTitle(selectedPhoto)} onClose={() => setSelectedItem(null)}>
          {photoDataLoading && <p className="empty">Loading photo…</p>}
          {photoDataError && <p className="error">{photoDataError}</p>}
          {!photoDataLoading && photoDataUri && (
            <img className="side-panel-photo" src={photoDataUri} alt="" />
          )}
        </SidePanel>
      )}

      {selectedMessage && (
        <SidePanel
          title={formatMessageTitle(selectedMessage)}
          onClose={() => setSelectedItem(null)}
        >
          <p>{selectedMessage.content || '(no message text)'}</p>
          <p className="message-location">
            {selectedMessage.lat.toFixed(5)}, {selectedMessage.lng.toFixed(5)}
          </p>
        </SidePanel>
      )}
    </div>
  )
}

export default TrackDetail
