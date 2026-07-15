import { useState } from 'react'
import TripList from './components/TripList'
import TrackList from './components/TrackList'
import HowTo from './components/HowTo'
import type { Trip } from '../../shared/types'

function App(): React.JSX.Element {
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [showHowTo, setShowHowTo] = useState(false)

  if (showHowTo) {
    return <HowTo onBack={() => setShowHowTo(false)} />
  }

  if (selectedTrip) {
    return <TrackList trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
  }

  return <TripList onSelectTrip={setSelectedTrip} onShowHowTo={() => setShowHowTo(true)} />
}

export default App
