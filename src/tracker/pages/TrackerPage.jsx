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
import { applyChanges, createUnits, listAll } from '../lib/trackerApi'
import { chunk, MAX_NEW_ROWS, planNewRows, planSave, refusalMessage } from '../lib/savePlan'
import { todayIst, withScreenColumns } from '../lib/screenColumns'
import '../tracker.css'

const STORED_KEYS = ALL_COLUMNS.filter((c) => !c.screen).map((c) => c.key)
const RETRY_MS = [1000, 3000, 8000]
const SLAB_INPUTS = new Set(['dse', 'date_of_retail'])
// what is still waiting to be saved: cells for edits, rows for new vehicles
const waitingOf = (queue) => queue.reduce((n, q) => n + (q.kind === 'create' ? q.rows.length : q.changes.length), 0)

export default function TrackerPage() {
  const [state, setState] = useState({ status: 'loading' })
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState({ waiting: 0, failed: false })
  const [added, setAdded] = useState(0) // vehicles created since the book was loaded
  const grid = useRef(null)
  const noticeTimer = useRef(null)
  const shadow = useRef(new Map()) // id → row as the database last confirmed it (+ screen columns)
  const queue = useRef([])         // saves not yet confirmed, oldest first
  const busy = useRef(false)
  const buffer = useRef({ cells: [], fresh: [], source: 'typed', timer: null })
  const realId = useRef(new Map())  // temporary "new:…" id → the id the server gave it

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

  // The answer to a batch of new rows. A created row's real id replaces its temporary one in the
  // grid, the shadow and every save still waiting (edits typed while it was being created); a row
  // the server did not create (chassis already in the book) is emptied and named.
  const takeCreated = useCallback((item, r) => {
    const failed = []
    let made = 0, slab = false
    item.rows.forEach(({ temp, values }, i) => {
      const res = r.results?.[i]
      if (res?.ok) {
        realId.current.set(temp, res.id)
        grid.current?.retag(temp, res.id)
        const cur = shadow.current.get(temp) ?? {}
        shadow.current.delete(temp)
        shadow.current.set(res.id, { ...cur, id: res.id })
        for (const q of queue.current) for (const c of q.changes ?? []) if (c.unit_id === temp) c.unit_id = res.id
        if (res.row) takeRows([res.row], false)
        if (Object.keys(values).some((k) => SLAB_INPUTS.has(k))) slab = true
        made++
      } else {
        grid.current?.clearRow(temp)
        shadow.current.delete(temp)
        for (const q of queue.current) if (q.changes) q.changes = q.changes.filter((c) => c.unit_id !== temp)
        const why = res?.rejected?.[0]
        const reason = !why ? 'not created'
          : /already in the book/.test(why.reason) ? 'already in the book'
            : `${COLUMN_BY_KEY[why.column]?.label ?? why.column ?? 'a value'} — ${why.reason}`
        failed.push(`Chassis ${values.chassis_no}: ${reason}`)
      }
    })
    if (slab) takeRows([], true)
    if (made) { setAdded((n) => n + made); grid.current?.ensureSpare() }
    if (failed.length) {
      const more = failed.length - 1
      say(`${failed[0]}.` + (more ? ` (${more} more new row${more > 1 ? 's' : ''} not added.)` : '') +
        ` ${failed.length > 1 ? 'Those rows were' : 'That row was'} not added and ${failed.length > 1 ? 'have' : 'has'} been emptied.`, 'warn', true)
    }
  }, [say, takeRows])

  const pump = useCallback(async () => {
    if (busy.current || !queue.current.length) return
    const item = queue.current[0]
    // edits to a new row the server then refused were dropped from their save
    if (item.kind !== 'create' && !item.changes.length) { queue.current.shift(); pump(); return }
    busy.current = true
    setSaving({ waiting: waitingOf(queue.current), failed: false })
    try {
      if (item.kind === 'create') {
        const r = await createUnits({
          client_request_id: item.requestId, batch_id: item.batchId, rows: item.rows.map((x) => x.values),
        })
        queue.current.shift()
        takeCreated(item, r)
      } else {
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
      }
      busy.current = false
      setSaving({ waiting: waitingOf(queue.current), failed: false })
      pump()
    } catch (e) {
      busy.current = false
      item.attempts = (item.attempts ?? 0) + 1
      console.warn(`[tracker] save attempt ${item.attempts} failed: ${e.message}`)
      if (item.attempts <= RETRY_MS.length) {
        // the same request id: if the first try did reach the server, this replays it
        setTimeout(pump, RETRY_MS[item.attempts - 1])
      } else {
        setSaving({ waiting: waitingOf(queue.current), failed: true })
        say(`Not saved: ${e.message}. Your changes are kept on this page — press Retry.`, 'error', true)
      }
    }
  }, [say, takeRows, takeCreated])

  const flush = useCallback(() => {
    const { cells: reported, fresh, source } = buffer.current
    buffer.current = { cells: [], fresh: [], source: 'typed', timer: null }
    // a cell reported against a temporary id whose row has since been created belongs to the real one
    const cells = reported.map((c) => (realId.current.has(c.id) ? { ...c, id: realId.current.get(c.id) } : c))

    // new vehicles first: rows typed or pasted below the book
    if (fresh.length) {
      const plan = planNewRows(fresh, COLUMN_BY_KEY)
      grid.current?.clearAt(plan.clear)
      if (plan.refused.length) say(refusalMessage(plan.refused, ' Those cells were cleared.'), 'warn')
      if (plan.creates.length) {
        const rows = plan.creates.map(({ r, values, show }) => {
          const temp = `new:${crypto.randomUUID()}`
          shadow.current.set(temp, { id: temp, ...values })
          return { r, temp, values, show }
        })
        grid.current?.tagRows(rows.map(({ r, temp }) => ({ r, id: temp })))
        // converted values ("12,34,567" → the number) are shown as saved
        grid.current?.setValues(rows.flatMap(({ temp, show }) => show.map((x) => ({ id: temp, ...x }))))
        for (const piece of chunk(rows, MAX_NEW_ROWS)) {
          queue.current.push({ kind: 'create', requestId: crypto.randomUUID(), batchId: crypto.randomUUID(),
            rows: piece.map(({ temp, values }) => ({ temp, values })) })
        }
      }
    }

    const { changes, putBack, refused } = planSave(cells, COLUMN_BY_KEY, shadow.current)
    grid.current?.setValues(putBack)
    if (refused.length) say(refusalMessage(refused), 'warn')
    if (!changes.length) { pump(); return }
    // what the person now sees is what the next edit's before-value must be
    for (const c of changes) shadow.current.get(c.unit_id)[c.column] = c.after
    for (const piece of chunk(changes)) {
      queue.current.push({ requestId: crypto.randomUUID(), batchId: crypto.randomUUID(), source, changes: piece })
    }
    pump()
  }, [pump, say])

  // One user action can arrive as several reports (a fill blanks, then writes): gather them and
  // decide once, after the action has finished.
  const onChanges = useCallback((cells, source, fresh = []) => {
    buffer.current.cells.push(...cells)
    buffer.current.fresh.push(...fresh)
    buffer.current.source = source
    if (!buffer.current.timer) buffer.current.timer = setTimeout(flush, 0)
  }, [flush])

  const retry = useCallback(() => {
    for (const q of queue.current) q.attempts = 0
    setNotice(null)
    pump()
  }, [pump])

  const count = state.status === 'ready' ? state.rows.length + added : 0
  const columns = useMemo(() => (state.status === 'ready' ? state.columns : []), [state])
  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])

  return (
    <div className="trk-page">
      <div className="trk-head">
        <h1 className="trk-title">Vehicle Tracker<span className="period-accent">.</span></h1>
        {state.status === 'ready' && <span className="trk-count">{count.toLocaleString('en-IN')} vehicles</span>}
        {state.status === 'ready' && (
          <button type="button" className="btn btn-sm btn-secondary" title="Go to the first empty row — type the chassis number there"
            onClick={() => grid.current?.newVehicle()}>+ New vehicle</button>
        )}
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
