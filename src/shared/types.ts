export interface Trip {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}

export interface Track {
  id: number
  tripId: number
  name: string
  date: string
  createdAt: string
}

export interface TrackPoint {
  lat: number
  lng: number
  elevation: number | null
  timestamp: string
}

// One plain-text journal entry per track (v1 is plain text only, no markdown/rich text).
export interface Entry {
  id: number
  trackId: number
  text: string
  updatedAt: string
}
