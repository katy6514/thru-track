import { useEffect, useMemo, useState } from 'react'
import type { Photo } from '../../../shared/types'

interface PhotoSlideshowProps {
  photos: Photo[]
}

// How long each photo stays fully visible before the next one starts fading in, and how long
// that crossfade itself takes — both deliberately slow/gentle, since this sits quietly beside the
// track's own title and stats rather than asking for attention.
const DWELL_MS = 4500
const FADE_MS = 1800

// A small, ambient photo slideshow for the track detail header — every photo attached to the
// day, crossfading through them slowly and on a loop. Every image is fetched once up front
// (a day's photo count is small enough that this is simpler and smoother than fetching on
// demand mid-fade) and then just stacked, with only the current one's opacity ever changing.
function PhotoSlideshow({ photos }: PhotoSlideshowProps): React.JSX.Element | null {
  // Chronological when every photo has a timestamp; a photo with none (no EXIF time at all)
  // sorts after the ones that do, rather than colliding at an arbitrary position among them.
  const orderedPhotos = useMemo(
    () =>
      [...photos].sort((a, b) => {
        if (a.timestamp === null) return b.timestamp === null ? 0 : 1
        if (b.timestamp === null) return -1
        return Date.parse(a.timestamp) - Date.parse(b.timestamp)
      }),
    [photos]
  )

  const [dataUriByPhotoId, setDataUriByPhotoId] = useState<Map<number, string>>(new Map())
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setDataUriByPhotoId(new Map())
    setIndex(0)
    Promise.all(
      orderedPhotos.map((photo): Promise<[number, string]> =>
        window.api.photos.getDataUri(photo.id).then((uri) => [photo.id, uri])
      )
    ).then((entries) => {
      if (!cancelled) setDataUriByPhotoId(new Map(entries))
    })
    return () => {
      cancelled = true
    }
  }, [orderedPhotos])

  useEffect(() => {
    if (orderedPhotos.length <= 1) return
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % orderedPhotos.length)
    }, DWELL_MS)
    return () => clearInterval(interval)
  }, [orderedPhotos.length])

  if (orderedPhotos.length === 0) return null

  return (
    <div className="track-photo-slideshow">
      {orderedPhotos.map((photo, i) => {
        const dataUri = dataUriByPhotoId.get(photo.id)
        if (!dataUri) return null
        return (
          <img
            key={photo.id}
            src={dataUri}
            alt=""
            className="track-photo-slideshow-image"
            style={{ opacity: i === index ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
          />
        )
      })}
    </div>
  )
}

export default PhotoSlideshow
