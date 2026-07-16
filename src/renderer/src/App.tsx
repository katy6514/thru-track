import { useEffect, useState } from 'react'
import TripList from './components/TripList'
import TrackList from './components/TrackList'
import HowTo from './components/HowTo'
import { applyTheme } from './theme'
import type { Trip } from '../../shared/types'

const THEME_RECHECK_INTERVAL_MS = 60_000

function App(): React.JSX.Element {
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [showHowTo, setShowHowTo] = useState(false)

  useEffect(() => {
    const interval = setInterval(applyTheme, THEME_RECHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  if (showHowTo) {
    return <HowTo onBack={() => setShowHowTo(false)} />
  }

  if (selectedTrip) {
    return <TrackList trip={selectedTrip} onBack={() => setSelectedTrip(null)} />
  }

  return <TripList onSelectTrip={setSelectedTrip} onShowHowTo={() => setShowHowTo(true)} />
}

export default App
