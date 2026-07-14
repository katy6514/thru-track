import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { Track, TrackPoint, JournalNote } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../splitTrackSegments'
import { interpolatePosition } from '../positionInterpolator'
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

interface TrackDetailProps {
  track: Track
  onBack: () => void
  onWriteJournal: () => void
}

function renderTrackMap(
  container: HTMLDivElement,
  points: TrackPoint[]
): { map: L.Map; marker: L.Marker | null } {
  const map = L.map(container)

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
    return { map, marker: null }
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

  return { map, marker }
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

function TrackDetail({ track, onBack, onWriteJournal }: TrackDetailProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [error, setError] = useState('')
  const [points, setPoints] = useState<TrackPoint[] | null>(null)
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const [scrubStatus, setScrubStatus] = useState<'ok' | 'gap' | 'out-of-range'>('ok')

  const [notes, setNotes] = useState<JournalNote[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [noteTimestampInput, setNoteTimestampInput] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState('')
  // Once the hiker edits the timestamp field directly, stop overwriting it as the timeline is
  // scrubbed — "defaults to the current scrub position" should only apply until they've made
  // their own choice.
  const noteTimestampTouchedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setError('')
    setPoints(null)
    setScrubMs(null)
    setScrubStatus('ok')
    setNotes([])
    setSelectedNoteId(null)
    setNoteContent('')
    setNoteTimestampInput('')
    setNoteError('')
    noteTimestampTouchedRef.current = false

    Promise.all([window.api.tracks.getPoints(track.id), window.api.notes.list(track.id)])
      .then(([fetchedPoints, fetchedNotes]) => {
        if (cancelled || !mapContainerRef.current) return
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        const { map, marker } = renderTrackMap(mapContainerRef.current, fetchedPoints)
        mapRef.current = map
        markerRef.current = marker
        setPoints(fetchedPoints)
        setNotes(fetchedNotes)
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
    }
  }, [track.id])

  const isTimed = points !== null && points.length > 0 && points[0].timestamp !== null
  const trackStartMs = isTimed && points ? Date.parse(points[0].timestamp as string) : null
  const trackEndMs =
    isTimed && points ? Date.parse(points[points.length - 1].timestamp as string) : null

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

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null

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
        </div>

        {error && <p className="error">{error}</p>}
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
                  .filter((note): note is JournalNote & { timestamp: string } => note.timestamp !== null)
                  .map((note) => {
                    const noteMs = Date.parse(note.timestamp)
                    const pct = ((noteMs - trackStartMs) / (trackEndMs - trackStartMs)) * 100
                    const clampedPct = Math.min(100, Math.max(0, pct))
                    return (
                      <button
                        key={note.id}
                        type="button"
                        className="timeline-marker"
                        style={{ left: `${clampedPct}%` }}
                        aria-label={`Note at ${new Date(noteMs).toLocaleTimeString()}: ${note.content}`}
                        title={note.content}
                        onClick={() => setSelectedNoteId(note.id)}
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
                  onClick={() => setSelectedNoteId(note.id)}
                >
                  {note.content}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedNote && (
        <SidePanel title={formatNoteTitle(selectedNote)} onClose={() => setSelectedNoteId(null)}>
          <p>{selectedNote.content}</p>
        </SidePanel>
      )}
    </div>
  )
}

export default TrackDetail
