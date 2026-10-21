// SPIKE ONLY — pieces shared by the two spreadsheet-ENGINE tabs (Univer, FortuneSheet).
import { useCallback, useState } from 'react'
import { COLUMNS } from './trackerData'

// Column indexes the user may not type into: the computed money columns.
export const LOCKED = new Set(COLUMNS.flatMap((c, i) => (c.computed ? [i] : [])))

// Turn an engine's command name into what the person actually did.
export function sourceOf(cmd = '') {
  const c = cmd.toLowerCase()
  if (c.includes('undo')) return 'undo'
  if (c.includes('redo')) return 'redo'
  if (c.includes('paste')) return 'paste'
  if (c.includes('fill')) return 'fill'
  if (c.includes('clear') || c.includes('delete') || c.includes('remove')) return 'delete'
  return 'typed'
}

// The engines report WHICH cells changed; the "before" value comes from our own copy of the
// rows — in the real build that copy is the database. This compares the two and returns only
// real changes, plus any attempt on a locked column (to be put back).
export function diffAgainst(shadow, cells) {
  const changes = [], reverts = []
  for (const { r, c, value } of cells) {
    if (r < 1 || r > shadow.length || c < 0 || c >= COLUMNS.length) continue // row 0 is the header
    const key = COLUMNS[c].key
    const row = shadow[r - 1]
    const before = row[key]
    const after = value === null || value === undefined ? '' : value
    if (String(before ?? '') === String(after)) continue
    if (LOCKED.has(c)) { reverts.push({ r, c, before }); continue }
    row[key] = after
    changes.push({ rowId: row.id, colId: key, before, after })
  }
  return { changes, reverts }
}

// The visible proof that every kind of edit reaches us: a running count per source and the
// last few changes, with old → new values. If paste, fill or undo never appear here, the
// engine does not report them — and in the real build those edits would never reach the database.
export function useCaptureLog() {
  const [log, setLog] = useState({ total: 0, bySource: {}, recent: [], blocked: 0 })
  const record = useCallback((changes, source) => {
    if (!changes.length) return
    setLog(l => ({
      total: l.total + changes.length,
      bySource: { ...l.bySource, [source]: (l.bySource[source] || 0) + changes.length },
      recent: [...changes.slice(-3).reverse().map(ch => ({ ...ch, source })), ...l.recent].slice(0, 3),
      blocked: l.blocked,
    }))
  }, [])
  const blocked = useCallback(n => setLog(l => ({ ...l, blocked: l.blocked + n })), [])
  return { log, record, blocked }
}

const show = v => (v === '' || v == null ? '∅' : String(v).slice(0, 18))

export function CaptureBar({ log, label, extra }) {
  const sources = ['typed', 'paste', 'fill', 'undo', 'redo', 'undo/redo', 'delete']
  return (
    <div className="cap-bar">
      <span className="cap-title">{label} — edits captured: <b>{log.total}</b></span>
      {sources.map(s => (
        <span key={s} className="cap-chip" data-on={!!log.bySource[s]}>{s} {log.bySource[s] || 0}</span>
      ))}
      {log.blocked > 0 && <span className="cap-warn">locked column put back {log.blocked}×</span>}
      {log.recent.map((ch, i) => (
        <span key={i} className="cap-recent">
          row {ch.rowId} · {ch.colId}: {show(ch.before)} → <b>{show(ch.after)}</b> <i>({ch.source})</i>
        </span>
      ))}
      {extra}
    </div>
  )
}
