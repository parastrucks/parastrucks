import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import Icon from '../Icon'

/* "Create new" bottom sheet, opened by the raised (+) in the mobile dock.
   `actions` is already canAccess-filtered by the caller. */
export default function CreateSheet({ open, onClose, actions }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet-panel" onClick={e => e.stopPropagation()} role="dialog" aria-label="Create new">
        <div className="sheet-head">
          <span className="sheet-title">Create new</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
        </div>
        {actions.map(a => (
          <button key={a.to} type="button" className="sheet-row" onClick={() => { onClose(); navigate(a.to) }}>
            <span className="sheet-row-icon"><Icon name={a.icon} size={19} color="var(--ink)" /></span>
            <span className="sheet-row-text">
              <span className="sheet-row-label">{a.label}</span>
              <span className="sheet-row-desc">{a.desc}</span>
            </span>
            <Icon name="arrow-right" size={16} color="var(--text-muted)" />
          </button>
        ))}
      </div>
    </div>
  )
}
