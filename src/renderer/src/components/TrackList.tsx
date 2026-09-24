import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type {
  Trip,
  Track,
  TrackPoint,
  GpxImportNeedsDate,
  GpxImportNeedsStartDate
} from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../../../shared/splitTrackSegments'
import { groupTracksByState } from '../../../shared/groupTracksByState'
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
  // Index into stateGroups (below) of whichever group is currently expanded — at most one at a
  // time, and collapsed (null) by default. An index rather than the group's own label, since nothing
  // guarantees two groups never share a label (e.g. two separate, non-adjacent stretches through
  // the same state). Reset to null whenever the trip changes (below) so switching trips never
  // leaves a group looking open that the hiker never actually opened for this trip.
  const [openState, setOpenState] = useState<number | null>(null)
  // Set when a GPX has no timestamps and no date could be inferred from its filename —
  // the hiker needs to supply the day this track was hiked before it's actually imported.
  const [pendingGpxRaw, setPendingGpxRaw] = useState<string | null>(null)
  const [dateInput, setDateInput] = useState('')
  // Set when the GPX file holds several <trk> segments (e.g. a whole trail's worth of legs from
  // one CalTopo export) and more than one of them has no timestamp of its own — the hiker
  // supplies a single start date and each untimed segment is dated sequentially from there
  // instead of prompting once per segment.
  const [pendingMultiGpx, setPendingMultiGpx] = useState<{
    gpxRaw: string
    segmentCount: number
  } | null>(null)
  const [startDateInput, setStartDateInput] = useState('')

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
    setOpenState(null)
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

  // `overviewPoints` is only ever replaced wholesale once every current track's points have
  // resolved (see the fetch effect above) — but there's a beat between `tracks` updating and that
  // fetch landing where it still holds a stale (or empty) snapshot. Without this check, the list
  // would render once against that stale snapshot first — every track un-groupable, so it
  // momentarily falls back to one flat list — and then again, correctly grouped, a moment later.
  // Gating the whole section on this instead trades that flash for a brief loading line.
  const overviewPointsReady = tracks.every((t) => overviewPoints.has(t.id))

  const stateGroups = useMemo(
    () => groupTracksByState(tracks, overviewPoints),
    [tracks, overviewPoints]
  )
  // Position in the full, date-sorted `tracks` array — independent of which state group a track
  // ends up listed under — so a track's color-swatch dot always matches its own line on the
  // overview map below, exactly as it did before grouping existed.
  const trackIndexById = useMemo(() => new Map(tracks.map((t, i) => [t.id, i])), [tracks])

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
      }
    })

    // Camera framing (the whole trip vs. just the expanded state) is owned entirely by the
    // dedicated effect below, which always runs right after this one on the same commit — so the
    // freshly built map here is framed correctly before the browser ever paints it, without this
    // effect needing to know anything about the accordion's open state itself.
    overviewMapRef.current = map

    return () => {
      map.remove()
      overviewMapRef.current = null
    }
  }, [tracks, overviewPoints, selectedTrack])

  // Frames the overview map on whichever state group is currently expanded, or the whole trip
  // when none is — re-fitting bounds only (the drawn lines above are untouched either way, so
  // every day's route stays visible regardless of which group is open; only the camera moves).
  useEffect(() => {
    const map = overviewMapRef.current
    if (!map) return

    const group = openState !== null ? stateGroups[openState] : undefined
    const tracksInView = group ? group.tracks : tracks

    const latLngs: L.LatLngExpression[] = []
    for (const track of tracksInView) {
      const points = overviewPoints.get(track.id)
      if (!points) continue
      for (const p of points) latLngs.push([p.lat, p.lng])
    }

    if (latLngs.length > 0) {
      map.fitBounds(L.latLngBounds(latLngs), { padding: [24, 24] })
    } else {
      map.setView([0, 0], 2)
    }
  }, [openState, stateGroups, overviewPoints, tracks])

  useEffect(() => {
    // A GPX-upload session is scoped to the trip it was started from — switching trips (or
    // unmounting, e.g. navigating back to the trip list) must not leave a server running, so
    // stop it here rather than requiring an explicit "Done" click every time.
    return () => {
      window.api.gpxUpload.stop()
    }
  }, [trip.id])

  // Shared by the file-picker import below and the phone-upload event listener further down —
  // both paths resolve to the same result shape, so a track needing a date (or a multi-segment
  // file needing a start date) surfaces through the same prompt regardless of where it came from.
  const applyGpxImportResult = (
    result: Track[] | GpxImportNeedsDate | GpxImportNeedsStartDate
  ): void => {
    if ('needsDate' in result) {
      setPendingGpxRaw(result.gpxRaw)
      setDateInput('')
    } else if ('needsStartDate' in result) {
      setPendingMultiGpx({ gpxRaw: result.gpxRaw, segmentCount: result.segmentCount })
      setStartDateInput('')
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

  const handleConfirmStartDate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!pendingMultiGpx || !startDateInput) return
    setError('')
    setImporting(true)
    try {
      await window.api.tracks.importGpxWithStartDate(
        trip.id,
        pendingMultiGpx.gpxRaw,
        startDateInput
      )
      setPendingMultiGpx(null)
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

  // Shared by both the state accordion and the plain single-state fallback list below, so a
  // track row looks and behaves identically either way.
  const renderTrackRow = (track: Track): React.JSX.Element => (
    <li key={track.id} className="track-row">
      <span
        className="track-color-swatch"
        style={{ backgroundColor: trackColor(trackIndexById.get(track.id) ?? 0) }}
        aria-hidden="true"
      />
      <button type="button" className="track-name" onClick={() => setSelectedTrack(track)}>
        {track.name}
      </button>
      <span className="track-date">{track.date}</span>
      <div className="track-actions">
        <button type="button" onClick={() => handleDelete(track)}>
          Delete
        </button>
      </div>
    </li>
  )

  if (selectedTrack) {
    return (
      <TrackDetail
        track={selectedTrack}
        onBack={() => setSelectedTrack(null)}
        onTrackUpdated={(updated) => {
          setSelectedTrack(updated)
          refresh()
        }}
        onOpenTrack={(trackId) => {
          const target = tracks.find((t) => t.id === trackId)
          if (target) setSelectedTrack(target)
        }}
      />
    )
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
                disabled={!!pendingGpxRaw || !!pendingMultiGpx}
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

      {pendingMultiGpx && (
        <form className="date-prompt" onSubmit={handleConfirmStartDate}>
          <label htmlFor="track-start-date-input">
            This GPX file contains {pendingMultiGpx.segmentCount} separate track segments with no
            timestamps of their own — it&apos;ll become {pendingMultiGpx.segmentCount} tracks. What
            date did the first one start? Each later segment is dated one day after the one before
            it.
          </label>
          <div className="date-prompt-controls">
            <input
              id="track-start-date-input"
              type="date"
              value={startDateInput}
              onChange={(e) => setStartDateInput(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" disabled={importing}>
              Import
            </button>
            <button type="button" onClick={() => setPendingMultiGpx(null)} disabled={importing}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {tracks.length === 0 ? (
        <p className="empty">No tracks yet. Import a GPX file to add this trip&apos;s first day.</p>
      ) : !overviewPointsReady ? (
        <p className="empty">Loading tracks…</p>
      ) : (
        <div className="track-list-layout">
          <div className="track-list-map-col">
            <div className="track-map" ref={overviewMapContainerRef} />
          </div>

          <div className="track-list-side-col">
            {stateGroups.length > 1 ? (
              <div className="track-state-accordion">
                {stateGroups.map((group, groupIndex) => {
                  const isOpen = openState === groupIndex
                  return (
                    <div key={groupIndex} className="track-state-group">
                      <button
                        type="button"
                        className="track-state-header"
                        onClick={() => setOpenState(isOpen ? null : groupIndex)}
                        aria-expanded={isOpen}
                      >
                        <span className="track-state-chevron">{isOpen ? '▾' : '▸'}</span>
                        <span className="track-state-name">{group.label}</span>
                        <span className="track-state-count">{group.tracks.length}</span>
                      </button>
                      {isOpen && <ul className="tracks">{group.tracks.map(renderTrackRow)}</ul>}
                    </div>
                  )
                })}
              </div>
            ) : (
              // Almost every trip stays within one state — the accordion only earns its keep
              // once there's more than one group to pick between, so a single-state trip (or one
              // where every track landed in "Other") just lists its tracks plainly, exactly as it
              // did before state grouping existed.
              <ul className="tracks">{tracks.map(renderTrackRow)}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TrackList
