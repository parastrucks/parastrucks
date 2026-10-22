// Phase 10 — the save adapter's decisions, as a pure function (tested offline by
// scripts/phase10/selftest-tracker-cells.mjs). The grid reports what changed; this says, for each
// cell, whether to SAVE it, REFUSE it (with the reason a person can act on), or quietly PUT IT BACK.
//
// The adapter's duties (plan → "DECIDED"), and where each lives:
//   1 raw values ............................ TrackerGrid (getRawValues)
//   2 convert or refuse (lakh commas, dates)  cellValues.fromCell, called here
//   3 one command = before-vs-final .......... here: each cell's LAST value is judged, never the
//                                              blank a fill passes through on its way
//   4 lock: put back computed columns ........ here (and edit-start refusal in TrackerGrid)
//   5 undo/redo labels ....................... TrackerGrid (window key listener)
//   6 refuse '=' formulas .................... here
//   7 persist formatting ..................... later slice
//   8 every write through the Edge Function .. TrackerPage, with these before-values

import { fromCell, sameValue, toCell } from './cellValues.js'

// what the grid cell holds for a database value (a date is a serial, a blank is null)
const shows = (col, v) => toCell(col.spec, v)
const held = (v) => (v === undefined || v === '' ? null : v) // an empty cell is null

export const MAX_PER_SAVE = 500 // the Edge Function's cap

// cells:   [{ id, key, value, formula }] in the order the grid reported them
// colByKey: key → column meta (columnMeta.ALL_COLUMNS entry)
// shadow:  Map id → row as the database last confirmed it
export function planSave(cells, colByKey, shadow) {
  // duty 3: the last report of each cell wins (a fill sends blank, then the value)
  const last = new Map()
  for (const c of cells) {
    const k = `${c.id}|${c.key}`
    last.delete(k) // keep first-seen order of the FINAL values
    last.set(k, c)
  }

  const changes = [], putBack = [], refused = []
  for (const { id, key, value, formula } of last.values()) {
    const col = colByKey[key]
    const row = shadow.get(id)
    if (!col || !row) continue // not a book cell (the grid handles its header and id column)
    const before = row[key] ?? null

    // duty 4: worked-out, screen and hidden columns are never typed into — put back what was there
    if (!col.editable) {
      putBack.push({ id, key, value: before })
      continue
    }
    // duty 6: cell formulas stay out (decision 17); formulas belong to columns
    if (formula) {
      refused.push({ id, key, label: col.label, reason: 'formulas are not allowed in data cells' })
      putBack.push({ id, key, value: before })
      continue
    }
    // duty 2
    const r = fromCell(col.spec, value)
    if (!r.ok) {
      refused.push({ id, key, label: col.label, reason: r.reason })
      putBack.push({ id, key, value: before })
      continue
    }
    if (sameValue(col.spec, before, r.value)) {
      // nothing to save — but if the cell shows a different spelling ("12,34,567" text for a number),
      // show the stored value so the cell is not left holding text
      if (shows(col, before) !== held(value)) putBack.push({ id, key, value: before })
      continue
    }
    changes.push({ unit_id: id, column: key, before, after: r.value })
    // a converted value ("12,34,567" → 1234567) is written back so the cell holds the real number
    if (shows(col, r.value) !== held(value)) putBack.push({ id, key, value: r.value })
  }
  return { changes, putBack, refused }
}

// NEW ROWS: cells typed or pasted into the spare rows below the book (no truck yet). A row becomes a
// vehicle when its chassis number arrives — on its own or in the same paste as the rest of the row.
// Anything typed into a spare row before its chassis is refused and cleared: a half-typed row with
// no chassis would look saved and be nowhere.
//
// cells: [{ r, key, value, formula }] — r is the sheet row, the same for one report
// Returns { creates: [{ r, values, show }], clear: [{ r, key }], refused }
//   values = what the server is sent; show = cells whose converted value differs from what was typed
export const MAX_NEW_ROWS = 200 // the Edge Function's (and tracker_create_units') cap
const NEW_ROW_REASON = 'a new vehicle starts with its chassis number — type that first, in the first column'

export function planNewRows(cells, colByKey) {
  const byRow = new Map()
  for (const c of cells) {
    if (!byRow.has(c.r)) byRow.set(c.r, new Map())
    const row = byRow.get(c.r)
    row.delete(c.key) // the last report of each cell wins (duty 3), first-seen order kept
    row.set(c.key, c)
  }

  const creates = [], clear = [], refused = []
  for (const [r, row] of byRow) {
    const filled = [...row.values()].filter((c) => held(c.value) !== null)
    if (!filled.length) continue // blanks into an empty row (Delete over spare rows): nothing to do
    const chassis = row.get('chassis_no')
    const chassisOk = chassis && held(chassis.value) !== null && !chassis.formula &&
      fromCell(colByKey.chassis_no.spec, chassis.value).ok
    if (!chassisOk) {
      const reason = chassis?.formula ? 'formulas are not allowed in data cells' : NEW_ROW_REASON
      refused.push({ r, key: 'chassis_no', label: colByKey.chassis_no.label, reason })
      for (const c of filled) clear.push({ r, key: c.key })
      continue
    }
    const values = {}, show = []
    for (const { key, value, formula } of filled) {
      const col = colByKey[key]
      if (!col) continue
      // worked-out columns: whatever a paste put there is cleared; the server fills them in
      if (!col.editable) { clear.push({ r, key }); continue }
      if (formula) {
        refused.push({ r, key, label: col.label, reason: 'formulas are not allowed in data cells' })
        clear.push({ r, key })
        continue
      }
      const v = fromCell(col.spec, value)
      if (!v.ok) {
        refused.push({ r, key, label: col.label, reason: v.reason })
        clear.push({ r, key })
        continue
      }
      values[key] = v.value
      if (shows(col, v.value) !== held(value)) show.push({ key, value: v.value })
    }
    creates.push({ r, values, show })
  }
  return { creates, clear, refused }
}

// Split a save over the Edge Function's limit. Each piece saves all-or-nothing on its own.
export function chunk(changes, size = MAX_PER_SAVE) {
  const out = []
  for (let i = 0; i < changes.length; i += size) out.push(changes.slice(i, i + size))
  return out
}

// What a person is told when cells are refused: one line, never a list of 200.
export function refusalMessage(refused, ending = ' The old value is back.') {
  if (!refused.length) return null
  const first = refused[0]
  const more = refused.length - 1
  return `${first.label}: ${first.reason}.` + (more ? ` (${more} more cell${more > 1 ? 's' : ''} not saved.)` : '') +
    ending
}
