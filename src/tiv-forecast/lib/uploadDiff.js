// TIV Forecast — what an upload is about to change (audit finding C1)
//
// Parsing and retraining are pure client-side functions and the current data is
// already in memory, so the entire consequence of an upload is knowable BEFORE
// the first byte is written. It used to be a two-integer preview followed by an
// unconfirmed click that rewrote six production tables.
//
// This is also the only thing that would raise its voice before the documented
// multi-entity/brand overwrite (docs/backlog/tiv-multi-entity-brand.md): a file
// that rewrites every month of an existing dataset looks nothing like a normal
// incremental upload, and now says so.
import { SEGMENTS, SEG_COL } from '../constants'

const COLS = SEGMENTS.map(s => SEG_COL[s])
const LABEL_OF = Object.fromEntries(SEGMENTS.map(s => [SEG_COL[s], s]))

// Rows are numeric-ish; compare as numbers so 5 and "5" don't read as a change.
const same = (a, b) => {
  const na = a === null || a === undefined || a === '' ? null : Number(a)
  const nb = b === null || b === undefined || b === '' ? null : Number(b)
  if (na === null || nb === null) return na === nb
  return na === nb
}

export function buildUploadDiff(parsed, current = {}) {
  const currentTiv = current.tivActuals || []
  const byMonth = new Map(currentTiv.map(r => [r.month_label, r]))
  const incoming = parsed.tivActuals || []

  const added = []
  const changed = []          // [{ month, cells: [{ segment, from, to }] }]
  let unchanged = 0

  for (const row of incoming) {
    const prev = byMonth.get(row.month_label)
    if (!prev) { added.push(row.month_label); continue }
    const cells = COLS
      .filter(col => !same(prev[col], row[col]))
      .map(col => ({ segment: LABEL_OF[col], from: Number(prev[col]), to: Number(row[col]) }))
    if (cells.length) changed.push({ month: row.month_label, cells })
    else unchanged++
  }

  // Months the database holds that this file does not mention. Upserts never
  // delete, so these SURVIVE the upload -- which is worth saying, because the
  // natural reading of "replacing the data" is that they would not.
  const incomingMonths = new Set(incoming.map(r => r.month_label))
  const untouched = currentTiv
    .filter(r => !incomingMonths.has(r.month_label))
    .map(r => r.month_label)

  const changedCells = changed.reduce((s, m) => s + m.cells.length, 0)
  const overlap = incoming.length - added.length

  return {
    added,
    changed,
    changedCells,
    unchanged,
    untouched,
    isFirstUpload: currentTiv.length === 0,
    // A file that rewrites essentially every month it overlaps is not an
    // incremental update. Either it is a different dataset (the multi-brand
    // hazard) or the columns have shifted.
    wholesaleRewrite: overlap >= 6 && changed.length >= overlap * 0.9,
    // Retraining runs on the FILE, not the database, so a short file trains a
    // model that ignores history the database still holds and still displays.
    coverageShortfall: currentTiv.length > 0 && incoming.length < currentTiv.length
      ? { fileMonths: incoming.length, dbMonths: currentTiv.length }
      : null,
  }
}

// Current vs new forecast for the same three months, so the admin sees the
// effect of the upload in the units the business actually talks about.
export function buildForecastDelta(currentResult, nextResult) {
  if (!currentResult || !nextResult) return []
  const currentByMonth = new Map(currentResult.totals.map(t => [t.month, t.tiv]))
  return nextResult.totals.map(t => {
    const before = currentByMonth.has(t.month) ? currentByMonth.get(t.month) : null
    return {
      month: t.month,
      before,
      after: t.tiv,
      delta: before === null || t.tiv === null ? null : t.tiv - before,
    }
  })
}
