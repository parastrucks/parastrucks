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

export const applyChanges = (payload) => callEdge(FN, 'applyChanges', payload)
export const createUnit = (values) => callEdge(FN, 'createUnit', { values })
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
