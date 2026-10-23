// Phase 10 — the toolbar above the grid (slice 5): find a vehicle, layouts, Copy for mail, a row's history.
// One line, so the grid gives up one line of height for all four. Everything here reads the grid or the
// server; nothing writes a cell.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { deleteView, history, listViews, logExport, saveView } from '../lib/trackerApi'
import { findRows, MIN_FIND } from '../lib/findRows'
import { mailTable, BIG_COPY } from '../lib/mailTable'
import { describeChange } from '../lib/historyText'
import { COLUMN_BY_KEY } from '../lib/columnMeta'

const LAYOUT_KEY = 'trk-layout' // the layout last chosen, per browser
const remembered = () => { try { return localStorage.getItem(LAYOUT_KEY) ?? '' } catch { return '' } }
const remember = (id) => { try { if (id) localStorage.setItem(LAYOUT_KEY, id); else localStorage.removeItem(LAYOUT_KEY) } catch { /* private window */ } }

// grid: the TrackerGrid handle · bookRows(): the rows as the page holds them · say(text, tone)
export default function TrackerTools({ grid, bookRows, say }) {
  const { isAdmin, profile } = useAuth()

  // ── Find a vehicle ───────────────────────────────────────────────────────────────────────────
  const [find, setFind] = useState({ q: '', hits: [], at: -1, note: '' })
  const onFind = (q) => {
    const hits = findRows(bookRows(), q)
    setFind({ q, hits, at: -1, note: q.trim().length < MIN_FIND ? '' : hits.length ? `${hits.length} found` : 'not found' })
  }
  const nextHit = () => {
    if (!find.hits.length) return
    const at = (find.at + 1) % find.hits.length
    const h = find.hits[at]
    const got = grid.current?.goTo(h.id, h.key)
    setFind((f) => ({ ...f, at,
      note: got === 'hidden' ? `${at + 1} of ${f.hits.length} — hidden by your filter` : `${at + 1} of ${f.hits.length}` }))
  }

  // ── Layouts ────────────────────────────────────────────────────────────────────────────────
  const [views, setViews] = useState([])
  const [layout, setLayout] = useState('')       // the chosen layout's id; '' = all columns
  const [form, setForm] = useState(null)         // the save form: { name, shared } while open
  const applied = useRef(false)

  const choose = useCallback((id, list = views) => {
    const v = list.find((x) => x.id === id)
    grid.current?.showOnly(v ? v.columns : null)
    setLayout(v ? v.id : '')
    remember(v ? v.id : '')
  }, [grid, views])

  useEffect(() => {
    let gone = false
    listViews().then(({ views: list }) => {
      if (gone) return
      setViews(list ?? [])
      // the layout this browser last used comes back with the page
      if (!applied.current) { applied.current = true; const id = remembered(); if (id) choose(id, list ?? []) }
    }).catch(() => { /* layouts are an extra: the book works without them */ })
    return () => { gone = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const current = views.find((v) => v.id === layout)
  const mayEdit = (v) => v && (v.owner_id === null ? isAdmin : v.owner_id === profile?.id)

  const openSave = () => setForm({ name: mayEdit(current) ? current.name : '', shared: current?.owner_id === null && isAdmin })
  const doSave = async () => {
    const name = form.name.trim()
    if (!name) return
    const columns = grid.current?.shownKeys() ?? []
    // the same name as a layout this person may change → that layout is updated
    const same = views.find((v) => v.name.toLowerCase() === name.toLowerCase() && (v.owner_id === null) === form.shared && mayEdit(v))
    try {
      const { view } = await saveView({ ...(same ? { id: same.id } : {}), name, columns, shared: form.shared })
      const list = [...views.filter((v) => v.id !== view.id), view].sort((a, b) => a.name.localeCompare(b.name))
      setViews(list); setLayout(view.id); remember(view.id); setForm(null)
      say(`Layout “${view.name}” saved — ${columns.length} columns.`)
    } catch (e) { say(`Layout not saved: ${e.message}`, 'warn') }
  }
  const doDelete = async () => {
    if (!current || !window.confirm(`Delete the layout “${current.name}”?`)) return
    try {
      await deleteView(current.id)
      setViews(views.filter((v) => v.id !== current.id)); choose('', []); setForm(null)
      say(`Layout “${current.name}” deleted — all columns are showing.`)
    } catch (e) { say(`Layout not deleted: ${e.message}`, 'warn') }
  }

  // ── Copy for mail ──────────────────────────────────────────────────────────────────────────
  const copy = async () => {
    const shown = grid.current?.onScreen()
    if (!shown) return
    const { columns, lines } = shown
    if (!lines.length) { say('Nothing to copy — no vehicle is showing.', 'warn'); return }
    const cells = columns.length * lines.length
    if (cells > BIG_COPY && !window.confirm(`That is ${lines.length.toLocaleString('en-IN')} rows × ${columns.length} columns. ` +
      'Filter the rows or hide columns first for a mail. Copy all of it anyway?')) return
    const { html, text } = mailTable(columns, lines)
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
    } catch {
      try { await navigator.clipboard.writeText(text) } catch (e) { say(`Could not copy: ${e.message}`, 'warn'); return }
    }
    say(`Copied ${lines.length.toLocaleString('en-IN')} row${lines.length === 1 ? '' : 's'} × ${columns.length} columns — paste into the mail.`)
    logExport('copy', lines.length, columns.map((c) => c.key)).catch(() => { /* the copy is done; the log is best effort */ })
  }

  // ── A row's history ────────────────────────────────────────────────────────────────────────
  const [hist, setHist] = useState(null) // { id, key, chassis, entries|null, onlyThis, error }
  const openHistory = async () => {
    const cell = grid.current?.activeCell()
    if (!cell) { say('Click a cell in a vehicle’s row first, then History.'); return }
    const chassis = bookRows().find((r) => r.id === cell.id)?.chassis_no ?? ''
    setHist({ ...cell, chassis, entries: null, onlyThis: false })
    try {
      const { history: list } = await history(cell.id)
      setHist((h) => h && h.id === cell.id ? { ...h, entries: list ?? [] } : h)
    } catch (e) { setHist((h) => h && { ...h, entries: [], error: e.message }) }
  }
  const shownEntries = hist?.entries?.filter((e) => !hist.onlyThis || e.column_key === hist.key || e.column_key === '*') ?? []

  return (
    <>
      <div className="trk-tools">
        <label className="trk-find">
          <span className="trk-tools-label">Find</span>
          <input type="search" value={find.q} placeholder="last digits of chassis, engine or gatepass"
            onChange={(e) => onFind(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); nextHit() } }} />
          {find.note && <span className="trk-find-note">{find.note}{find.hits.length > 0 && find.at < 0 ? ' — Enter to go' : ''}</span>}
        </label>

        <label className="trk-layout">
          <span className="trk-tools-label">Layout</span>
          <select value={layout} onChange={(e) => choose(e.target.value)}>
            <option value="">All columns</option>
            {views.filter((v) => v.owner_id === null).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            {views.some((v) => v.owner_id !== null) && (
              <optgroup label="Mine">
                {views.filter((v) => v.owner_id !== null).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </optgroup>
            )}
          </select>
          <button type="button" className="btn btn-sm btn-secondary" onClick={openSave}
            title="Hide the columns you do not need (right-click a column → Hide), then save what is showing">Save layout</button>
        </label>

        <button type="button" className="btn btn-sm btn-secondary" onClick={copy}
          title="Copies the rows your filter shows × the columns not hidden, as a table for a mail">Copy for mail</button>
        <button type="button" className="btn btn-sm btn-secondary" onClick={openHistory}
          title="Every change to the selected vehicle — who, when, what">History</button>
      </div>

      {form && (
        <div className="trk-pop" role="dialog" aria-label="Save layout">
          <p className="trk-pop-hint">Saves the columns showing now. Hide a column with right-click → Hide.</p>
          <input autoFocus value={form.name} maxLength={80} placeholder="Layout name, e.g. Finance follow-up"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') setForm(null) }} />
          {isAdmin && (
            <label className="trk-pop-check"><input type="checkbox" checked={form.shared}
              onChange={(e) => setForm({ ...form, shared: e.target.checked })} /> Shared with everyone</label>
          )}
          <div className="trk-pop-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={doSave} disabled={!form.name.trim()}>Save</button>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            {mayEdit(current) && <button type="button" className="btn btn-sm btn-secondary trk-pop-delete" onClick={doDelete}>Delete “{current.name}”</button>}
          </div>
        </div>
      )}

      {hist && (
        <aside className="trk-history" aria-label="History">
          <div className="trk-history-head">
            <strong>History — {hist.chassis}</strong>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setHist(null)} aria-label="Close">×</button>
          </div>
          <label className="trk-pop-check"><input type="checkbox" checked={hist.onlyThis}
            onChange={(e) => setHist({ ...hist, onlyThis: e.target.checked })} /> Only {COLUMN_BY_KEY[hist.key]?.label}</label>
          {hist.entries === null && <p className="trk-history-empty"><span className="spinner" /> Loading…</p>}
          {hist.error && <p className="trk-history-empty">Could not load: {hist.error}</p>}
          {hist.entries && !hist.error && !shownEntries.length && <p className="trk-history-empty">No changes recorded.</p>}
          <ol className="trk-history-list">
            {shownEntries.map((e) => {
              const d = describeChange(e, COLUMN_BY_KEY)
              return (
                <li key={e.id}>
                  <div className="trk-history-meta">{d.at} · {d.who}{d.how ? ` · ${d.how}` : ''}</div>
                  <div><strong>{d.what}</strong>{e.column_key === '*' ? ` ${d.to}`
                    : <>: <span className="trk-history-old">{d.from || 'empty'}</span> → {d.to || 'empty'}</>}</div>
                </li>
              )
            })}
          </ol>
          {hist.entries?.length === 200 && <p className="trk-history-empty">Showing the latest 200 changes.</p>}
        </aside>
      )}
    </>
  )
}
