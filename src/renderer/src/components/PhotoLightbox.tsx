import type { Photo } from '../../../shared/types'

interface PhotoLightboxProps {
  photo: Photo
  dataUri: string | null
  loading: boolean
  error: string
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
}

// A full-screen viewer for photos opened from the gallery grid, independent of the map/timeline's
// own "selected photo" overlay (which pans and re-centers the map — the right behavior for a map
// pin click, not for browsing the gallery). Clicking the backdrop closes it; clicking the image or
// caption doesn't, via stopPropagation on the inner content wrapper.
function PhotoLightbox({
  photo,
  dataUri,
  loading,
  error,
  onClose,
  onPrev,
  onNext
}: PhotoLightboxProps): React.JSX.Element {
  return (
    <div className="photo-lightbox" onClick={onClose}>
      <button
        type="button"
        className="photo-lightbox-close"
        onClick={onClose}
        aria-label="Close photo"
      >
        &times;
      </button>
      {onPrev && (
        <button
          type="button"
          className="photo-lightbox-nav photo-lightbox-prev"
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          aria-label="Previous photo"
        >
          &larr;
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="photo-lightbox-nav photo-lightbox-next"
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          aria-label="Next photo"
        >
          &rarr;
        </button>
      )}
      <div className="photo-lightbox-content" onClick={(e) => e.stopPropagation()}>
        {loading && <p className="empty">Loading photo…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && dataUri && <img className="photo-lightbox-image" src={dataUri} alt="" />}
        {photo.caption && <p className="photo-lightbox-caption">{photo.caption}</p>}
      </div>
    </div>
  )
}

export default PhotoLightbox
