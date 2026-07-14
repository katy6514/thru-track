import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { Track, TrackPoint } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../splitTrackSegments'
import { interpolatePosition } from '../positionInterpolator'

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
  const marker = isTimed
    ? L.marker([points[0].lat, points[0].lng]).addTo(map)
    : null

  return { map, marker }
}

function TrackDetail({ track, onBack, onWriteJournal }: TrackDetailProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [error, setError] = useState('')
  const [points, setPoints] = useState<TrackPoint[] | null>(null)
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const [scrubStatus, setScrubStatus] = useState<'ok' | 'gap' | 'out-of-range'>('ok')

  useEffect(() => {
    let cancelled = false
    setError('')
    setPoints(null)
    setScrubMs(null)
    setScrubStatus('ok')

    window.api.tracks
      .getPoints(track.id)
      .then((fetchedPoints) => {
        if (cancelled || !mapContainerRef.current) return
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        const { map, marker } = renderTrackMap(mapContainerRef.current, fetchedPoints)
        mapRef.current = map
        markerRef.current = marker
        setPoints(fetchedPoints)
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
  const trackStartMs =
    isTimed && points ? Date.parse(points[0].timestamp as string) : null
  const trackEndMs =
    isTimed && points ? Date.parse(points[points.length - 1].timestamp as string) : null

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

  return (
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
          <input
            className="timeline-slider"
            type="range"
            min={trackStartMs}
            max={trackEndMs}
            step={1000}
            value={scrubMs}
            onChange={handleScrub}
          />
          <div className="timeline-status">
            <span>{new Date(scrubMs).toLocaleTimeString()}</span>
            {scrubStatus === 'gap' && (
              <span className="timeline-gap-notice">No track data here (recording gap)</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default TrackDetail
