import L from 'leaflet'

// Scroll-wheel zoom starts disabled so a hiker scrolling the page past a map doesn't get
// hijacked into zooming it instead — it only activates once they click into the map, and
// deactivates again the moment the cursor leaves, so the rest of the page always scrolls
// normally. The hint label makes the click-to-activate behavior discoverable. Shared by every
// map in the app so the interaction is consistent everywhere.
export function attachClickToZoom(map: L.Map, container: HTMLDivElement): void {
  const zoomHint = L.DomUtil.create('div', 'track-map-zoom-hint', container)
  zoomHint.textContent = 'Click to zoom'
  container.addEventListener('click', () => {
    map.scrollWheelZoom.enable()
    zoomHint.classList.add('track-map-zoom-hint-hidden')
  })
  container.addEventListener('mouseleave', () => {
    map.scrollWheelZoom.disable()
    zoomHint.classList.remove('track-map-zoom-hint-hidden')
  })
}

// Four free, no-signup basemaps a hiker can switch between via the layer control this adds — see
// issue #36 for the full evaluation notes (attribution requirements, rate limits, what would need
// to change if this app gets wide distribution). CartoDB's Positron/Dark Matter tiles were also
// considered but now require a free API key (their old no-key endpoint is deprecated), so they're
// left out of this no-signup set for now. Shared by every map in the app (a single track's detail
// map and the trip-wide overview map) so they all offer the same basemap choices.
export function addBaseLayers(map: L.Map): void {
  const baseLayers: Record<string, L.TileLayer> = {
    // Renders contour lines and hillshading from SRTM elevation data on top of OSM data — the
    // default, since elevation is visible at a glance. Its tile server only produces tiles up to
    // z17 (maxNativeZoom) — beyond that Leaflet upscales the z17 tiles rather than requesting
    // ones that don't exist. `maxZoom` is left at the other layers' ceiling (20) rather than 17
    // so the layer control doesn't gray out Topo's radio button the moment you're zoomed in past
    // 17 on a different layer — Leaflet's control auto-disables any base layer whose maxZoom is
    // below the current zoom, which otherwise made switching back to Topo look broken.
    Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution:
        'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
      maxZoom: 20,
      maxNativeZoom: 17
    }),
    Satellite: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
      }
    ),
    Streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }),
    // US-only coverage (a federal service), but genuinely free with no per-key rate limiting —
    // a good alternative if OpenTopoMap's shared community server is ever unreachable.
    'USGS Topo (US only)': L.tileLayer(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
        maxZoom: 20
      }
    )
  }
  baseLayers.Topo.addTo(map)
  L.control.layers(baseLayers).addTo(map)
}

// A fixed, high-contrast palette so tracks read as distinct colors on the trip overview map —
// cycles (via modulo, see trackColor below) rather than generating colors, so they stay
// predictable and legible against both the map tiles and the app's dark UI chrome.
const TRACK_COLORS = [
  '#2563eb', // blue — same as a single track's own detail-map polyline, so the first track in a
  // trip reads consistently whether you're looking at the overview or its own page
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#9333ea', // purple
  '#0d9488', // teal
  '#db2777', // pink
  '#65a30d' // lime
]

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length]
}
