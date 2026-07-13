import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Track, TrackPoint } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { splitTrackIntoSegments } from '../splitTrackSegments'

interface TrackDetailProps {
  track: Track
  onBack: () => void
  onWriteJournal: () => void
}

function renderTrackMap(container: HTMLDivElement, points: TrackPoint[]): L.Map {
  const map = L.map(container)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map)

  if (points.length === 0) {
    map.setView([0, 0], 2)
    return map
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

  return map
}

function TrackDetail({ track, onBack, onWriteJournal }: TrackDetailProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [error, setError] = useState('')
  const [pointCount, setPointCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setError('')
    setPointCount(null)

    window.api.tracks
      .getPoints(track.id)
      .then((points) => {
        if (cancelled || !mapContainerRef.current) return
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        mapRef.current = renderTrackMap(mapContainerRef.current, points)
        setPointCount(points.length)
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
    }
  }, [track.id])

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
      {pointCount === 0 && <p className="empty">This track has no GPS points to show on the map.</p>}

      <div className="track-map" ref={mapContainerRef} />
    </div>
  )
}

export default TrackDetail
