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
  const missing = currentTiv.filter(r => !incomingMonths.has(r.month_label))
  const untouched = missing.map(r => r.month_label)

  // Of those, the ones that carry no data at all are almost certainly the
  // pre-typed future months an older parser wrote as zeros before blank rows
  // were skipped. They are not history the file is missing -- they are
  // residue, and counting them as history made a correct file look deficient.
  const hasData = r => COLS.some(c => Number(r[c]) > 0)
  const emptyMonths = missing.filter(r => !hasData(r)).map(r => r.month_label)
  const missingWithData = missing.filter(hasData).map(r => r.month_label)

  const changedCells = changed.reduce((s, m) => s + m.cells.length, 0)
  const overlap = incoming.length - added.length

  return {
    added,
    changed,
    changedCells,
    unchanged,
    untouched,
    emptyMonths,
    missingWithData,
    isFirstUpload: currentTiv.length === 0,
    // A file that rewrites essentially every month it overlaps is not an
    // incremental update. Either it is a different dataset (the multi-brand
    // hazard) or the columns have shifted.
    wholesaleRewrite: overlap >= 6 && changed.length >= overlap * 0.9,
    // Retraining runs on the FILE, not the database, so a short file trains a
    // model that ignores history the database still holds and still displays.
    //
    // The test is whether real history is missing -- NOT whether the row counts
    // differ. Comparing counts made a perfectly correct file look deficient
    // because the database still held eight empty future months from an older
    // upload, and pointed the blame at the file instead of at the residue.
    coverageShortfall: missingWithData.length > 0
      ? {
          fileMonths: incoming.length,
          dbMonths: currentTiv.length,
          months: missingWithData,
        }
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

// ── What an upload would REMOVE (owner's decision, 2026-08-25) ────────
//
// Upserts never delete, so a month dropped from the workbook used to live in
// the database forever — that is how twelve ghost judgment rows survived every
// upload. The owner chose "ask me, then remove": show the exact list, let them
// tick, and only then delete.
//
// The rule here must be IDENTICAL to the one tiv_upload_and_prune() applies:
// per table, a stored month_label that the incoming payload for that same table
// does not contain. Per table matters — the actuals sheets run to 52 months
// while the prediction sheets run to 14, so a global month set would propose
// deleting 38 months of judgment that were never supposed to be there.
//
// The database re-counts before deleting and refuses if its number differs from
// `total`, so a preview that goes stale between reading and confirming cannot
// delete something the uploader never saw.
export const REMOVAL_TABLES = [
  { table: 'tiv_forecast_tiv_actuals',  key: 'tivActuals',  label: 'TIV actuals' },
  { table: 'tiv_forecast_ptb_actuals',  key: 'ptbActuals',  label: 'PTB actuals' },
  { table: 'tiv_forecast_al_actuals',   key: 'alActuals',   label: 'AL actuals' },
  { table: 'tiv_forecast_judgment_tiv', key: 'judgmentTiv', label: 'TIV judgment' },
  { table: 'tiv_forecast_judgment_ptb', key: 'judgmentPtb', label: 'PTB judgment' },
  { table: 'tiv_forecast_raw_data',     key: 'rawRows',     label: 'raw data' },
]

export function computeRemovals(parsed, storedMonths = {}) {
  const byTable = []
  let total = 0
  const allMonths = new Set()

  for (const { table, key, label } of REMOVAL_TABLES) {
    const incoming = new Set((parsed?.[key] || []).map(r => r.month_label))
    const stored = storedMonths[table] || []
    // A sheet that parsed to nothing is a broken file, not an instruction to
    // empty a table. Propose no removals for it; the database refuses outright.
    const months = incoming.size === 0 ? [] : stored.filter(m => !incoming.has(m)).sort()
    if (months.length) {
      byTable.push({ table, label, months })
      total += months.length
      months.forEach(m => allMonths.add(m))
    }
  }

  return {
    byTable,
    total,
    months: [...allMonths].sort(),
    // True when any sheet parsed empty: removal must not even be offered,
    // because the file is wrong, not the database.
    blocked: REMOVAL_TABLES.some(({ key }) => (parsed?.[key] || []).length === 0),
  }
}
