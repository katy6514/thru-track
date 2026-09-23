import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Track } from '../../../shared/types'
import { cleanErrorMessage } from '../cleanErrorMessage'
import { formatTrackDate } from '../formatTrackDate'

interface JournalEditorProps {
  track: Track
  onBack: () => void
}

type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'error'

// Debounce autosave: save AUTOSAVE_DELAY_MS after the user stops typing, rather than requiring
// an explicit "Save" click. Journal entries are written trailside on unreliable devices/batteries
// where a hiker may close the app mid-thought — autosave means there's no "did I remember to
// save?" step, and a keystroke is never at risk of being lost to a forgotten click. We back this
// up with a best-effort flush on unmount (navigating away) so edits aren't stranded in the
// debounce window either.
const AUTOSAVE_DELAY_MS = 800

function JournalEditor({ track, onBack }: JournalEditorProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState('')

  const textRef = useRef('')
  const savedTextRef = useRef('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError('')

    window.api.entries.get(track.id).then(
      (entry) => {
        if (cancelled) return
        const initialText = entry?.text ?? ''
        setText(initialText)
        textRef.current = initialText
        savedTextRef.current = initialText
        setStatus('saved')
      },
      (err) => {
        if (cancelled) return
        setError(cleanErrorMessage(err))
        setStatus('error')
      }
    )

    return () => {
      cancelled = true
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      // Best-effort flush of any unsaved edits when navigating away before the debounce fires.
      if (textRef.current !== savedTextRef.current) {
        void window.api.entries.save(track.id, textRef.current)
      }
    }
  }, [track.id])

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    setText(value)
    setStatus('unsaved')

    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      void (async (): Promise<void> => {
        setStatus('saving')
        setError('')
        try {
          await window.api.entries.save(track.id, value)
          savedTextRef.current = value
          setStatus('saved')
        } catch (err) {
          setError(cleanErrorMessage(err))
          setStatus('error')
        }
      })()
    }, AUTOSAVE_DELAY_MS)
  }

  return (
    <div className="journal-editor">
      <button type="button" className="back-link" onClick={onBack}>
        &larr; Back to map
      </button>

      <h1>{track.name}</h1>
      <p className="track-date">{formatTrackDate(track.date)}</p>

      <textarea
        className="journal-textarea"
        value={text}
        onChange={handleChange}
        disabled={status === 'loading'}
        placeholder="Write about this day on the trail…"
      />

      <p className={`journal-status journal-status-${status}`}>
        {status === 'loading' && 'Loading…'}
        {status === 'unsaved' && 'Unsaved changes…'}
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && `Couldn't save: ${error}`}
      </p>
    </div>
  )
}

export default JournalEditor
