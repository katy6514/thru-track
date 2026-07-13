import { useState } from 'react'
import TripList from './components/TripList'
import TrackList from './components/TrackList'
import type { Trip } from '../../shared/types'

function App(): React.JSX.Element {
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)

  if (selectedTrip) {
    return <TrackList trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
  }

  return <TripList onSelectTrip={setSelectedTrip} />
}

export default App
