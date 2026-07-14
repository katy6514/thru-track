import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { Track, TrackPoint, JournalNote, Photo, Message } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../../../shared/splitTrackSegments'
import { interpolatePosition } from '../../../shared/positionInterpolator'
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
    setNotes([])
    setPhotos([])
    setMessages([])
    setSelectedItem(null)
    setNoteContent('')
    setNoteTimestampInput('')
    setNoteError('')
    setPhotoError('')
    setMessageError('')
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
          setScrubMs(Date.parse(fetchedPoints[0].timestamp as string))
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

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (!points) return
    const ms = Number(e.target.value)
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

  const handleImportPhotos = async (): Promise<void> => {
    setImportingPhotos(true)
    setPhotoError('')
    try {
      const imported = await window.api.photos.import(track.id)
      if (imported.length > 0) {
        const updated = await window.api.photos.list(track.id)
        setPhotos(updated)
      }
    } catch (err) {
      setPhotoError(cleanErrorMessage(err))
    } finally {
      setImportingPhotos(false)
    }
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
          <button type="button" onClick={handleImportPhotos} disabled={importingPhotos}>
            {importingPhotos ? 'Importing photos…' : 'Import photos'}
          </button>
          <button type="button" onClick={handleImportMessages} disabled={importingMessages}>
            {importingMessages ? 'Importing…' : 'Import messages (CSV)'}
          </button>
        </div>

        {error && <p className="error">{error}</p>}
        {photoError && <p className="error">{photoError}</p>}
        {messageError && <p className="error">{messageError}</p>}
        {points?.length === 0 && (
          <p className="empty">This track has no GPS points to show on the map.</p>
        )}

        <div className="track-map" ref={mapContainerRef} />

        {isTimed && trackStartMs !== null && trackEndMs !== null && scrubMs !== null && (
          <div className="timeline">
            <div className="timeline-track">
              <input
                className="timeline-slider"
                type="range"
                min={trackStartMs}
                max={trackEndMs}
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
                    const pct = ((noteMs - trackStartMs) / (trackEndMs - trackStartMs)) * 100
                    const clampedPct = Math.min(100, Math.max(0, pct))
                    return (
                      <button
                        key={`note-${note.id}`}
                        type="button"
                        className="timeline-marker timeline-marker-note"
                        style={{ left: `${clampedPct}%` }}
                        aria-label={`Note at ${new Date(noteMs).toLocaleTimeString()}: ${note.content}`}
                        title={note.content}
                        onClick={() => setSelectedItem({ kind: 'note', id: note.id })}
                      />
                    )
                  })}
                {timelinePhotos.map((photo) => {
                  const photoMs = Date.parse(photo.timestamp as string)
                  const pct = ((photoMs - trackStartMs) / (trackEndMs - trackStartMs)) * 100
                  const clampedPct = Math.min(100, Math.max(0, pct))
                  return (
                    <button
                      key={`photo-${photo.id}`}
                      type="button"
                      className="timeline-marker timeline-marker-photo"
                      style={{ left: `${clampedPct}%` }}
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
                  const pct = ((messageMs - trackStartMs) / (trackEndMs - trackStartMs)) * 100
                  const clampedPct = Math.min(100, Math.max(0, pct))
                  return (
                    <button
                      key={`message-${message.id}`}
                      type="button"
                      className="timeline-marker timeline-marker-message"
                      style={{ left: `${clampedPct}%` }}
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
        <SidePanel title={formatMessageTitle(selectedMessage)} onClose={() => setSelectedItem(null)}>
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
