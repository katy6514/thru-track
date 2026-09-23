import { useEffect, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Trip, Track, TrackPoint, GpxImportNeedsDate } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../../../shared/splitTrackSegments'
import { addBaseLayers, attachClickToZoom, trackColor } from '../mapBaseLayers'
import TrackDetail from './TrackDetail'

interface TrackListProps {
  trip: Trip
  onBack: () => void
}

function TrackList({ trip, onBack }: TrackListProps): React.JSX.Element {
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const overviewMapContainerRef = useRef<HTMLDivElement>(null)
  const overviewMapRef = useRef<L.Map | null>(null)
  // Each track's own points, fetched once per `tracks` change so every day's line can be drawn
  // on the overview map below — keyed by track id since not every track is guaranteed to have
  // points (or to still be loading them) at any given moment.
  const [overviewPoints, setOverviewPoints] = useState<Map<number, TrackPoint[]>>(new Map())
  // Set when a GPX has no timestamps and no date could be inferred from its filename —
  // the hiker needs to supply the day this track was hiked before it's actually imported.
  const [pendingGpxRaw, setPendingGpxRaw] = useState<string | null>(null)
  const [dateInput, setDateInput] = useState('')

  // Set while a phone GPX-upload session (issue #34) is running: the URL/QR the hiker's phone
  // connects to. Null means no session is active — the server itself only runs on the main
  // process while this is non-null. A separate session/QR from the photo uploader on TrackDetail
  // by design — see gpxUpload:start's doc comment in ipc.ts.
  const [gpxUploadSession, setGpxUploadSession] = useState<{
    url: string
    qrDataUri: string
  } | null>(null)
  const [startingGpxUpload, setStartingGpxUpload] = useState(false)
  const [gpxUploadError, setGpxUploadError] = useState('')

  // The two ways to add a track (file picker, phone QR) collapse into one "Add track" button
  // that pops this menu open rather than showing both as separate top-level buttons.
  const [showAddMenu, setShowAddMenu] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAddMenu) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddMenu])

  const refresh = async (): Promise<void> => {
    setTracks(await window.api.tracks.list(trip.id))
  }

  useEffect(() => {
    refresh()
  }, [trip.id])

  // Fetches every listed track's own points whenever the track list changes (a fresh import, a
  // deletion, switching trips) so the overview map below always has what it needs to draw each
  // day's line — a separate effect from the map-rendering one below since fetching is async and
  // rendering shouldn't block on it re-running for reasons unrelated to the data itself.
  useEffect(() => {
    let cancelled = false
    Promise.all(
      tracks.map((track): Promise<[number, TrackPoint[]]> =>
        window.api.tracks.getPoints(track.id).then((points) => [track.id, points])
      )
    ).then((entries) => {
      if (!cancelled) setOverviewPoints(new Map(entries))
    })
    return () => {
      cancelled = true
    }
  }, [tracks])

  // Renders (or re-renders) the overview map whenever there's fresh point data to show. Also
  // depends on `selectedTrack` even though it isn't read here: this component's own JSX (and the
  // map container div with it) only exists while `selectedTrack` is null — see the early return
  // below — so navigating back from a track's detail page remounts a brand new container that
  // needs its own map built against it.
  useEffect(() => {
    const container = overviewMapContainerRef.current
    if (!container) return

    if (overviewMapRef.current) {
      overviewMapRef.current.remove()
      overviewMapRef.current = null
    }

    const map = L.map(container, { scrollWheelZoom: false })
    attachClickToZoom(map, container)
    addBaseLayers(map)

    const allLatLngs: L.LatLngExpression[] = []
    tracks.forEach((track, index) => {
      const points = overviewPoints.get(track.id)
      if (!points || points.length === 0) return
      const color = trackColor(index)
      for (const segment of splitTrackIntoSegments(points)) {
        const latLngs: L.LatLngExpression[] = segment.map((p) => [p.lat, p.lng])
        L.polyline(latLngs, { color, weight: 4 })
          .bindTooltip(track.name)
          .on('click', () => setSelectedTrack(track))
          .addTo(map)
        allLatLngs.push(...latLngs)
      }
    })

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] })
    } else {
      map.setView([0, 0], 2)
    }

    overviewMapRef.current = map

    return () => {
      map.remove()
      overviewMapRef.current = null
    }
  }, [tracks, overviewPoints, selectedTrack])

  useEffect(() => {
    // A GPX-upload session is scoped to the trip it was started from — switching trips (or
    // unmounting, e.g. navigating back to the trip list) must not leave a server running, so
    // stop it here rather than requiring an explicit "Done" click every time.
    return () => {
      window.api.gpxUpload.stop()
    }
  }, [trip.id])

  // Shared by the file-picker import below and the phone-upload event listener further down —
  // both paths resolve to the same Track | GpxImportNeedsDate shape, so a track needing a date
  // surfaces through the same prompt regardless of where it came from.
  const applyGpxImportResult = (result: Track | GpxImportNeedsDate): void => {
    if ('needsDate' in result) {
      setPendingGpxRaw(result.gpxRaw)
      setDateInput('')
    } else {
      refresh()
    }
  }

  const handleImport = async (): Promise<void> => {
    setError('')
    setImporting(true)
    try {
      const result = await window.api.tracks.importGpx(trip.id)
      if (result) applyGpxImportResult(result)
    } catch (err) {
      setError(cleanErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }

  const handleStartGpxUpload = async (): Promise<void> => {
    setStartingGpxUpload(true)
    setGpxUploadError('')
    try {
      const session = await window.api.gpxUpload.start(trip.id)
      setGpxUploadSession(session)
    } catch (err) {
      setGpxUploadError(cleanErrorMessage(err))
    } finally {
      setStartingGpxUpload(false)
    }
  }

  const handleStopGpxUpload = async (): Promise<void> => {
    await window.api.gpxUpload.stop()
    setGpxUploadSession(null)
  }

  useEffect(() => {
    const unsubReceived = window.api.gpxUpload.onReceived(applyGpxImportResult)
    const unsubError = window.api.gpxUpload.onError(setGpxUploadError)
    return () => {
      unsubReceived()
      unsubError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

  const handleConfirmDate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!pendingGpxRaw || !dateInput) return
    setError('')
    setImporting(true)
    try {
      await window.api.tracks.importGpxWithDate(trip.id, pendingGpxRaw, dateInput)
      setPendingGpxRaw(null)
      await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (track: Track): Promise<void> => {
    if (
      !window.confirm(
        `Delete "${track.name}" and everything in it (photos, notes, messages, journal entry)? ` +
          `This cannot be undone.`
      )
    )
      return
    setError('')
    try {
      await window.api.tracks.delete(track.id)
      await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    }
  }

  if (selectedTrack) {
    return <TrackDetail track={selectedTrack} onBack={() => setSelectedTrack(null)} />
  }

  return (
    <div className="track-list">
      <button type="button" className="back-link" onClick={onBack}>
        &larr; Back to trips
      </button>

      <h1>{trip.name}</h1>

      <div className="track-list-actions">
        <div className="dropdown-menu" ref={addMenuRef}>
          <button
            type="button"
            onClick={() => setShowAddMenu((v) => !v)}
            disabled={importing || startingGpxUpload}
          >
            {importing ? 'Importing…' : startingGpxUpload ? 'Starting…' : 'Add track ▾'}
          </button>
          {showAddMenu && (
            <div className="dropdown-menu-options">
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false)
                  handleImport()
                }}
                disabled={!!pendingGpxRaw}
              >
                Import GPX file…
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddMenu(false)
                  handleStartGpxUpload()
                }}
                disabled={!!gpxUploadSession}
              >
                Upload GPX from phone…
              </button>
            </div>
          )}
        </div>
      </div>

      {gpxUploadSession && (
        <div className="phone-upload-panel">
          <img
            className="phone-upload-qr"
            src={gpxUploadSession.qrDataUri}
            alt="QR code linking to the phone GPX upload page"
          />
          <div className="phone-upload-info">
            <p>
              On your phone, scan this code or open{' '}
              <span className="mono-inline">{gpxUploadSession.url}</span> while it&apos;s on the
              same wifi network (or tethered to this computer&apos;s hotspot).
            </p>
            <p className="phone-upload-hint">
              The track you send there appears here automatically.
            </p>
            <button type="button" onClick={handleStopGpxUpload}>
              Stop phone upload
            </button>
          </div>
        </div>
      )}
      {gpxUploadError && <p className="error">{gpxUploadError}</p>}

      {pendingGpxRaw && (
        <form className="date-prompt" onSubmit={handleConfirmDate}>
          <label htmlFor="track-date-input">
            This GPX file has no timestamps — what day was it hiked?
          </label>
          <div className="date-prompt-controls">
            <input
              id="track-date-input"
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" disabled={importing}>
              Import
            </button>
            <button type="button" onClick={() => setPendingGpxRaw(null)} disabled={importing}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {tracks.length === 0 ? (
        <p className="empty">No tracks yet. Import a GPX file to add this trip&apos;s first day.</p>
      ) : (
        <div className="track-list-layout">
          <div className="track-list-map-col">
            <div className="track-map" ref={overviewMapContainerRef} />
          </div>

          <div className="track-list-side-col">
            <ul className="tracks">
              {tracks.map((track, index) => (
                <li key={track.id} className="track-row">
                  <span
                    className="track-color-swatch"
                    style={{ backgroundColor: trackColor(index) }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="track-name"
                    onClick={() => setSelectedTrack(track)}
                  >
                    {track.name}
                  </button>
                  <span className="track-date">{track.date}</span>
                  <div className="track-actions">
                    <button type="button" onClick={() => handleDelete(track)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default TrackList
