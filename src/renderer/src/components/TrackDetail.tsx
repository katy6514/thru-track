import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type {
  Track,
  TrackPoint,
  Photo,
  PendingPhoto,
  PhotoImportNeedsOffset,
  PhotoImportResult,
  Message
} from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { formatTrackDate } from '../formatTrackDate'
import { addBaseLayers, attachClickToZoom } from '../mapBaseLayers'
import { splitTrackIntoSegments } from '../../../shared/splitTrackSegments'
import { orderPhotosChronologically } from '../../../shared/orderPhotos'
import { interpolatePosition } from '../../../shared/positionInterpolator'
import { computeTrackStats } from '../../../shared/trackStats'
import {
  clusterTimelineItems,
  type TimelineItem,
  type TimelineCluster
} from '../../../shared/clusterTimelineItems'
import SidePanel from './SidePanel'
import PhotoGallery from './PhotoGallery'

// Leaflet's default marker icon references relative image paths that resolve fine when its CSS
// is served as-is, but break once a bundler (Vite here) rewrites asset URLs — the icon silently
// 404s and renders as a broken-image placeholder. Re-pointing it at the bundler-resolved URLs is
// the standard fix; without this every marker on the map would be invisible/broken.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
})

// A photo pin needs to read as visually distinct from the plain default marker (track start /
// scrub position) at a glance. Built as a CSS-styled divIcon rather than another image asset —
// that sidesteps the exact bundler-rewritten-asset-path problem the comment above works around,
// with one less image import to get wrong.
const photoIcon = L.divIcon({
  className: 'photo-map-marker',
  html: '<div class="photo-map-marker-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
})

// A square divIcon rather than Leaflet's built-in L.circleMarker (which can only ever render a
// circle) — a message's map pin needs to be a square to match its own timeline marker's shape,
// same "same kind of thing reads the same way in both places" reasoning as the photo pin above.
const messageIcon = L.divIcon({
  className: 'message-map-marker',
  html: '<div class="message-map-marker-dot"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
})

interface TrackDetailProps {
  track: Track
  // Every track in this track's trip, in the same date-sorted order the parent already fetches
  // and displays them in — used only to find the previous/next day's track for the header nav
  // buttons below, so this component doesn't need its own separate fetch of the same list.
  tripTracks: Track[]
  onBack: () => void
  // Called after a successful name/start-location/end-location edit (see the track-info-edit
  // form below) so the parent — which owns the selected Track object this component only
  // receives as a prop — can update its own copy. Without this the header would keep showing the
  // pre-edit values until the hiker navigated away and back.
  onTrackUpdated: (track: Track) => void
  // Switches the parent's selected track to the given id — used by the photo-offset prompt's
  // "Go to <day> instead" suggestion (see suggestedTrack below), and by the previous/next-day
  // header buttons, so a hiker can jump straight to another day without backing out to the list.
  onOpenTrack: (trackId: number) => void
  // Called after the track is actually deleted (see the Delete track button in the edit form
  // below) so the parent can both close this detail view (the track it was showing no longer
  // exists) and drop it from its own list — same "the child can't do this itself" reasoning as
  // onTrackUpdated above.
  onTrackDeleted: () => void
}

// Debounce autosave: save AUTOSAVE_DELAY_MS after the hiker stops typing, rather than requiring
// an explicit "Save" click. Journal entries are written trailside on unreliable devices/batteries
// where a hiker may close the app mid-thought — autosave means there's no "did I remember to
// save?" step, and a keystroke is never at risk of being lost to a forgotten click. Backed up by
// a best-effort flush if they navigate to another track before that fires (see the journal
// cleanup below) so edits aren't stranded in the debounce window either.
const AUTOSAVE_DELAY_MS = 800

// The photo overlay (see below) covers the right half of the map, so centering the map on a
// photo's marker the normal way would land it right at the overlay's edge — this shifts the
// map's projected center point right by a quarter of the container width first, which puts the
// marker at the horizontal center of the remaining visible (left) half instead.
const PHOTO_OVERLAY_CENTER_SHIFT = 0.25

function centerMapOnPhotoMarker(map: L.Map, latlng: L.LatLngExpression): void {
  const size = map.getSize()
  const zoom = map.getZoom()
  const markerPoint = map.project(latlng, zoom)
  const targetPoint = markerPoint.add(L.point(size.x * PHOTO_OVERLAY_CENTER_SHIFT, 0))
  map.panTo(map.unproject(targetPoint, zoom), { animate: true })
}

function renderTrackMap(
  container: HTMLDivElement,
  points: TrackPoint[]
): { map: L.Map; marker: L.Marker | null; messageLayer: L.LayerGroup } {
  const map = L.map(container, { scrollWheelZoom: false })
  attachClickToZoom(map, container)

  // A satellite message always carries its own GPS position (unlike a photo), so its map markers
  // are populated by a separate effect keyed on the `messages` state — this empty layer group is
  // just the place they get added to, independent of whether the track itself is timed.
  const messageLayer = L.layerGroup().addTo(map)

  addBaseLayers(map)

  if (points.length === 0) {
    map.setView([0, 0], 2)
    return { map, marker: null, messageLayer }
  }

  // A track with a time gap (e.g. a paused/lost-signal recorder) is split
  // into separate contiguous runs and rendered as separate polylines, so
  // the gap shows up as a visual break rather than a straight line jumping
  // across it.
  const segments = splitTrackIntoSegments(points)
  const allLatLngs: L.LatLngExpression[] = []

  for (const segment of segments) {
    const latLngs: L.LatLngExpression[] = segment.map((p) => [p.lat, p.lng])
    L.polyline(latLngs, { color: '#2563eb', weight: 4 }).addTo(map)
    allLatLngs.push(...latLngs)
  }

  map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] })

  // Only a timed track has a timeline to scrub, so only it gets a position marker — a timeless
  // track (e.g. a CalTopo retrace) has no per-point time to place a marker at a moment of.
  const isTimed = points[0].timestamp !== null
  const marker = isTimed ? L.marker([points[0].lat, points[0].lng]).addTo(map) : null

  return { map, marker, messageLayer }
}

function formatPhotoTitle(photo: Photo): string {
  return photo.timestamp ? new Date(photo.timestamp).toLocaleString() : 'Photo'
}

function formatMessageTitle(message: Message): string {
  return new Date(message.timestamp).toLocaleString()
}

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Splits a journal entry's plain text into paragraphs (on blank lines) for read-only display as
// actual <p> elements — a single pre-wrapped block would keep the hiker's line breaks but reads
// as one big slab of text rather than the paragraphs they actually wrote.
function journalParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
}

const TIMELINE_ITEM_KIND_LABEL: Record<TimelineItem['kind'], string> = {
  photo: 'Photo',
  message: 'Message'
}

// Must match .timeline-slider::-webkit-slider-thumb's width in main.css exactly.
const TIMELINE_THUMB_WIDTH_PX = 14

// A native range thumb's travel is inset from the track's own edges by half the thumb's width
// (at value=min the thumb sits at TIMELINE_THUMB_WIDTH_PX / 2 from the left, not at the very
// edge) — plain `left: X%` positions a marker against the full track width instead, so it drifts
// away from where the slider thumb actually sits for that same value the closer to either edge
// it is. This reproduces the thumb's own inset so a marker lines up with the thumb position for
// its timestamp.
function timelineMarkerLeft(percent: number): string {
  const half = TIMELINE_THUMB_WIDTH_PX / 2
  return `calc(${half}px + (100% - ${TIMELINE_THUMB_WIDTH_PX}px) * ${percent / 100})`
}

// Looks up a timeline item's own display text (a message's content, or just "Photo" — there's
// nothing photo-specific to show inline) — shared by a standalone marker's title/aria label and
// by its entry in an open cluster's picker list.
function timelineItemSummary(item: TimelineItem, messages: Message[]): string {
  if (item.kind === 'message') return messages.find((m) => m.id === item.id)?.content ?? 'Message'
  return 'Photo'
}

// Renders a signed minutes offset in a readable "+2h 30m" (or "-1h", "+45m", "no offset") form
// for the confirmation prompt, rather than a bare (and easy to misread) minutes count.
function formatOffset(minutes: number): string {
  if (minutes === 0) return 'no offset'
  const sign = minutes > 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  if (hours === 0) return `${sign}${mins}m`
  if (mins === 0) return `${sign}${hours}h`
  return `${sign}${hours}h ${mins}m`
}

// A small pencil glyph (Material Design's own Edit icon path) marking an inline-editable field —
// drawn as inline SVG rather than pulling in an icon library for the one shape this app needs.
function EditIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
    </svg>
  )
}

interface EditableFieldProps {
  // '' means "not set yet" — never null, so the field always has something well-defined to
  // compare a fresh draft against and to restore on Escape.
  value: string
  // Shown in place of an empty value, and used to build the edit button's own aria-label.
  placeholder: string
  onSave: (value: string) => Promise<void>
  // Only true for the track name — an empty title makes no sense, so blurring an emptied-out
  // draft reverts instead of saving, the same way a track can never be renamed to nothing via the
  // old form's `required` input.
  required?: boolean
  inputClassName?: string
}

// A value that reads as plain text with a small pencil button beside it, and becomes a text
// input in place the moment that pencil is clicked — used for the track title and its start/end
// location, each independently. Saves on blur (or Enter, which just blurs) — same "type freely,
// save when you leave the field" shape as a photo's caption in PhotoGallery.tsx — and Escape
// reverts without saving, since unlike a caption these sit right next to their own dedicated
// trigger rather than being always in an editable state.
function EditableField({
  value,
  placeholder,
  onSave,
  required,
  inputClassName
}: EditableFieldProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEditing = (): void => {
    setDraft(value)
    setEditing(true)
  }

  const commit = async (): Promise<void> => {
    const trimmed = draft.trim()
    setEditing(false)
    if (required && trimmed === '') return
    if (trimmed === value) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={inputClassName}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        aria-label={placeholder}
      />
    )
  }

  return (
    <>
      {value || <span className="editable-field-placeholder">{placeholder}</span>}
      <button
        type="button"
        className="editable-field-edit-button"
        onClick={startEditing}
        disabled={saving}
        aria-label={`Edit ${placeholder.toLowerCase()}`}
      >
        <EditIcon />
      </button>
    </>
  )
}

// Which side-panel item (if any) is currently open. A photo and a message can never be open at
// the same time — this is a single discriminated slot rather than two independent "selected id"
// states, so selecting one always closes the other.
type SelectedItem = { kind: 'photo'; id: number } | { kind: 'message'; id: number } | null

function TrackDetail({
  track,
  tripTracks,
  onBack,
  onTrackUpdated,
  onOpenTrack,
  onTrackDeleted
}: TrackDetailProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const photoMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const messageLayerRef = useRef<L.LayerGroup | null>(null)
  // Wherever the map was centered before the photo overlay shifted it to keep a marker visible
  // in the left half — restored once the overlay closes, rather than leaving the map permanently
  // offset. Null whenever the overlay isn't open.
  const preOverlayCenterRef = useRef<L.LatLng | null>(null)
  const [error, setError] = useState('')
  const [points, setPoints] = useState<TrackPoint[] | null>(null)
  // Name and start/end location are each independently inline-editable (see EditableField below)
  // regardless of whether the track is timed — only the date itself is never editable (see
  // updateTrack's own doc comment).
  const [deletingTrack, setDeletingTrack] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [scrubMs, setScrubMs] = useState<number | null>(null)
  const [scrubStatus, setScrubStatus] = useState<'ok' | 'gap' | 'out-of-range'>('ok')
  // Which timeline picker currently has its list open — at most one at a time. A number is an
  // index into the clusterTimelineItems() array (recomputed fresh each render from the same
  // photos/messages state the picker itself reads, so indexes stay valid between renders);
  // 'before'/'after' are the two edge buckets for items outside the track's own recorded time
  // range (see timelineBeforeItems/timelineAfterItems below).
  const [openTimelinePicker, setOpenTimelinePicker] = useState<number | 'before' | 'after' | null>(
    null
  )
  const openTimelinePickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (openTimelinePicker === null) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (
        openTimelinePickerRef.current &&
        !openTimelinePickerRef.current.contains(e.target as Node)
      ) {
        setOpenTimelinePicker(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTimelinePicker])

  // Journal entry editing is inline (below the map) rather than a separate page, so the hiker can
  // keep the map/photos/timeline in view while writing. journalSavedTextRef tracks what's actually
  // been persisted (vs. journalText, which tracks every keystroke) so the unmount/track-switch
  // flush below only fires an extra save when there's really something unsaved.
  const [journalText, setJournalText] = useState('')
  const [journalStatus, setJournalStatus] = useState<
    'loading' | 'saved' | 'unsaved' | 'saving' | 'error'
  >('loading')
  const [journalError, setJournalError] = useState('')
  // Read-only paragraphs by default, switching to the editable textarea once the hiker clicks
  // Edit — an always-visible textarea read as too "form-like" for text that's meant to be read
  // back later, like a diary entry.
  const [journalEditing, setJournalEditing] = useState(false)
  const journalTextRef = useRef('')
  const journalSavedTextRef = useRef('')
  const journalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const journalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const journalPreviewRef = useRef<HTMLDivElement>(null)

  const [photos, setPhotos] = useState<Photo[]>([])
  const [importingPhotos, setImportingPhotos] = useState(false)
  const [photoError, setPhotoError] = useState('')
  // A file whose content exactly matches a photo already stored for this track is silently
  // skipped rather than re-imported (see photoContentHashExists in repository.ts) — this is just
  // the count of that, shown as a brief informational notice so "I picked 5 photos but only see
  // 3 new ones" has a visible answer instead of looking like a bug.
  const [photoDuplicatesSkipped, setPhotoDuplicatesSkipped] = useState(0)
  // Set when photos:import comes back with needsOffsetConfirm — a timed track and at least one
  // EXIF timestamp in the batch means there's an actual offset to confirm/adjust before this
  // batch is stored. Nothing has been copied to managed storage or written to the DB yet at this
  // point, so canceling out of this prompt simply discards `pending` — no cleanup needed.
  const [pendingOffsetImport, setPendingOffsetImport] = useState<{
    pending: PendingPhoto[]
    proposedOffsetMinutes: number
    suggestedTrack: { trackId: number; name: string; date: string; offsetMinutes: number } | null
  } | null>(null)
  const [offsetInput, setOffsetInput] = useState('0')

  // Set while a phone-upload session (issue #33) is running: the URL/QR the hiker's phone
  // connects to. Null means no session is active — the server itself is only running on the main
  // process while this is non-null.
  const [phoneUploadSession, setPhoneUploadSession] = useState<{
    url: string
    qrDataUri: string
  } | null>(null)
  const [startingPhoneUpload, setStartingPhoneUpload] = useState(false)
  const [phoneUploadError, setPhoneUploadError] = useState('')

  const [messages, setMessages] = useState<Message[]>([])
  const [importingMessages, setImportingMessages] = useState(false)
  const [messageError, setMessageError] = useState('')

  // The journal/photos/messages actions collapse into one "Add data" button that pops this menu
  // open, mirroring the track list's "Add track" menu (see TrackList.tsx).
  const [showAddDataMenu, setShowAddDataMenu] = useState(false)
  const addDataMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showAddDataMenu) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (addDataMenuRef.current && !addDataMenuRef.current.contains(e.target as Node)) {
        setShowAddDataMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAddDataMenu])

  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null)
  const [photoDataUri, setPhotoDataUri] = useState<string | null>(null)
  const [photoDataLoading, setPhotoDataLoading] = useState(false)
  const [photoDataError, setPhotoDataError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    setPoints(null)
    setDeleteError('')
    setScrubMs(null)
    setScrubStatus('ok')
    setOpenTimelinePicker(null)
    setJournalText('')
    setJournalStatus('loading')
    setJournalError('')
    setJournalEditing(false)
    journalTextRef.current = ''
    journalSavedTextRef.current = ''
    if (journalTimeoutRef.current) {
      clearTimeout(journalTimeoutRef.current)
      journalTimeoutRef.current = null
    }
    setPhotos([])
    setMessages([])
    setSelectedItem(null)
    setPhotoError('')
    setPhotoDuplicatesSkipped(0)
    setMessageError('')
    setPendingOffsetImport(null)
    setOffsetInput('0')
    // A phone-upload session is scoped to the track it was started from — switching tracks (or
    // unmounting) must not leave a server running against the day the hiker just navigated away
    // from, so stop it here rather than requiring an explicit "Done" click every time.
    window.api.photoUpload.stop()
    setPhoneUploadSession(null)
    setPhoneUploadError('')
    setShowAddDataMenu(false)

    Promise.all([
      window.api.tracks.getPoints(track.id),
      window.api.photos.list(track.id),
      window.api.messages.list(track.id),
      window.api.entries.get(track.id)
    ])
      .then(([fetchedPoints, fetchedPhotos, fetchedMessages, fetchedEntry]) => {
        if (cancelled || !mapContainerRef.current) return
        if (mapRef.current) {
          mapRef.current.remove()
          mapRef.current = null
        }
        photoMarkersRef.current = new Map()
        // A zero-point track (e.g. a zero day) gets no Leaflet map at all — not just an empty one
        // — so nothing is built here, and the map section's container stays hidden (see
        // mapDataConfirmedEmpty above and the JSX below).
        if (fetchedPoints.length > 0) {
          const { map, marker, messageLayer } = renderTrackMap(
            mapContainerRef.current,
            fetchedPoints
          )
          mapRef.current = map
          markerRef.current = marker
          messageLayerRef.current = messageLayer
        }
        setPoints(fetchedPoints)
        setPhotos(fetchedPhotos)
        setMessages(fetchedMessages)
        const initialJournalText = fetchedEntry?.text ?? ''
        setJournalText(initialJournalText)
        journalTextRef.current = initialJournalText
        journalSavedTextRef.current = initialJournalText
        setJournalStatus('saved')
        if (fetchedPoints.length > 0 && fetchedPoints[0].timestamp !== null) {
          setScrubMs(Date.parse(fetchedPoints[0].timestamp as string))
        }
      })
      .catch((err) => {
        if (!cancelled) setError(cleanErrorMessage(err))
      })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      markerRef.current = null
      photoMarkersRef.current = new Map()
      messageLayerRef.current = null
      if (journalTimeoutRef.current) {
        clearTimeout(journalTimeoutRef.current)
        journalTimeoutRef.current = null
      }
      // Best-effort flush of any unsaved journal edits when switching tracks (or unmounting)
      // before the autosave debounce fires.
      if (journalTextRef.current !== journalSavedTextRef.current) {
        void window.api.entries.save(track.id, journalTextRef.current)
      }
    }
  }, [track.id])

  // Message markers are re-rendered onto the map's message layer whenever `messages` changes —
  // both on initial track load and after a fresh CSV import — rather than only once at map
  // creation, so a newly imported batch shows up on the map immediately without reloading the
  // track. A message's marker uses its own lat/lng straight from the CSV, independent of whether
  // the track itself is timed (unlike the track's own position marker above).
  useEffect(() => {
    const layer = messageLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const message of messages) {
      L.marker([message.lat, message.lng], { icon: messageIcon })
        .bindTooltip(message.content || '(no message text)')
        .on('click', () => setSelectedItem({ kind: 'message', id: message.id }))
        .addTo(layer)
    }
  }, [messages])

  // A confirmed zero-point track (e.g. a zero day) has no geography to show at all — the map
  // section is hidden entirely rather than showing an empty world view. Deliberately only true
  // once points have actually loaded and come back empty (not merely "not loaded yet"), so a real
  // track's map stays visible through its own normal loading window exactly as it always has —
  // see the map-building effect below, which skips creating a Leaflet map at all in this case.
  const mapDataConfirmedEmpty = points !== null && points.length === 0
  const isTimed = points !== null && points.length > 0 && points[0].timestamp !== null
  const trackStartMs = isTimed && points ? Date.parse(points[0].timestamp as string) : null
  const trackEndMs =
    isTimed && points ? Date.parse(points[points.length - 1].timestamp as string) : null
  const trackStats = points !== null ? computeTrackStats(points) : null

  // Previous/next day, by position in the trip's own date-sorted track list (not by comparing
  // `date` strings directly) — consistent with how the trip overview already orders/colors
  // tracks (see trackIndexById in TrackList.tsx), including two tracks that happen to share a
  // date.
  const tripTrackIndex = tripTracks.findIndex((t) => t.id === track.id)
  const previousTrack = tripTrackIndex > 0 ? tripTracks[tripTrackIndex - 1] : null
  const nextTrack =
    tripTrackIndex !== -1 && tripTrackIndex < tripTracks.length - 1
      ? tripTracks[tripTrackIndex + 1]
      : null

  const handleSaveName = async (name: string): Promise<void> => {
    const updated = await window.api.tracks.update(track.id, { name })
    onTrackUpdated(updated)
  }

  const handleSaveStartLocation = async (startLocation: string): Promise<void> => {
    const updated = await window.api.tracks.update(track.id, { startLocation })
    onTrackUpdated(updated)
  }

  const handleSaveEndLocation = async (endLocation: string): Promise<void> => {
    const updated = await window.api.tracks.update(track.id, { endLocation })
    onTrackUpdated(updated)
  }

  const handleDeleteTrack = async (): Promise<void> => {
    if (
      !window.confirm(
        `Delete "${track.name}" and everything in it (photos, messages, journal entry)? ` +
          `This cannot be undone.`
      )
    )
      return
    setDeletingTrack(true)
    setDeleteError('')
    try {
      await window.api.tracks.delete(track.id)
      onTrackDeleted()
    } catch (err) {
      setDeleteError(cleanErrorMessage(err))
      setDeletingTrack(false)
    }
  }

  // Keeps the map's photo pins in sync with the `photos` state, independent of the initial
  // track-load effect above — this also fires right after a fresh batch is imported, without
  // needing to re-fetch points or rebuild the whole map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const existing of photoMarkersRef.current.values()) existing.remove()
    photoMarkersRef.current = new Map()

    for (const photo of photos) {
      if (photo.lat === null || photo.lng === null) continue
      const marker = L.marker([photo.lat, photo.lng], { icon: photoIcon }).addTo(map)
      marker.on('click', () => setSelectedItem({ kind: 'photo', id: photo.id }))
      photoMarkersRef.current.set(photo.id, marker)
    }
  }, [photos])

  // The single place that moves the map marker to match an absolute epoch-ms instant — shared by
  // the slider's onChange below and by the zoom/pan handlers (which need to re-sync the marker
  // whenever narrowing/shifting the visible window clamps `scrubMs` to a new position), so there's
  // only ever one implementation of "move the marker" to keep correct.
  const applyScrub = (ms: number): void => {
    if (!points) return
    setScrubMs(ms)

    const result = interpolatePosition(points, ms)
    setScrubStatus(result.status)
    if (result.status === 'ok' && markerRef.current) {
      markerRef.current.setLatLng([result.lat, result.lng])
      markerRef.current.setOpacity(1)
    } else if (markerRef.current) {
      // A gap (or, defensively, an out-of-range scrub) has no real position to show — hiding
      // the marker is more honest than leaving it sitting at the last known point, which would
      // read as "this is where you were" rather than "we don't actually know."
      markerRef.current.setOpacity(0)
    }
  }

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>): void => {
    applyScrub(Number(e.target.value))
  }

  const saveJournal = async (value: string): Promise<void> => {
    setJournalStatus('saving')
    setJournalError('')
    try {
      await window.api.entries.save(track.id, value)
      journalSavedTextRef.current = value
      setJournalStatus('saved')
    } catch (err) {
      setJournalError(cleanErrorMessage(err))
      setJournalStatus('error')
    }
  }

  const handleJournalChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    setJournalText(value)
    setJournalStatus('unsaved')
    journalTextRef.current = value

    if (journalTimeoutRef.current) clearTimeout(journalTimeoutRef.current)
    journalTimeoutRef.current = setTimeout(() => {
      void saveJournal(value)
    }, AUTOSAVE_DELAY_MS)
  }

  const handleStartEditingJournal = (): void => {
    setJournalEditing(true)
  }

  // Leaving edit mode flushes any pending debounced save immediately rather than leaving it to
  // fire on its own timer — otherwise the preview below could briefly show stale text (or the
  // status could still read "Unsaved changes…") right after switching back to it.
  const handleDoneEditingJournal = (): void => {
    setJournalEditing(false)
    if (journalTimeoutRef.current) {
      clearTimeout(journalTimeoutRef.current)
      journalTimeoutRef.current = null
    }
    if (journalTextRef.current !== journalSavedTextRef.current) {
      void saveJournal(journalTextRef.current)
    }
  }

  // The textarea only exists in the DOM once editing starts, so it can't be focused until after
  // that render — this fires right after, rather than trying to focus it inline in the click
  // handler that flips journalEditing to true.
  useEffect(() => {
    if (journalEditing) journalTextareaRef.current?.focus()
  }, [journalEditing])

  // Shared by the file-picker import below and the phone-upload event listener further down —
  // both paths resolve to the same PhotoImportResult | PhotoImportNeedsOffset shape, so a batch
  // that needs an offset confirmation surfaces through the same prompt regardless of where it
  // came from.
  const applyPhotoImportResult = (result: PhotoImportResult | PhotoImportNeedsOffset): void => {
    setPhotoDuplicatesSkipped(result.duplicatesSkipped)
    if ('needsOffsetConfirm' in result) {
      // Nothing has been stored yet — hold the pending batch until the hiker confirms (or
      // adjusts) the proposed offset via handleConfirmOffset below.
      setPendingOffsetImport({
        pending: result.pending,
        proposedOffsetMinutes: result.proposedOffsetMinutes,
        suggestedTrack: result.suggestedTrack
      })
      setOffsetInput(String(result.proposedOffsetMinutes))
    } else if (result.photos.length > 0) {
      window.api.photos.list(track.id).then(setPhotos)
    }
  }

  const handleImportPhotos = async (): Promise<void> => {
    setImportingPhotos(true)
    setPhotoError('')
    try {
      const result = await window.api.photos.import(track.id)
      applyPhotoImportResult(result)
    } catch (err) {
      setPhotoError(cleanErrorMessage(err))
    } finally {
      setImportingPhotos(false)
    }
  }

  const handleStartPhoneUpload = async (): Promise<void> => {
    setStartingPhoneUpload(true)
    setPhoneUploadError('')
    try {
      const session = await window.api.photoUpload.start(track.id)
      setPhoneUploadSession(session)
    } catch (err) {
      setPhoneUploadError(cleanErrorMessage(err))
    } finally {
      setStartingPhoneUpload(false)
    }
  }

  const handleStopPhoneUpload = async (): Promise<void> => {
    await window.api.photoUpload.stop()
    setPhoneUploadSession(null)
  }

  useEffect(() => {
    const unsubReceived = window.api.photoUpload.onBatchReceived(applyPhotoImportResult)
    const unsubError = window.api.photoUpload.onBatchError(setPhoneUploadError)
    return () => {
      unsubReceived()
      unsubError()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id])

  const handleConfirmOffset = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!pendingOffsetImport) return
    const offsetMinutes = Number(offsetInput)
    if (!Number.isFinite(offsetMinutes)) return

    setImportingPhotos(true)
    setPhotoError('')
    try {
      await window.api.photos.importWithOffset(track.id, pendingOffsetImport.pending, offsetMinutes)
      setPendingOffsetImport(null)
      const updated = await window.api.photos.list(track.id)
      setPhotos(updated)
    } catch (err) {
      setPhotoError(cleanErrorMessage(err))
    } finally {
      setImportingPhotos(false)
    }
  }

  const handleCancelOffset = (): void => {
    // Nothing was ever copied/written for this batch — discarding the pending list is the whole
    // cancellation, no IPC call needed.
    setPendingOffsetImport(null)
  }

  const handleGoToSuggestedTrack = (): void => {
    if (!pendingOffsetImport?.suggestedTrack) return
    // Same as handleCancelOffset: nothing was ever written for this batch, so discarding the
    // pending list and switching tracks is the whole handler — the hiker re-imports fresh once
    // they're actually on the right day.
    const trackId = pendingOffsetImport.suggestedTrack.trackId
    setPendingOffsetImport(null)
    onOpenTrack(trackId)
  }

  const handleImportMessages = async (): Promise<void> => {
    setImportingMessages(true)
    setMessageError('')
    try {
      const result = await window.api.messages.importCsv(track.id)
      if (result === null) return // hiker canceled the file dialog
      const updated = await window.api.messages.list(track.id)
      setMessages(updated)
    } catch (err) {
      setMessageError(cleanErrorMessage(err))
    } finally {
      setImportingMessages(false)
    }
  }

  const selectedPhoto =
    selectedItem?.kind === 'photo' ? (photos.find((p) => p.id === selectedItem.id) ?? null) : null
  const selectedMessage =
    selectedItem?.kind === 'message'
      ? (messages.find((m) => m.id === selectedItem.id) ?? null)
      : null

  // Same chronological order as the header slideshow, so the arrow-key navigation below moves
  // through the expanded photo the same way a hiker would expect from browsing that strip.
  const orderedPhotos = useMemo(() => orderPhotosChronologically(photos), [photos])

  // Left/right arrow keys step through the expanded photo overlay while it's open. Only attached
  // while a photo is actually selected, so arrow keys are otherwise left alone everywhere else on
  // the page (e.g. moving the cursor in the journal text input) — and even then, a keypress that
  // lands in an editable element is ignored rather than hijacked, in case one happens to be
  // focused underneath the overlay.
  useEffect(() => {
    if (!selectedPhoto) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const index = orderedPhotos.findIndex((p) => p.id === selectedPhoto.id)
      if (index === -1) return
      const nextIndex = e.key === 'ArrowLeft' ? index - 1 : index + 1
      if (nextIndex < 0 || nextIndex >= orderedPhotos.length) return

      e.preventDefault()
      setSelectedItem({ kind: 'photo', id: orderedPhotos[nextIndex].id })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPhoto, orderedPhotos])

  // Fetches the actual image bytes (as a base64 data URI) only once a photo is selected — the
  // renderer can't read arbitrary local files itself, so the side panel shows a loading state
  // while main process reads the file and hands it back over IPC.
  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoDataUri(null)
      setPhotoDataError('')
      return
    }
    let cancelled = false
    setPhotoDataUri(null)
    setPhotoDataError('')
    setPhotoDataLoading(true)
    window.api.photos
      .getDataUri(selectedPhoto.id)
      .then((uri) => {
        if (!cancelled) setPhotoDataUri(uri)
      })
      .catch((err) => {
        if (!cancelled) setPhotoDataError(cleanErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setPhotoDataLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPhoto])

  // The photo overlay covers the right half of the map — pan so the photo's own green marker
  // stays centered in the remaining visible (left) half instead of sitting under the overlay or
  // off-center. Reverts to wherever the map was centered before the overlay opened once it closes
  // (or the selection moves to a message instead, which uses the plain side panel). Also rings the
  // open photo's own marker (and only that one) so it doesn't get lost among nearby dots once the
  // map pans around it — re-applied here (rather than a separate effect) so it survives the marker
  // elements being torn down and rebuilt whenever `photos` changes underneath a selection.
  useEffect(() => {
    for (const [id, marker] of photoMarkersRef.current) {
      marker.getElement()?.classList.toggle('photo-map-marker-selected', id === selectedPhoto?.id)
    }

    const map = mapRef.current
    if (!map) return
    if (selectedPhoto && selectedPhoto.lat !== null && selectedPhoto.lng !== null) {
      if (preOverlayCenterRef.current === null) {
        preOverlayCenterRef.current = map.getCenter()
      }
      centerMapOnPhotoMarker(map, [selectedPhoto.lat, selectedPhoto.lng])
    } else if (preOverlayCenterRef.current !== null) {
      map.panTo(preOverlayCenterRef.current, { animate: true })
      preOverlayCenterRef.current = null
    }
  }, [selectedPhoto, photos])

  // A photo only earns a timeline marker when the track itself is timed (there's a time axis to
  // place it on) AND the photo has its own EXIF timestamp. Everything else — every photo on a
  // timeless track, plus the rare timed-track photo with no EXIF timestamp at all — has no
  // timeline dot, but still appears in the photo gallery below the journal entry like any other.
  const timelinePhotos = isTimed ? photos.filter((p) => p.timestamp !== null) : []

  // Every marker-worthy item (timed photos, messages — which always have a timestamp) combines
  // into a single list and groups into clusters, so a couple of photos taken a minute apart
  // render as one clickable badge instead of two unclickable overlapping dots.
  const timelineItems: TimelineItem[] = [
    ...timelinePhotos.map((p) => ({
      kind: 'photo' as const,
      id: p.id,
      ms: Date.parse(p.timestamp as string)
    })),
    ...messages.map((m) => ({ kind: 'message' as const, id: m.id, ms: Date.parse(m.timestamp) }))
  ]
  // A photo taken before the hiker started recording (or after they stopped — an evening/sunset
  // shot from camp is the common case) has no meaningful position on the scrub timeline at all:
  // there's no GPS data for that moment to place a pin at. Rather than force it onto the 0-100%
  // scrub axis (which either mis-times it or, unclamped, renders it off the edge of the strip
  // entirely), these get their own two edge buckets — same click-to-pick-one interaction as an
  // in-range cluster, just outside the scrubbable range instead of faking a position within it.
  const timelineBeforeItems =
    trackStartMs !== null
      ? timelineItems.filter((item) => item.ms < trackStartMs).sort((a, b) => a.ms - b.ms)
      : []
  const timelineAfterItems =
    trackEndMs !== null
      ? timelineItems.filter((item) => item.ms > trackEndMs).sort((a, b) => a.ms - b.ms)
      : []
  const timelineInRangeItems =
    trackStartMs !== null && trackEndMs !== null
      ? timelineItems.filter((item) => item.ms >= trackStartMs && item.ms <= trackEndMs)
      : []
  const timelineClusters: TimelineCluster[] =
    trackStartMs !== null && trackEndMs !== null
      ? clusterTimelineItems(timelineInRangeItems, trackStartMs, trackEndMs)
      : []

  // Shared by the in-range cluster picker and the before/after edge-bucket pickers — all three
  // are "a list of items, click one to select it" with identical row formatting.
  const renderTimelinePickerItems = (items: TimelineItem[]): React.JSX.Element[] =>
    items.map((item) => (
      <button
        key={`${item.kind}-${item.id}`}
        type="button"
        onClick={() => {
          setOpenTimelinePicker(null)
          setSelectedItem({ kind: item.kind, id: item.id })
        }}
      >
        {new Date(item.ms).toLocaleTimeString()} &mdash; {TIMELINE_ITEM_KIND_LABEL[item.kind]}
        {item.kind === 'photo' ? '' : `: ${timelineItemSummary(item, messages)}`}
      </button>
    ))

  // The selected photo's own loading/error/image state, shared between the two places it can be
  // shown: the map-covering overlay (a track with GPS points) and the plain side panel (a
  // zero-point track, which has no map for that overlay to sit over) — see mapDataConfirmedEmpty
  // below. Kept as one JSX fragment so those two never drift out of sync with each other.
  const selectedPhotoBody = (
    <>
      {photoDataLoading && <p className="empty">Loading photo…</p>}
      {photoDataError && <p className="error">{photoDataError}</p>}
      {!photoDataLoading && photoDataUri && (
        <img className="photo-map-overlay-photo" src={photoDataUri} alt="" />
      )}
    </>
  )

  return (
    <div className="track-detail-layout">
      <div className="track-detail">
        <div className="track-detail-header">
          <button type="button" className="back-link" onClick={onBack}>
            &larr; Back to tracks
          </button>
          <div className="track-detail-header-actions">
            <div className="dropdown-menu" ref={addDataMenuRef}>
              <button
                type="button"
                onClick={() => setShowAddDataMenu((v) => !v)}
                disabled={
                  importingPhotos ||
                  !!pendingOffsetImport ||
                  importingMessages ||
                  startingPhoneUpload
                }
              >
                {importingPhotos
                  ? 'Importing photos…'
                  : importingMessages
                    ? 'Importing…'
                    : startingPhoneUpload
                      ? 'Starting…'
                      : 'Add data ▾'}
              </button>
              {showAddDataMenu && (
                <div className="dropdown-menu-options dropdown-menu-options-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDataMenu(false)
                      journalPreviewRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center'
                      })
                      handleStartEditingJournal()
                    }}
                  >
                    Jump to journal entry
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDataMenu(false)
                      handleImportPhotos()
                    }}
                  >
                    Import photos…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDataMenu(false)
                      handleImportMessages()
                    }}
                  >
                    Import messages (CSV)…
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDataMenu(false)
                      handleStartPhoneUpload()
                    }}
                    disabled={!!phoneUploadSession}
                  >
                    Upload photos from phone…
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="track-header-info">
          <h1 className="track-title">
            <EditableField
              value={track.name}
              placeholder="Track name"
              onSave={handleSaveName}
              required
              inputClassName="track-title-input"
            />
          </h1>
          <p className="track-date">{formatTrackDate(track.date)}</p>
          {(previousTrack || nextTrack) && (
            <div className="track-day-nav">
              {previousTrack && (
                <button
                  type="button"
                  className="track-day-nav-button"
                  onClick={() => onOpenTrack(previousTrack.id)}
                >
                  &larr; {formatTrackDate(previousTrack.date)}
                </button>
              )}
              {nextTrack && (
                <button
                  type="button"
                  className="track-day-nav-button track-day-nav-button-next"
                  onClick={() => onOpenTrack(nextTrack.id)}
                >
                  {formatTrackDate(nextTrack.date)} &rarr;
                </button>
              )}
            </div>
          )}

          <dl className="track-stats">
            <div className="track-stat">
              <dt className="track-stat-label">Start location</dt>
              <dd className="track-stat-value">
                <EditableField
                  value={track.startLocation ?? ''}
                  placeholder="Add start location"
                  onSave={handleSaveStartLocation}
                  inputClassName="track-stat-value-input"
                />
              </dd>
            </div>
            <div className="track-stat">
              <dt className="track-stat-label">End location</dt>
              <dd className="track-stat-value">
                <EditableField
                  value={track.endLocation ?? ''}
                  placeholder="Add end location"
                  onSave={handleSaveEndLocation}
                  inputClassName="track-stat-value-input"
                />
              </dd>
            </div>
            {trackStats && (
              <div className="track-stat">
                <dt className="track-stat-label">Distance</dt>
                <dd className="track-stat-value">{trackStats.distanceMiles.toFixed(1)} mi</dd>
              </div>
            )}
            {trackStartMs !== null && (
              <div className="track-stat">
                <dt className="track-stat-label">Start</dt>
                <dd className="track-stat-value">{formatClockTime(trackStartMs)}</dd>
              </div>
            )}
            {trackEndMs !== null && (
              <div className="track-stat">
                <dt className="track-stat-label">End</dt>
                <dd className="track-stat-value">{formatClockTime(trackEndMs)}</dd>
              </div>
            )}
            {trackStats !== null && trackStats.elevationGainFeet !== null && (
              <div className="track-stat">
                <dt className="track-stat-label">Elevation gain</dt>
                <dd className="track-stat-value">
                  {Math.round(trackStats.elevationGainFeet).toLocaleString()} ft
                </dd>
              </div>
            )}
          </dl>
        </div>

        {phoneUploadSession && (
          <div className="phone-upload-panel">
            <img
              className="phone-upload-qr"
              src={phoneUploadSession.qrDataUri}
              alt="QR code linking to the phone upload page"
            />
            <div className="phone-upload-info">
              <p>
                On your phone, scan this code or open{' '}
                <span className="mono-inline">{phoneUploadSession.url}</span> while it&apos;s on the
                same wifi network (or tethered to this computer&apos;s hotspot).
              </p>
              <p className="phone-upload-hint">Photos you send there appear here automatically.</p>
              <button type="button" onClick={handleStopPhoneUpload}>
                Stop phone upload
              </button>
            </div>
          </div>
        )}
        {phoneUploadError && <p className="error">{phoneUploadError}</p>}

        {pendingOffsetImport?.suggestedTrack && (
          <div className="offset-suggestion">
            <p>
              These photos look like a much better fit for{' '}
              <strong>{pendingOffsetImport.suggestedTrack.name}</strong> (
              {formatTrackDate(pendingOffsetImport.suggestedTrack.date)}) — only{' '}
              {formatOffset(pendingOffsetImport.suggestedTrack.offsetMinutes)} off there, versus{' '}
              {formatOffset(pendingOffsetImport.proposedOffsetMinutes)} here. Did you mean to import
              them onto that day instead?
            </p>
            <button type="button" onClick={handleGoToSuggestedTrack}>
              Go to {pendingOffsetImport.suggestedTrack.name} instead
            </button>
          </div>
        )}

        {pendingOffsetImport && (
          <form className="offset-prompt" onSubmit={handleConfirmOffset}>
            <label htmlFor="offset-prompt-input">
              These photos&apos; timestamps look{' '}
              {formatOffset(pendingOffsetImport.proposedOffsetMinutes)} from the track&apos;s clock
              — apply this correction before placing them?
            </label>
            <div className="offset-prompt-controls">
              <input
                id="offset-prompt-input"
                type="number"
                step={1}
                className="offset-prompt-input"
                value={offsetInput}
                onChange={(e) => setOffsetInput(e.target.value)}
                aria-label="Offset in minutes"
                required
                autoFocus
              />
              <span className="offset-prompt-unit">
                minutes ({formatOffset(Number(offsetInput) || 0)})
              </span>
              <button type="submit" disabled={importingPhotos}>
                {importingPhotos ? 'Importing…' : 'Confirm'}
              </button>
              <button type="button" onClick={handleCancelOffset} disabled={importingPhotos}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && <p className="error">{error}</p>}
        {photoError && <p className="error">{photoError}</p>}
        {photoDuplicatesSkipped > 0 && (
          <p className="duplicates-notice">
            Skipped {photoDuplicatesSkipped} photo{photoDuplicatesSkipped === 1 ? '' : 's'} already
            in this track.
          </p>
        )}
        {messageError && <p className="error">{messageError}</p>}

        {/* A zero-point track (e.g. a zero day) has no map at all — hidden via a class, not
            unmounted, so mapContainerRef stays valid across every render (see the map-building
            effect above, which itself skips ever creating a Leaflet map here in that case). */}
        <div
          className={`track-map-wrapper${mapDataConfirmedEmpty ? ' track-map-wrapper-hidden' : ''}`}
        >
          <div className="track-map" ref={mapContainerRef} />
          {selectedPhoto && !mapDataConfirmedEmpty && (
            <div className="photo-map-overlay">
              <div className="photo-map-overlay-header">
                <h2>{formatPhotoTitle(selectedPhoto)}</h2>
                <button
                  type="button"
                  className="side-panel-close"
                  onClick={() => setSelectedItem(null)}
                  aria-label="Close photo"
                >
                  &times;
                </button>
              </div>
              {selectedPhotoBody}
            </div>
          )}
        </div>

        <div className="journal-preview" ref={journalPreviewRef}>
          <div className="journal-preview-header">
            <h2>Journal entry</h2>
            {journalEditing ? (
              <div className="journal-preview-header-actions">
                <span className={`journal-status journal-status-${journalStatus}`}>
                  {journalStatus === 'unsaved' && 'Unsaved changes…'}
                  {journalStatus === 'saving' && 'Saving…'}
                  {journalStatus === 'saved' && 'Saved'}
                  {journalStatus === 'error' && `Couldn't save: ${journalError}`}
                </span>
                <button type="button" onClick={handleDoneEditingJournal}>
                  Done
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartEditingJournal}
                disabled={journalStatus === 'loading'}
              >
                {journalText.trim() === '' ? 'Write journal entry' : 'Edit'}
              </button>
            )}
          </div>
          {journalEditing ? (
            <textarea
              ref={journalTextareaRef}
              className="journal-textarea"
              value={journalText}
              onChange={handleJournalChange}
              placeholder="Write about this day on the trail…"
            />
          ) : journalText.trim() === '' ? (
            <p className="journal-preview-empty">No journal entry written for this day yet.</p>
          ) : (
            journalParagraphs(journalText).map((paragraph, index) => (
              <p key={index} className="journal-preview-text">
                {paragraph}
              </p>
            ))
          )}
        </div>

        <PhotoGallery
          photos={photos}
          onOpenPhoto={(photoId) => setSelectedItem({ kind: 'photo', id: photoId })}
          onCaptionSaved={(updated) =>
            setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
          }
        />

        {isTimed && trackStartMs !== null && trackEndMs !== null && scrubMs !== null && (
          <div className="timeline">
            <div className="timeline-track-row">
              {timelineBeforeItems.length > 0 && (
                <div
                  className="dropdown-menu timeline-edge-bucket"
                  ref={openTimelinePicker === 'before' ? openTimelinePickerRef : undefined}
                >
                  <button
                    type="button"
                    className="timeline-edge-bucket-button"
                    aria-label={`${timelineBeforeItems.length} item${timelineBeforeItems.length === 1 ? '' : 's'} from before this track started recording — click to pick one`}
                    onClick={() =>
                      setOpenTimelinePicker(openTimelinePicker === 'before' ? null : 'before')
                    }
                  >
                    &#8249; {timelineBeforeItems.length}
                    <span className="timeline-tooltip">
                      {timelineBeforeItems.length} photos taken before track recording started
                    </span>
                  </button>
                  {openTimelinePicker === 'before' && (
                    <div className="dropdown-menu-options timeline-cluster-options">
                      {renderTimelinePickerItems(timelineBeforeItems)}
                    </div>
                  )}
                </div>
              )}

              <div className="timeline-track">
                <input
                  className="timeline-slider"
                  type="range"
                  min={trackStartMs}
                  max={trackEndMs}
                  step={1000}
                  value={scrubMs}
                  onChange={handleScrub}
                />
                <div className="timeline-markers">
                  {timelineClusters.map((cluster, index) => {
                    if (cluster.items.length === 1) {
                      const item = cluster.items[0]
                      const summary = timelineItemSummary(item, messages)
                      const time = new Date(item.ms).toLocaleTimeString()
                      return (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          className={`timeline-marker timeline-marker-${item.kind}`}
                          style={{ left: timelineMarkerLeft(cluster.percent) }}
                          aria-label={
                            item.kind === 'photo'
                              ? `Photo at ${time}`
                              : `${TIMELINE_ITEM_KIND_LABEL[item.kind]} at ${time}: ${summary}`
                          }
                          onClick={() => setSelectedItem({ kind: item.kind, id: item.id })}
                        >
                          <span className="timeline-tooltip">
                            {item.kind === 'photo' ? time : summary}
                          </span>
                        </button>
                      )
                    }

                    const isOpen = openTimelinePicker === index
                    return (
                      <div
                        key={`cluster-${index}`}
                        className="dropdown-menu timeline-marker-cluster-wrap"
                        style={{ left: timelineMarkerLeft(cluster.percent) }}
                        ref={isOpen ? openTimelinePickerRef : undefined}
                      >
                        <button
                          type="button"
                          className="timeline-marker-cluster"
                          aria-label={`${cluster.items.length} items around ${new Date(cluster.items[0].ms).toLocaleTimeString()} — click to pick one`}
                          onClick={() => setOpenTimelinePicker(isOpen ? null : index)}
                        >
                          {cluster.items.length}
                          <span className="timeline-tooltip">{cluster.items.length} photos</span>
                        </button>
                        {isOpen && (
                          <div className="dropdown-menu-options timeline-cluster-options">
                            {renderTimelinePickerItems(cluster.items)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {timelineAfterItems.length > 0 && (
                <div
                  className="dropdown-menu timeline-edge-bucket"
                  ref={openTimelinePicker === 'after' ? openTimelinePickerRef : undefined}
                >
                  <button
                    type="button"
                    className="timeline-edge-bucket-button"
                    aria-label={`${timelineAfterItems.length} item${timelineAfterItems.length === 1 ? '' : 's'} from after this track stopped recording — click to pick one`}
                    onClick={() =>
                      setOpenTimelinePicker(openTimelinePicker === 'after' ? null : 'after')
                    }
                  >
                    {timelineAfterItems.length} &#8250;
                    <span className="timeline-tooltip">
                      {timelineAfterItems.length} photos taken after track recording ended
                    </span>
                  </button>
                  {openTimelinePicker === 'after' && (
                    <div className="dropdown-menu-options dropdown-menu-options-end timeline-cluster-options">
                      {renderTimelinePickerItems(timelineAfterItems)}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="timeline-status">
              <span>{new Date(scrubMs).toLocaleTimeString()}</span>
              {scrubStatus === 'gap' && (
                <span className="timeline-gap-notice">No track data here (recording gap)</span>
              )}
            </div>
          </div>
        )}

        {/* A timeless track has no timeline to place a dot on, so its messages are listed plainly
            instead (still clickable, still on the map). */}
        {!isTimed && messages.length > 0 && (
          <ul className="message-list">
            {messages.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  className="message-list-item"
                  onClick={() => setSelectedItem({ kind: 'message', id: message.id })}
                >
                  {message.content || '(no message text)'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="track-delete-row">
          <button
            type="button"
            className="track-delete-button"
            onClick={handleDeleteTrack}
            disabled={deletingTrack}
          >
            {deletingTrack ? 'Deleting…' : 'Delete track'}
          </button>
          {deleteError && <p className="error">{deleteError}</p>}
        </div>
      </div>

      {/* A zero-point track has no map for the usual photo-map-overlay to cover, so an expanded
          photo uses the same plain side panel as a message instead. */}
      {selectedPhoto && mapDataConfirmedEmpty && (
        <SidePanel title={formatPhotoTitle(selectedPhoto)} onClose={() => setSelectedItem(null)}>
          {selectedPhotoBody}
        </SidePanel>
      )}

      {selectedMessage && (
        <SidePanel
          title={formatMessageTitle(selectedMessage)}
          onClose={() => setSelectedItem(null)}
        >
          <p>{selectedMessage.content || '(no message text)'}</p>
          <p className="message-location">
            {selectedMessage.lat.toFixed(5)}, {selectedMessage.lng.toFixed(5)}
          </p>
        </SidePanel>
      )}
    </div>
  )
}

export default TrackDetail
