// Phase 10 — the browser's only way to the tracker's data: the admin-vehicle-units Edge Function.
// (No API role has a grant on the tracker tables; RLS cannot hide the incentive columns.)
import { callEdge } from '../../lib/api'

const FN = 'admin-vehicle-units'

// The whole book, page by page (the function returns at most 1000 rows a call).
export async function listAll(columns, { includeSuperseded = false } = {}) {
  const rows = []
  let offset = 0
  let hidden = []
  for (;;) {
    const r = await callEdge(FN, 'list', { columns, offset, includeSuperseded })
    rows.push(...r.rows)
    hidden = r.hidden ?? hidden
    if (r.nextOffset == null) break
    offset = r.nextOffset
  }
  return { rows, hidden }
}

// The book as the grid opens it, in ONE call (owner, 2026-10-24: "current year only"):
// scope 'working' (this financial year + every older truck still open) · 'year' + year (April of) · 'all' ·
// 'ids' + ids. → { rows, hidden, notes, formats, dseCounts, fyStart, total }. The server leaves empty cells
// out; every asked-for column is put back as null here, so the rest of the page sees what it always saw.
// It comes in pages of 2,500 (each database call must finish in 8 s: indexed, 2,000 rows took 0.4–2.3 s on the
// free instance, 5,000 up to 2.8 s + 10 MB — too near the limit): the first says how many there are, the rest
// come one after another (three at once overloaded it: ~13 s each, some over the limit — measured
// 2026-10-24). A page that fails is asked for again, twice, before the book reports an error.
const BOOK_PAGE = 2500
const TRIES = 3
const AT_ONCE = 1
export async function loadBook(columns, { scope = 'working', year, ids } = {}, onProgress = null) {
  const page = async (offset) => {
    for (let t = 1; ; t++) {
      try {
        const r = await callEdge(FN, 'book', { columns, scope, year, ids, offset, limit: BOOK_PAGE })
        return { ...r.book, hidden: r.hidden }
      } catch (e) { if (t >= TRIES) throw e; await new Promise((ok) => setTimeout(ok, 1500 * t)) }
    }
  }
  const first = await page(0)
  const count = first.scope_count ?? 0
  const pages = [first]
  const offsets = []
  for (let o = BOOK_PAGE; o < count; o += BOOK_PAGE) offsets.push(o)
  let done = 1
  onProgress?.(Math.min(BOOK_PAGE, count), count)
  for (let i = 0; i < offsets.length; i += AT_ONCE) {
    const got = await Promise.all(offsets.slice(i, i + AT_ONCE).map(page))
    pages.push(...got)
    done += got.length
    onProgress?.(Math.min(done * BOOK_PAGE, count), count)
  }
  const rows = [], notes = [], formats = [], dseCounts = {}
  for (const b of pages) {
    for (const row of b.rows ?? []) { const full = {}; for (const k of columns) full[k] = null; rows.push(Object.assign(full, row)) }
    notes.push(...(b.notes ?? [])); formats.push(...(b.formats ?? [])); Object.assign(dseCounts, b.dse_counts ?? {})
  }
  return { rows, hidden: first.hidden ?? [], notes, formats, dseCounts, fyStart: first.fy_start ?? null, total: first.total ?? rows.length }
}
// A truck in ANY year (q: 3+ letters/digits) → [{ id, chassis_no, customer_name, model, ptb_invoice_date, … }]
export const findAnywhere = (q) => callEdge(FN, 'find', { q }).then((r) => r.hits ?? [])

export const applyChanges = (payload) => callEdge(FN, 'applyChanges', payload)
export const createUnit = (values) => callEdge(FN, 'createUnit', { values })
// new rows from the grid: { client_request_id, batch_id, rows: [{ column: value }] }, at most 200
export const createUnits = (payload) => callEdge(FN, 'createUnits', payload)
export const supersedeUnit = (unit_id, values) => callEdge(FN, 'supersedeUnit', { unit_id, values })
export const history = (unit_id, column_key) => callEdge(FN, 'history', { unit_id, column_key })
export const listNotes = () => callEdge(FN, 'listNotes')
export const addNote = (unit_id, column_key, body) => callEdge(FN, 'addNote', { unit_id, column_key, body })
export const listFormats = () => callEdge(FN, 'listFormats')
export const setFormats = (formats) => callEdge(FN, 'setFormats', { formats })
export const listViews = () => callEdge(FN, 'listViews')
export const saveView = (view) => callEdge(FN, 'saveView', view)
export const deleteView = (id) => callEdge(FN, 'deleteView', { id })
export const logExport = (kind, rows, columns) => callEdge(FN, 'logExport', { kind, rows, columns })
