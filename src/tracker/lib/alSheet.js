// Phase 10 — reading a month's AL Balance Sheet (the team's Excel file) for the monthly check.
//
// Owner, 2026-10-23: the AL account stays in Excel; once a month the FINAL sheet is uploaded and the
// portal points out what disagrees (docs/backlog/phase10-column-map.md → G "DECIDED"). This reads the
// file in the browser and hands the server plain lines; the server stores them and runs the checks.
// Nothing in the tracker is changed by an upload.
//
// Columns are found by their HEADER, never by position (some months carry extra unnamed scratch
// columns, April 2025 a second "Date"); the first header of a name wins. The month is the one most of
// the dated lines fall in (the CARRY OVER line carries last month's date); the file name ("…-0326")
// is a second opinion — when they disagree the reader says so. Pure; tested offline by
// scripts/phase10/selftest-al-sheet.mjs, and on the real 2025-26 files (counts only).
import { serialToIso } from './cellValues.js'

export const AL_SHEET_NAME = 'AL Balance Sheet'
export const MAX_AL_LINES = 2000
// header → field; the first six are needed, the rest are read when present
const NEEDED = { 'Details': 'details', 'Debit': 'debit', 'Credit': 'credit', 'Chassis No': 'chassis_no', 'CTD': 'ctd', 'Offtake Mode': 'offtake_mode' }
const OPTIONAL = { 'Date': 'line_date', 'CBN Number': 'cbn', 'Engine No': 'engine_no' }

const money = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
const text = (v) => { const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return s === '' ? null : s }
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthLabel = (iso) => { const [y, m] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}` }

// "AL Balance Sheet -0326.xlsx" → '2026-03-01' (the last MMYY in the name), else null
export function monthFromFileName(name) {
  const all = [...String(name ?? '').replace(/\.[a-z]+$/i, '').matchAll(/(?<!\d)(\d{2})(\d{2})(?!\d)/g)]
  const m = all.at(-1)
  if (!m) return null
  const mm = Number(m[1]), yy = Number(m[2])
  return mm >= 1 && mm <= 12 ? `20${String(yy).padStart(2, '0')}-${String(mm).padStart(2, '0')}-01` : null
}

const cleanHead = (row) => (row ?? []).map((h) => String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase())

// rows: the sheet as arrays, values raw (dates as Excel serials); the header is the first of the first
// ten rows that has both "Details" and "Offtake Mode" (row 1 in every real file)
// hasFormula(index in rows, col): whether that Credit cell holds a formula (the team writes = CTD × 0.999)
// → { month, lines: [{ row_no, line_date, details, debit, credit, cbn, chassis_no, engine_no, ctd,
//      offtake_mode, credit_is_formula }], warnings: [text] }   or throws Error(person-readable reason)
export function parseAlSheet({ rows, hasFormula = () => true, fileName = '' }) {
  if (!rows?.length) throw new Error('The sheet is empty.')
  let h = rows.slice(0, 10).findIndex((r) => { const c = cleanHead(r); return c.includes('details') && c.includes('offtake mode') })
  if (h < 0) h = 0
  const head = rows[h].map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
  const col = {}
  for (const [name, field] of Object.entries({ ...NEEDED, ...OPTIONAL })) {
    const i = head.findIndex((h) => h.toLowerCase() === name.toLowerCase())
    if (i >= 0) col[field] = i
  }
  const missing = Object.entries(NEEDED).filter(([, f]) => col[f] === undefined).map(([n]) => n)
  if (missing.length) throw new Error(`The header row needs the columns ${missing.map((n) => `“${n}”`).join(', ')} — not found.`)
  const at = (r, f) => (col[f] === undefined ? null : r[col[f]])

  const lines = []
  rows.slice(h + 1).forEach((r, k) => {
    const i = h + 1 + k   // index in rows
    const line = {
      row_no: i + 1,
      line_date: typeof at(r, 'line_date') === 'number' ? serialToIso(at(r, 'line_date')) : null,
      details: text(at(r, 'details')),
      debit: money(at(r, 'debit')),
      credit: money(at(r, 'credit')),
      cbn: text(at(r, 'cbn'))?.toUpperCase() ?? null,
      chassis_no: text(at(r, 'chassis_no'))?.toUpperCase() ?? null,
      engine_no: text(at(r, 'engine_no'))?.toUpperCase() ?? null,
      ctd: money(at(r, 'ctd')),
      offtake_mode: text(at(r, 'offtake_mode'))?.toUpperCase() ?? null,
    }
    // an empty line (no words, no money) is not a line
    if (!line.details && !line.debit && !line.credit && !line.chassis_no) return
    line.credit_is_formula = line.credit ? hasFormula(i, col.credit) : null
    lines.push(line)
  })
  if (!lines.length) throw new Error('The sheet has no lines below its header.')
  if (lines.length > MAX_AL_LINES) throw new Error(`The sheet has ${lines.length} lines — at most ${MAX_AL_LINES} in one month.`)

  // the month: most of the dated lines
  const byMonth = new Map()
  for (const l of lines) if (l.line_date) { const k = `${l.line_date.slice(0, 7)}-01`; byMonth.set(k, (byMonth.get(k) ?? 0) + 1) }
  if (!byMonth.size) throw new Error('No line has a date — the month cannot be told.')
  const [month, inMonth] = [...byMonth].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0]
  const dated = lines.filter((l) => l.line_date).length
  const warnings = []
  const named = monthFromFileName(fileName)
  if (named && named !== month) warnings.push(`The file name says ${monthLabel(named)}, but most lines are dated ${monthLabel(month)} — read as ${monthLabel(month)}.`)
  if (inMonth < dated * 0.5) warnings.push(`Only ${inMonth} of ${dated} dated lines fall in ${monthLabel(month)}.`)
  return { month, lines, warnings }
}

// The sheet's own totals, for the preview before uploading (the server works them out again).
export function sheetTotals(lines) {
  let paid = 0, owed = 0, net = null, carry = null, credits = 0, payments = 0
  for (const l of lines) {
    const d = l.details ?? ''
    if (/^net balance$/i.test(d)) { net = l.debit ?? 0; continue }
    if (/unbilled balance/i.test(d)) continue
    paid += l.debit ?? 0; owed += l.credit ?? 0
    if (/^carry over$/i.test(d)) { carry = (l.debit ?? 0) - (l.credit ?? 0); continue }
    if (l.credit) credits++
    else if (l.debit) payments++
  }
  const r2 = (v) => Math.round(v * 100) / 100
  return { paid: r2(paid), owed: r2(owed), net, carry, credits, payments, ties: net !== null && Math.abs(net - (paid - owed)) < 1 }
}

// From a SheetJS workbook (the page loads the library only when a file is chosen).
export function readAlWorkbook(XLSX, wb, fileName) {
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === AL_SHEET_NAME.toLowerCase())
    ?? wb.SheetNames.find((n) => {
      const first = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: true })[0] ?? []
      return first.some((h) => String(h ?? '').trim() === 'Offtake Mode')
    })
  if (!name) throw new Error(`No “${AL_SHEET_NAME}” sheet in this file.`)
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true })
  // rows are counted from where the sheet's used range starts, which need not be A1
  const start = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s
  const hasFormula = (r, c) => Boolean(ws[XLSX.utils.encode_cell({ r: r + start.r, c: c + start.c })]?.f)
  const read = parseAlSheet({ rows, fileName, hasFormula })
  if (start.r) for (const l of read.lines) l.row_no += start.r   // the row number Excel shows
  return read
}
