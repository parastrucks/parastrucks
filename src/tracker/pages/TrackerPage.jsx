// Phase 10 — /tracker: the vehicle book, one row per chassis.
// Lazy-loaded (App.jsx), so Univer's ~3 MB is downloaded only by people who open this page.
//
// SAVING (adapter duty 8): the grid reports what changed; savePlan decides what to save, refuse or
// put back; saves go out ONE AT A TIME, in order, each with its own request id, so a retry after a
// dropped connection replays instead of applying twice. The server's reply is the truth: recomputed
// figures go into the grid, a conflict shows the other person's value, a refused save puts the
// old values back (a save is all-or-nothing, so nothing of it was kept).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TrackerGrid from '../components/TrackerGrid'
import { ALL_COLUMNS, COLUMN_BY_KEY } from '../lib/columnMeta'
import { applyChanges, listAll } from '../lib/trackerApi'
import { chunk, planSave, refusalMessage } from '../lib/savePlan'
import { todayIst, withScreenColumns } from '../lib/screenColumns'
import '../tracker.css'

const STORED_KEYS = ALL_COLUMNS.filter((c) => !c.screen).map((c) => c.key)
const RETRY_MS = [1000, 3000, 8000]
const SLAB_INPUTS = new Set(['dse', 'date_of_retail'])

export default function TrackerPage() {
  const [state, setState] = useState({ status: 'loading' })
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState({ waiting: 0, failed: false })
  const grid = useRef(null)
  const noticeTimer = useRef(null)
  const shadow = useRef(new Map()) // id → row as the database last confirmed it (+ screen columns)
  const queue = useRef([])         // saves not yet confirmed, oldest first
  const busy = useRef(false)
  const buffer = useRef({ cells: [], source: 'typed', timer: null })

  const say = useCallback((text, tone = 'info', sticky = false) => {
    setNotice({ text, tone })
    clearTimeout(noticeTimer.current)
    if (!sticky) noticeTimer.current = setTimeout(() => setNotice(null), 7000)
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
        const full = withScreenColumns(rows, todayIst())
        shadow.current = new Map(full.map((r) => [r.id, { ...r }]))
        setState({ status: 'ready', columns, rows: full })
      })
      .catch((e) => !cancelled && setState({ status: 'error', message: e.message }))
    return () => { cancelled = true }
  }, [])

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const onLeave = (e) => { if (queue.current.length) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  const visibleKeys = useMemo(() => (state.status === 'ready' ? state.columns.map((c) => c.key) : []), [state])

  // The server's rows are the truth: take them, rework the screen columns, show what moved.
  const takeRows = useCallback((rows, touchedSlab) => {
    const today = todayIst()
    const out = []
    for (const fresh of rows) {
      const cur = shadow.current.get(fresh.id) ?? {}
      const merged = { ...cur, ...fresh }
      const [withScreen] = withScreenColumns([merged], today) // ageing + interest (the slab is redone below)
      withScreen.dse_incentive = cur.dse_incentive ?? null
      for (const key of visibleKeys) {
        if (key === 'dse_incentive') continue
        if (withScreen[key] !== cur[key]) out.push({ id: fresh.id, key, value: withScreen[key] })
      }
      shadow.current.set(fresh.id, withScreen)
    }
    if (touchedSlab && visibleKeys.includes('dse_incentive')) {
      const all = withScreenColumns([...shadow.current.values()], today)
      for (const r of all) {
        const cur = shadow.current.get(r.id)
        if (cur.dse_incentive !== r.dse_incentive) {
          cur.dse_incentive = r.dse_incentive
          out.push({ id: r.id, key: 'dse_incentive', value: r.dse_incentive })
        }
      }
    }
    grid.current?.setValues(out)
  }, [visibleKeys])

  const pump = useCallback(async () => {
    if (busy.current || !queue.current.length) return
    busy.current = true
    const item = queue.current[0]
    setSaving({ waiting: queue.current.reduce((n, q) => n + q.changes.length, 0), failed: false })
    try {
      const r = await applyChanges({
        client_request_id: item.requestId, batch_id: item.batchId, source: item.source, changes: item.changes,
      })
      queue.current.shift()
      if (r.ok) {
        takeRows(r.rows ?? [], item.changes.some((c) => SLAB_INPUTS.has(c.column)))
      } else {
        // all-or-nothing: none of this save was kept. Conflicts show what is there now; the rest
        // goes back to what it was.
        const actual = new Map((r.conflicts ?? []).map((c) => [`${c.unit_id}|${c.column}`, c.actual]))
        const back = item.changes.map((c) => {
          const k = `${c.unit_id}|${c.column}`
          const value = actual.has(k) ? actual.get(k) : c.before
          const row = shadow.current.get(c.unit_id)
          if (row) row[c.column] = value
          return { id: c.unit_id, key: c.column, value }
        })
        grid.current?.setValues(back)
        if (r.conflicts?.length) {
          const c = r.conflicts[0]
          say(`${COLUMN_BY_KEY[c.column]?.label ?? c.column} was changed by someone else meanwhile — it now shows their value.` +
            (item.changes.length > 1 ? ` Nothing from that ${item.source} was saved.` : ''), 'warn', true)
        } else if (r.rejected?.length) {
          say(refusalMessage(r.rejected.map((x) => ({ label: COLUMN_BY_KEY[x.column]?.label ?? x.column, reason: x.reason }))), 'warn', true)
        }
      }
      busy.current = false
      setSaving({ waiting: queue.current.reduce((n, q) => n + q.changes.length, 0), failed: false })
      pump()
    } catch (e) {
      busy.current = false
      item.attempts = (item.attempts ?? 0) + 1
      console.warn(`[tracker] save attempt ${item.attempts} failed: ${e.message}`)
      if (item.attempts <= RETRY_MS.length) {
        // the same request id: if the first try did reach the server, this replays it
        setTimeout(pump, RETRY_MS[item.attempts - 1])
      } else {
        setSaving({ waiting: queue.current.reduce((n, q) => n + q.changes.length, 0), failed: true })
        say(`Not saved: ${e.message}. Your changes are kept on this page — press Retry.`, 'error', true)
      }
    }
  }, [say, takeRows])

  const flush = useCallback(() => {
    const { cells, source } = buffer.current
    buffer.current = { cells: [], source: 'typed', timer: null }
    const { changes, putBack, refused } = planSave(cells, COLUMN_BY_KEY, shadow.current)
    grid.current?.setValues(putBack)
    if (refused.length) say(refusalMessage(refused), 'warn')
    if (!changes.length) return
    // what the person now sees is what the next edit's before-value must be
    for (const c of changes) shadow.current.get(c.unit_id)[c.column] = c.after
    for (const piece of chunk(changes)) {
      queue.current.push({ requestId: crypto.randomUUID(), batchId: crypto.randomUUID(), source, changes: piece })
    }
    pump()
  }, [pump, say])

  // One user action can arrive as several reports (a fill blanks, then writes): gather them and
  // decide once, after the action has finished.
  const onChanges = useCallback((cells, source) => {
    buffer.current.cells.push(...cells)
    buffer.current.source = source
    if (!buffer.current.timer) buffer.current.timer = setTimeout(flush, 0)
  }, [flush])

  const retry = useCallback(() => {
    for (const q of queue.current) q.attempts = 0
    setNotice(null)
    pump()
  }, [pump])

  const count = state.status === 'ready' ? state.rows.length : 0
  const columns = useMemo(() => (state.status === 'ready' ? state.columns : []), [state])
  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])

  return (
    <div className="trk-page">
      <div className="trk-head">
        <h1 className="trk-title">Vehicle Tracker<span className="period-accent">.</span></h1>
        {state.status === 'ready' && <span className="trk-count">{count.toLocaleString('en-IN')} vehicles</span>}
        {state.status === 'ready' && (
          <span className={`trk-save ${saving.failed ? 'trk-save--failed' : ''}`} role="status">
            {saving.failed ? `${saving.waiting} change${saving.waiting === 1 ? '' : 's'} not saved`
              : saving.waiting ? 'Saving…' : 'All changes saved'}
            {saving.failed && <button type="button" className="btn btn-sm btn-secondary" onClick={retry}>Retry</button>}
          </span>
        )}
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
