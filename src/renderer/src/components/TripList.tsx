import { useEffect, useState, type FormEvent } from 'react'
import type { Trip } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'

interface TripListProps {
  onSelectTrip: (trip: Trip) => void
}

function TripList({ onSelectTrip }: TripListProps): React.JSX.Element {
  const [trips, setTrips] = useState<Trip[]>([])
  const [newTripName, setNewTripName] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [error, setError] = useState('')

  const refresh = async (): Promise<void> => {
    setTrips(await window.api.trips.list())
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
    if (!window.confirm(`Delete "${trip.name}"? This cannot be undone.`)) return
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
      <h1>Trips</h1>

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
        <ul className="trips">
          {trips.map((trip) => (
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
                  <button type="button" className="trip-name" onClick={() => onSelectTrip(trip)}>
                    {trip.name}
                  </button>
                  <span className="trip-date">{new Date(trip.createdAt).toLocaleDateString()}</span>
                  <div className="trip-actions">
                    <button type="button" onClick={() => startRename(trip)}>
                      Rename
                    </button>
                    <button type="button" onClick={() => handleDelete(trip)}>
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default TripList
