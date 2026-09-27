import { useEffect, useMemo, useState } from 'react'
import type { Photo } from '../../../shared/types'
import { orderPhotosChronologically } from '../../../shared/orderPhotos'

interface PhotoGalleryProps {
  photos: Photo[]
  // Opens the full-size expanded view (the map overlay, or a side panel on a zero-point track) —
  // the gallery itself is just a browsing/captioning surface, not a second place photos expand.
  onOpenPhoto: (photoId: number) => void
  // The parent owns the actual `photos` array (it's also what the map pins/timeline dots are
  // built from), so a caption edit is reported back up rather than this component keeping its
  // own separate copy that could drift from the parent's.
  onCaptionSaved: (photo: Photo) => void
}

// Every photo attached to the day, arranged as a grid with each photo's caption editable right
// underneath it — the main place to browse and caption a day's photos, replacing the old header
// slideshow. Every thumbnail is fetched once up front (see PhotoSlideshow, which used the same
// approach for the same reason: a day's photo count is small enough that this is simpler than
// fetching on demand per-thumbnail).
function PhotoGallery({
  photos,
  onOpenPhoto,
  onCaptionSaved
}: PhotoGalleryProps): React.JSX.Element | null {
  const orderedPhotos = useMemo(() => orderPhotosChronologically(photos), [photos])
  const [dataUriByPhotoId, setDataUriByPhotoId] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    let cancelled = false
    Promise.all(
      orderedPhotos.map((photo): Promise<[number, string]> =>
        window.api.photos.getDataUri(photo.id).then((uri) => [photo.id, uri])
      )
    ).then((entries) => {
      if (!cancelled) setDataUriByPhotoId((prev) => new Map([...prev, ...entries]))
    })
    return () => {
      cancelled = true
    }
  }, [orderedPhotos])

  if (orderedPhotos.length === 0) return null

  return (
    <div className="photo-gallery">
      <h2 className="photo-gallery-heading">Photos</h2>
      <div className="photo-gallery-grid">
        {orderedPhotos.map((photo) => (
          <PhotoGalleryItem
            key={photo.id}
            photo={photo}
            dataUri={dataUriByPhotoId.get(photo.id)}
            onOpen={() => onOpenPhoto(photo.id)}
            onCaptionSaved={onCaptionSaved}
          />
        ))}
      </div>
    </div>
  )
}

interface PhotoGalleryItemProps {
  photo: Photo
  dataUri: string | undefined
  onOpen: () => void
  onCaptionSaved: (photo: Photo) => void
}

function PhotoGalleryItem({
  photo,
  dataUri,
  onOpen,
  onCaptionSaved
}: PhotoGalleryItemProps): React.JSX.Element {
  // A local draft rather than editing photo.caption directly, so keystrokes don't round-trip
  // through the parent's photos array on every character — only saved (see handleBlur) once the
  // hiker actually moves on, same "type freely, save when you leave the field" shape as a normal
  // form. Re-synced from the photo's own caption if it changes from outside this field (e.g. the
  // same track's data reloading) — but only while not actively focused, so an in-progress edit is
  // never clobbered out from under the hiker typing it.
  const [captionDraft, setCaptionDraft] = useState(photo.caption ?? '')
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!focused) setCaptionDraft(photo.caption ?? '')
  }, [photo.caption, focused])

  const handleBlur = async (): Promise<void> => {
    setFocused(false)
    if (captionDraft.trim() === (photo.caption ?? '')) return
    setSaving(true)
    try {
      const updated = await window.api.photos.updateCaption(photo.id, captionDraft)
      onCaptionSaved(updated)
    } finally {
      setSaving(false)
    }
  }

  return (
    <figure className="photo-gallery-item">
      <button type="button" className="photo-gallery-thumb-button" onClick={onOpen}>
        {dataUri ? (
          <img className="photo-gallery-thumb" src={dataUri} alt="" />
        ) : (
          <div className="photo-gallery-thumb-placeholder" />
        )}
      </button>
      <input
        type="text"
        className="photo-gallery-caption-input"
        placeholder="Add a caption…"
        value={captionDraft}
        onChange={(e) => setCaptionDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        disabled={saving}
      />
    </figure>
  )
}

export default PhotoGallery
