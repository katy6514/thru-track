import { useEffect, useState, type FormEvent } from 'react'
import type { Trip, Track } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import TrackDetail from './TrackDetail'
import JournalEditor from './JournalEditor'

interface TrackListProps {
  trip: Trip
  onBack: () => void
}

function TrackList({ trip, onBack }: TrackListProps): React.JSX.Element {
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [showJournal, setShowJournal] = useState(false)
  // Set when a GPX has no timestamps and no date could be inferred from its filename —
  // the hiker needs to supply the day this track was hiked before it's actually imported.
  const [pendingGpxRaw, setPendingGpxRaw] = useState<string | null>(null)
  const [dateInput, setDateInput] = useState('')

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
      const result = await window.api.tracks.importGpx(trip.id)
      if (result && 'needsDate' in result) {
        setPendingGpxRaw(result.gpxRaw)
        setDateInput('')
      } else if (result) {
        await refresh()
      }
    } catch (err) {
      setError(cleanErrorMessage(err))
    } finally {
      setImporting(false)
    }
  }

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

  if (selectedTrack && showJournal) {
    return <JournalEditor track={selectedTrack} onBack={() => setShowJournal(false)} />
  }

  if (selectedTrack) {
    return (
      <TrackDetail
        track={selectedTrack}
        onBack={() => setSelectedTrack(null)}
        onWriteJournal={() => setShowJournal(true)}
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
        <button type="button" onClick={handleImport} disabled={importing || !!pendingGpxRaw}>
          {importing ? 'Importing…' : 'Import GPX track'}
        </button>
      </div>

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
        <ul className="tracks">
          {tracks.map((track) => (
            <li key={track.id} className="track-row">
              <button
                type="button"
                className="track-name"
                onClick={() => setSelectedTrack(track)}
              >
                {track.name}
              </button>
              <span className="track-date">{track.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TrackList
