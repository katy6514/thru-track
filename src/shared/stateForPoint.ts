import usStates from './data/usStates.json'

// [lng, lat] pairs, GeoJSON coordinate order.
type Ring = [number, number][]
// First ring is the outer boundary; any further rings are holes cut out of it.
type Polygon = Ring[]
type MultiPolygon = Polygon[]

interface StateFeature {
  properties: { name: string }
  geometry:
    { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: MultiPolygon }
}

const features = (usStates as unknown as { features: StateFeature[] }).features

// Standard ray-casting (even-odd rule) point-in-ring test: counts how many times a ray cast from
// the point due "east" crosses the ring's edges: An odd count means inside is odd.
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  if (!pointInRing(lng, lat, polygon[0])) return false
  // Any ring after the first is a hole — inside one of those means NOT inside the polygon.
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false
  }
  return true
}

// Determines which US state (by name) a coordinate falls within, using each state's real
// boundary polygon rather than a bounding box — a day's hike can run close enough alongside a
// state line that a bounding box would place points on the wrong side of it. Returns null when
// the point isn't inside any state in the dataset (open ocean, outside the US/territories, or
// just past the edge of these simplified boundaries).
export function stateForPoint(lat: number, lng: number): string | null {
  for (const feature of features) {
    const { geometry } = feature
    if (geometry.type === 'Polygon') {
      if (pointInPolygon(lng, lat, geometry.coordinates)) return feature.properties.name
    } else {
      for (const polygon of geometry.coordinates) {
        if (pointInPolygon(lng, lat, polygon)) return feature.properties.name
      }
    }
  }
  return null
}
