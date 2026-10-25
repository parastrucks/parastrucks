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
import TrackerTools from '../components/TrackerTools'
import { ALL_COLUMNS, COLUMN_BY_KEY } from '../lib/columnMeta'
import { addNote, applyChanges, createUnits, loadBook, setFormats } from '../lib/trackerApi'
import { sameFormat } from '../lib/cellFormats'
import { chunk, MAX_NEW_ROWS, planNewRows, planSave, refusalMessage } from '../lib/savePlan'
import { dseMonthKey, todayIst, withScreenColumns } from '../lib/screenColumns'
import '../tracker.css'

const STORED_KEYS = ALL_COLUMNS.filter((c) => !c.screen).map((c) => c.key)
const RETRY_MS = [1000, 3000, 8000]
const SLAB_INPUTS = new Set(['dse', 'date_of_retail'])
// what is still waiting to be saved: cells for edits, rows for new vehicles
const waitingOf = (queue) => queue.reduce((n, q) => n + (q.kind === 'create' ? q.rows.length
  : q.kind === 'formats' ? q.formats.length : q.kind === 'note' ? 1 : q.changes.length), 0)
const MAX_FORMATS = 2000  // the Edge Function's cap for one setFormats
const NOTE_SETTLE_MS = 2500 // Univer reports a note while it is typed (after each pause); save once it settles

// what the grid holds (owner, 2026-10-24: "current year only"): this financial year + every older truck still
// open, or one past year, or all of them; Find reaches the rest. A 4× test of the whole book took minutes.
// a.push(...b) passes every item as an argument and overflows the stack past ~100k — an undo of a sort
// reported the whole book's formats at once (seen 2026-10-25). A big paste or colouring could too.
const append = (a, b) => { for (const x of b) a.push(x) }
const scopeKey = (s) => s.scope === 'year' ? `year-${s.year}` : s.scope

export default function TrackerPage() {
  const [scope, setScope] = useState({ scope: 'working' })
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
  const savedFormat = useRef(new Map()) // "unitId|column" → the formatting last saved (or loaded)
  const fmtBuffer = useRef({ list: [], timer: null })
  const noteTimers = useRef(new Map())  // "unitId|column" → { timer, id, key, text } not yet queued
  const slabBase = useRef(new Map())    // "DSE|yyyy-mm" → that month's trucks NOT in this scope (the server counts them)
  const [alOpen, setAlOpen] = useState(false) // the AL sheet panel (stays open across a year change)
  const goAfterLoad = useRef(null)      // a truck Find found in another year: go to it once its year is loaded

  const say = useCallback((text, tone = 'info', sticky = false) => {
    setNotice({ text, tone })
    clearTimeout(noticeTimer.current)
    if (!sticky) noticeTimer.current = setTimeout(() => setNotice(null), 7000)
  }, [])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setAdded(0)
    loadBook(STORED_KEYS, scope, (got, of) => !cancelled && of > 2500 && setState({ status: 'loading', got, of }))
      .then(({ rows, hidden, formats: fmts, notes: noteRows, dseCounts, fyStart, total }) => {
        if (cancelled) return
        // the slab counts the whole month: the server's count, less the trucks of it this page holds
        const base = new Map(Object.entries(dseCounts ?? {}))
        for (const r of rows) { const k = !r.superseded_at && dseMonthKey(r); if (k && base.has(k)) base.set(k, base.get(k) - 1) }
        slabBase.current = base
        const formats = new Map()
        for (const f of fmts ?? []) if (Object.keys(f.format ?? {}).length) formats.set(`${f.unit_id}|${f.column_key}`, f.format)
        savedFormat.current = new Map(formats)
        // a cell shows its latest note; the earlier versions stay on the server as its history
        const notes = new Map()
        for (const n of noteRows ?? []) notes.set(`${n.unit_id}|${n.column_key}`, n.body)
        const hide = new Set(hidden)
        // DSE incentive is worked out on screen from the same figures — hidden with them
        if (hide.size) hide.add('dse_incentive')
        const columns = ALL_COLUMNS.filter((c) => !hide.has(c.key))
        const full = withScreenColumns(rows, todayIst(), slabBase.current)
        shadow.current = new Map(full.map((r) => [r.id, { ...r }]))
        setState({ status: 'ready', columns, rows: full, formats, notes, fyStart, total })
      })
      .catch((e) => !cancelled && setState({ status: 'error', message: e.message }))
    return () => { cancelled = true }
  }, [scope])

  // a truck Find brought from another year: go to it once the grid has drawn
  useEffect(() => {
    if (state.status !== 'ready' || !goAfterLoad.current) return
    const id = goAfterLoad.current
    goAfterLoad.current = null
    const t = setTimeout(() => grid.current?.goTo(id, 'chassis_no'), 300)
    return () => clearTimeout(t)
  }, [state])

  // Change what the grid holds. Refused while anything is still being saved (the grid is rebuilt).
  const changeScope = useCallback((next, goToId = null) => {
    if (queue.current.length || noteTimers.current.size || fmtBuffer.current.list.length || buffer.current.cells.length) {
      say('Wait until “All changes saved”, then change the year.', 'warn')
      return false
    }
    goAfterLoad.current = goToId
    // loading in the SAME render as the new scope: otherwise one render pairs the new year with the old rows —
    // the header read "3,688 vehicles · 2022-23" and the grid (keyed by the scope) built a whole engine around
    // the old rows only to drop it (seen 2026-10-25)
    setState({ status: 'loading' })
    setScope(next)
    return true
  }, [say])

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const onLeave = (e) => {
      if (queue.current.length || noteTimers.current.size || fmtBuffer.current.list.length) { e.preventDefault(); e.returnValue = '' }
    }
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
      const all = withScreenColumns([...shadow.current.values()], today, slabBase.current)
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
        for (const q of queue.current) {
          for (const c of q.changes ?? q.formats ?? []) if (c.unit_id === temp) c.unit_id = res.id
          if (q.unit_id === temp) q.unit_id = res.id
        }
        for (const [k, v] of [...savedFormat.current]) {
          if (k.startsWith(`${temp}|`)) { savedFormat.current.delete(k); savedFormat.current.set(`${res.id}|${k.slice(temp.length + 1)}`, v) }
        }
        if (res.row) takeRows([res.row], false)
        if (Object.keys(values).some((k) => SLAB_INPUTS.has(k))) slab = true
        made++
      } else {
        grid.current?.clearRow(temp)
        shadow.current.delete(temp)
        for (const q of queue.current) {
          if (q.changes) q.changes = q.changes.filter((c) => c.unit_id !== temp)
          if (q.formats) q.formats = q.formats.filter((c) => c.unit_id !== temp)
          if (q.unit_id === temp) q.dropped = true
        }
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
    // what belonged to a new row the server then refused was dropped from its save
    const empty = item.kind === 'formats' ? !item.formats.length : item.kind === 'note' ? item.dropped
      : item.kind !== 'create' && !item.changes.length
    if (empty) { queue.current.shift(); pump(); return }
    busy.current = true
    setSaving({ waiting: waitingOf(queue.current), failed: false })
    try {
      if (item.kind === 'create') {
        const r = await createUnits({
          client_request_id: item.requestId, batch_id: item.batchId, rows: item.rows.map((x) => x.values),
        })
        queue.current.shift()
        takeCreated(item, r)
      } else if (item.kind === 'formats') {
        await setFormats(item.formats)
        queue.current.shift()
      } else if (item.kind === 'note') {
        // ⚠️ not replay-safe: if the answer is lost and this is retried, the version is stored twice
        // (the cell still shows the right text; the history has a duplicate)
        await addNote(item.unit_id, item.column_key, item.body)
        queue.current.shift()
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
    append(buffer.current.cells, cells)
    append(buffer.current.fresh, fresh)
    buffer.current.source = source
    if (!buffer.current.timer) buffer.current.timer = setTimeout(flush, 0)
  }, [flush])

  // Formatting the grid reports (after any change, undo included): only what differs from what was
  // saved goes out. Gathered for a tick, so a new row's create is queued ahead of its colours.
  const onFormats = useCallback((list) => {
    append(fmtBuffer.current.list, list)
    if (fmtBuffer.current.timer) return
    fmtBuffer.current.timer = setTimeout(() => {
      const { list: all } = fmtBuffer.current
      fmtBuffer.current = { list: [], timer: null }
      const last = new Map()
      for (const f of all) {
        const id = realId.current.get(f.id) ?? f.id
        last.set(`${id}|${f.key}`, { unit_id: id, column_key: f.key, format: f.format })
      }
      const changed = [...last.entries()].filter(([k, f]) => !sameFormat(savedFormat.current.get(k), f.format))
      if (!changed.length) return
      for (const [k, f] of changed) savedFormat.current.set(k, f.format)
      for (const piece of chunk(changed.map(([, f]) => f), MAX_FORMATS)) {
        queue.current.push({ kind: 'formats', formats: piece })
      }
      pump()
    }, 0)
  }, [pump])

  // A note is saved once it has settled (Univer reports it after each pause in typing).
  const onNote = useCallback((id, key, text) => {
    const k = `${id}|${key}`
    const cur = noteTimers.current.get(k)
    if (cur) clearTimeout(cur.timer)
    const timer = setTimeout(() => {
      noteTimers.current.delete(k)
      queue.current.push({ kind: 'note', unit_id: realId.current.get(id) ?? id, column_key: key, body: text })
      pump()
    }, NOTE_SETTLE_MS)
    noteTimers.current.set(k, { timer })
    setSaving((s) => ({ ...s, waiting: s.waiting || 1 }))
  }, [pump])

  const retry = useCallback(() => {
    for (const q of queue.current) q.attempts = 0
    setNotice(null)
    pump()
  }, [pump])

  // the rows as this page holds them (typed edits included), for Find and History
  const bookRows = useCallback(() => [...shadow.current.values()], [])

  const count = state.status === 'ready' ? state.rows.length + added : 0
  const fy = state.fyStart ? Number(state.fyStart.slice(0, 4)) : null
  const fyLabel = (y) => `${y}-${String(y + 1).slice(2)}`
  const holding = scope.scope === 'working' ? (fy ? `${fyLabel(fy)} + still open` : 'this year + still open')
    : scope.scope === 'year' ? fyLabel(scope.year) : 'all years'
  const columns = useMemo(() => (state.status === 'ready' ? state.columns : []), [state])
  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])

  return (
    <div className="trk-page">
      <div className="trk-head">
        <h1 className="trk-title">Vehicle Tracker<span className="period-accent">.</span></h1>
        {state.status === 'ready' && (
          <span className="trk-count" title={`The book holds ${Number(state.total ?? count).toLocaleString('en-IN')} vehicles in all years`}>
            {count.toLocaleString('en-IN')} vehicles · {holding}
          </span>
        )}
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
      {state.status === 'loading' && <div className="trk-loading"><span className="spinner" /> Loading {scope.scope === 'all' ? 'every year of the book' : 'the book'}…
        {state.of ? ` ${state.got.toLocaleString('en-IN')} of ${state.of.toLocaleString('en-IN')} vehicles` : ''}</div>}
      {state.status === 'error' && <div className="trk-error" role="alert">Could not load the book: {state.message}</div>}
      {state.status === 'ready' && <TrackerTools grid={grid} bookRows={bookRows} say={say}
        scope={scope} fyStart={fy} onScope={changeScope} alOpen={alOpen} setAlOpen={setAlOpen} />}
      {state.status === 'ready' && (
        <TrackerGrid key={scopeKey(scope)} ref={grid} columns={columns} rows={rows} formats={state.formats} notes={state.notes}
          onChanges={onChanges} onFormats={onFormats} onNote={onNote} onRefused={(m) => say(m)} />
      )}
    </div>
  )
}
