import { useEffect, useState, type FormEvent } from 'react'
import type { Trip } from '../../../shared/types'
import { stateForPoint } from '../../../shared/stateForPoint'
import { cleanErrorMessage } from '../cleanErrorMessage'

interface TripSummary {
  dateRangeLabel: string | null
  states: string[]
  photoDataUri: string | null
}

function formatTripDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

// Built from existing per-track endpoints rather than a dedicated backend aggregate — this is a
// local SQLite-backed app and a trip's track count is small enough that a handful of extra IPC
// round trips per trip, done in parallel, is cheap.
async function buildTripSummary(tripId: number): Promise<TripSummary> {
  const tracks = await window.api.tracks.list(tripId)
  if (tracks.length === 0) return { dateRangeLabel: null, states: [], photoDataUri: null }

  const sorted = [...tracks].sort((a, b) => a.date.localeCompare(b.date))
  const firstDate = sorted[0].date
  const lastDate = sorted[sorted.length - 1].date
  const dateRangeLabel =
    firstDate === lastDate
      ? formatTripDate(firstDate)
      : `${formatTripDate(firstDate)} – ${formatTripDate(lastDate)}`

  // Sampling just the first/middle/last track (rather than every track, like the full itinerary
  // breakdown on the track list page does) keeps this cheap on a page that loads every trip's
  // summary at once.
  const sampleTracks = [
    ...new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]])
  ]
  const samplePoints = await Promise.all(sampleTracks.map((t) => window.api.tracks.getPoints(t.id)))
  const states: string[] = []
  for (const points of samplePoints) {
    if (points.length === 0) continue
    const state = stateForPoint(points[0].lat, points[0].lng)
    if (state && !states.includes(state)) states.push(state)
  }

  const photoLists = await Promise.all(sorted.map((t) => window.api.photos.list(t.id)))
  const firstWithPhotos = photoLists.find((photos) => photos.length > 0)
  const photoDataUri = firstWithPhotos
    ? await window.api.photos.getDataUri(firstWithPhotos[0].id)
    : null

  return { dateRangeLabel, states, photoDataUri }
}

interface TripListProps {
  onSelectTrip: (trip: Trip) => void
  onShowHowTo: () => void
}

function TripList({ onSelectTrip, onShowHowTo }: TripListProps): React.JSX.Element {
  const [trips, setTrips] = useState<Trip[]>([])
  const [summaries, setSummaries] = useState<Map<number, TripSummary>>(new Map())
  const [newTripName, setNewTripName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')
  // Rename/Delete stay hidden until the hiker explicitly asks to edit the list — keeps a plain
  // trip row down to just its name and date the rest of the time, rather than two buttons on
  // every row all the time.
  const [editing, setEditing] = useState(false)

  const refresh = async (): Promise<void> => {
    const list = await window.api.trips.list()
    setTrips(list)
    const entries = await Promise.all(
      list.map(async (trip): Promise<[number, TripSummary]> => [
        trip.id,
        await buildTripSummary(trip.id)
      ])
    )
    setSummaries(new Map(entries))
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleCreate = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    try {
      await window.api.trips.create(newTripName)
      setNewTripName('')
      await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    }
  }

  const toggleEditing = (): void => {
    // Leaving edit mode with a rename form still open would strand it visible with no way to
    // reach it again except re-entering edit mode — just cancel it, nothing was saved anyway.
    setRenamingId(null)
    setEditing((v) => !v)
  }

  const startRename = (trip: Trip): void => {
    setRenamingId(trip.id)
    setRenameValue(trip.name)
  }

  const submitRename = async (e: FormEvent, id: number): Promise<void> => {
    e.preventDefault()
    setError('')
    try {
      await window.api.trips.rename(id, renameValue)
      setRenamingId(null)
      await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    }
  }

  const handleDelete = async (trip: Trip): Promise<void> => {
    if (
      !window.confirm(
        `Delete "${trip.name}"? This deletes every day in this trip and everything in them ` +
          `(photos, messages, journal entries). This cannot be undone.`
      )
    )
      return
    setError('')
    try {
      await window.api.trips.delete(trip.id)
      await refresh()
    } catch (err) {
      setError(cleanErrorMessage(err))
    }
  }

  return (
    <div className="trip-list">
      <div className="trip-list-header">
        <h1>Trips</h1>
        <button type="button" className="how-to-link" onClick={onShowHowTo}>
          How to use this app
        </button>
      </div>

      <form className="new-trip-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="New trip name (e.g. PCT 2026)"
          value={newTripName}
          onChange={(e) => setNewTripName(e.target.value)}
        />
        <button type="submit">Create trip</button>
      </form>

      {error && <p className="error">{error}</p>}

      {trips.length === 0 ? (
        <p className="empty">No trips yet. Create one above to get started.</p>
      ) : (
        <>
          <div className="list-edit-toggle">
            <button type="button" onClick={toggleEditing}>
              {editing ? 'Done' : 'Edit trips'}
            </button>
          </div>
          <ul className="trips">
            {trips.map((trip) => {
              const summary = summaries.get(trip.id)
              return (
                <li key={trip.id} className="trip-row">
                  {renamingId === trip.id ? (
                    <form className="rename-form" onSubmit={(e) => submitRename(e, trip.id)}>
                      <input
                        type="text"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                      />
                      <button type="submit">Save</button>
                      <button type="button" onClick={() => setRenamingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="trip-name"
                        onClick={() => onSelectTrip(trip)}
                        style={
                          summary?.photoDataUri
                            ? ({
                                '--trip-photo': `url(${summary.photoDataUri})`
                              } as React.CSSProperties)
                            : undefined
                        }
                      >
                        <span className="trip-name-text">{trip.name}</span>
                        {summary?.dateRangeLabel && (
                          <span className="trip-date-range">{summary.dateRangeLabel}</span>
                        )}
                        {summary && summary.states.length > 0 && (
                          <span className="trip-states">{summary.states.join(', ')}</span>
                        )}
                      </button>
                      {editing && (
                        <div className="trip-actions">
                          <button type="button" onClick={() => startRename(trip)}>
                            Rename
                          </button>
                          <button type="button" onClick={() => handleDelete(trip)}>
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export default TripList
