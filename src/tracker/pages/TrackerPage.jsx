// Phase 10 — /tracker: the vehicle book, one row per chassis.
// Lazy-loaded (App.jsx), so Univer's ~3 MB is downloaded only by people who open this page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TrackerGrid from '../components/TrackerGrid'
import { ALL_COLUMNS } from '../lib/columnMeta'
import { listAll } from '../lib/trackerApi'
import { todayIst, withScreenColumns } from '../lib/screenColumns'
import '../tracker.css'

const STORED_KEYS = ALL_COLUMNS.filter((c) => !c.screen).map((c) => c.key)

export default function TrackerPage() {
  const [state, setState] = useState({ status: 'loading' })
  const [notice, setNotice] = useState(null)
  const grid = useRef(null)
  const noticeTimer = useRef(null)

  const say = useCallback((text, tone = 'info') => {
    setNotice({ text, tone })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6000)
  }, [])

  useEffect(() => {
    let cancelled = false
    listAll(STORED_KEYS)
      .then(({ rows, hidden }) => {
        if (cancelled) return
        const hide = new Set(hidden)
        // DSE incentive is worked out on screen from the same figures — hidden with them
        if (hide.size) hide.add('dse_incentive')
        const columns = ALL_COLUMNS.filter((c) => !hide.has(c.key))
        setState({ status: 'ready', columns, rows: withScreenColumns(rows, todayIst()) })
      })
      .catch((e) => !cancelled && setState({ status: 'error', message: e.message }))
    return () => { cancelled = true }
  }, [])

  // Slice 1: the book is shown but not yet saved — every change is put back.
  const onChanges = useCallback((cells) => {
    const { columns, rows } = state
    if (import.meta.env.DEV) console.debug('[tracker] changes', JSON.stringify(cells.slice(0, 20)))
    const byId = new Map(rows.map((r) => [r.id, r]))
    const back = cells
      .filter((c) => c.row >= 1 && c.col < columns.length && c.id)
      .map((c) => ({ id: c.id, key: columns[c.col].key, value: byId.get(c.id)?.[columns[c.col].key] ?? null }))
    queueMicrotask(() => grid.current?.setValues(back))
    say('Editing is switched off for now — saving is being built.')
  }, [state, say])

  const count = state.status === 'ready' ? state.rows.length : 0
  const columns = useMemo(() => (state.status === 'ready' ? state.columns : []), [state])
  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])

  return (
    <div className="trk-page">
      <div className="trk-head">
        <h1 className="trk-title">Vehicle Tracker<span className="period-accent">.</span></h1>
        {state.status === 'ready' && <span className="trk-count">{count.toLocaleString('en-IN')} vehicles</span>}
        {notice && <span className={`trk-notice trk-notice--${notice.tone}`} role="status">{notice.text}</span>}
      </div>
      <div className="trk-phone-note">The tracker opens on a computer. A phone view comes later.</div>
      {state.status === 'loading' && <div className="trk-loading"><span className="spinner" /> Loading the book…</div>}
      {state.status === 'error' && <div className="trk-error" role="alert">Could not load the book: {state.message}</div>}
      {state.status === 'ready' && (
        <TrackerGrid ref={grid} columns={columns} rows={rows} onChanges={onChanges} onRefused={(m) => say(m)} />
      )}
    </div>
  )
}
