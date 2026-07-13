import { useEffect, useState } from 'react'
import type { Trip, Track } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'

interface TrackListProps {
  trip: Trip
  onBack: () => void
}

function TrackList({ trip, onBack }: TrackListProps): React.JSX.Element {
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const refresh = async (): Promise<void> => {
    setTracks(await window.api.tracks.list(trip.id))
  }

  useEffect(() => {
    refresh()
  }, [trip.id])

  const handleImport = async (): Promise<void> => {
    setError('')
    setImporting(true)
    try {
      const track = await window.api.tracks.importGpx(trip.id)
      if (track) await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="track-list">
      <button type="button" className="back-link" onClick={onBack}>
        &larr; Back to trips
      </button>

      <h1>{trip.name}</h1>

      <div className="track-list-actions">
        <button type="button" onClick={handleImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import GPX track'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {tracks.length === 0 ? (
        <p className="empty">No tracks yet. Import a GPX file to add this trip&apos;s first day.</p>
      ) : (
        <ul className="tracks">
          {tracks.map((track) => (
            <li key={track.id} className="track-row">
              <span className="track-name">{track.name}</span>
              <span className="track-date">{track.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TrackList
