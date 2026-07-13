import { useState } from 'react'
import TripList from './components/TripList'
import TrackList from './components/TrackList'
import JournalEditor from './components/JournalEditor'
import type { Trip, Track } from '../../shared/types'

function App(): React.JSX.Element {
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)

  const handleSelectTrip = (trip: Trip): void => {
    setSelectedTrack(null)
    setSelectedTrip(trip)
  }

  const handleBackToTrips = (): void => {
    setSelectedTrack(null)
    setSelectedTrip(null)
  }

  if (selectedTrip && selectedTrack) {
    return <JournalEditor track={selectedTrack} onBack={() => setSelectedTrack(null)} />
  }

  if (selectedTrip) {
    return (
      <TrackList trip={selectedTrip} onBack={handleBackToTrips} onSelectTrack={setSelectedTrack} />
    )
  }

  return <TripList onSelectTrip={handleSelectTrip} />
}

export default App
