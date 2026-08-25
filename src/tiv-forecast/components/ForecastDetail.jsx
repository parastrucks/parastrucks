// TIV Forecast — "where does this number come from", as a real dialog.
//
// On a desktop this reads as a receipt card under the table. On a phone the
// table scrolls sideways inside its own box, so a card rendered below it lands
// somewhere the reader never looks — they tap a number and, as far as they can
// tell, nothing happens. Same markup, but pinned to the bottom of the viewport
// under 720px (see .tiv-detail-sheet in index.css).
//
// Dialog behaviour rather than a styled div, because the trigger is now a real
// button: focus moves here on open so a keyboard user is not left at the top of
// a 168-cell grid, Escape closes it, and focus returns to the number that was
// tapped. aria-modal is deliberately NOT set — the page behind stays readable
// and usable, which is the point of a detail sheet rather than a modal.
import { useEffect, useRef } from 'react'

export default function ForecastDetail({ title, onClose, children }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    // Remember what had focus so it can be handed back on close. Without this,
    // dismissing the sheet drops the caret at the top of the document.
    const opener = document.activeElement
    el?.focus()

    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // Only if the opener is still in the document — after an upload the whole
      // table can be replaced, and focusing a detached node throws focus to
      // <body> silently.
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="tiv-receipt tiv-detail-sheet"
      role="dialog"
      aria-label={`How ${title} was worked out`}
      tabIndex={-1}
    >
      <button className="tiv-receipt-close" onClick={onClose} aria-label="Close">×</button>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}
