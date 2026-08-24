// TIV Forecast — Excel parser (migration spec Section 3)
// Parses the 6-sheet Market_Data_YY-YY.xlsx workbook into structured arrays.
import * as XLSX from 'xlsx'
import { SEGMENTS, SEG_COL, RAW_SEGMENT_ROWS, RAW_COLS_PER_MONTH, RAW_COL_OFFSET } from '../constants'
import { currentIstMonth, monthCursor } from './istMonth'

// Convert "Apr-22" → { year: 2022, month_num: 4, month_index: 0 }
// Apr-22 is index 0 (fiscal year start)
const MONTH_ABBR = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 }

// Excel date serial → "Apr-22" string
// Excel epoch = Dec 30, 1899; JS epoch = Jan 1, 1970 → offset 25569 days
function excelSerialToLabel(serial) {
  if (typeof serial !== 'number' || serial < 38000) return null  // < year 2004, not a valid data month
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
  return `${MONTH_NAMES[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(-2)}`
}

export function parseMonthLabel(label) {
  if (!label || typeof label !== 'string') return null
  const s = label.trim()
  let monthNum, year

  // Format 1: "Apr-22"
  const m1 = s.match(/^([A-Za-z]{3})-(\d{2})$/)
  if (m1) {
    monthNum = MONTH_ABBR[m1[1]]
    if (!monthNum) return null
    year = parseInt(m1[2]) + 2000
  } else {
    // Format 2: "April 2022" or "April-2022"
    const m2 = s.match(/^([A-Za-z]+)[- ](\d{4})$/)
    if (!m2) return null
    monthNum = MONTH_FULL[m2[1]]
    if (!monthNum) return null
    year = parseInt(m2[2])
  }

  const baseYear = 2022
  const baseMonth = 4
  const monthIndex = (year - baseYear) * 12 + (monthNum - baseMonth)
  // Return canonical MMM-YY label regardless of input format
  const canonicalLabel = `${MONTH_NAMES[monthNum - 1]}-${String(year).slice(-2)}`
  return { year, month_num: monthNum, month_index: monthIndex, canonicalLabel }
}

// ── Shared validation helpers (audit 2026-08-25 — findings A2, A6, A8) ──────
// The parser is the ONLY place that still knows whether a cell was blank or a
// genuine zero; every consumer downstream just sees a number. So the
// distinction has to be resolved here: an all-blank month is dropped, a real
// zero is preserved. (The 2022 PTB ramp-up months are genuine zeros — they must
// survive. A pre-typed future month with empty cells must not.)
const SEG_HEADERS = ['Bus PVT', 'Haulage', 'MAV', 'Tractor', 'Tipper', 'ICV Trucks']

const norm       = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const isBlank    = v => String(v ?? '').trim() === ''
const colLetter  = i => String.fromCharCode(65 + i)

// True when every segment cell is blank — the pre-typed-future-month signature.
function allSegmentsBlank(row) {
  for (let c = 1; c <= 6; c++) if (!isBlank(row[c])) return false
  return true
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) return i
  }
  return -1
}

// Column POSITIONS are load-bearing (row[1]→Bus PVT … row[6]→ICV Trucks) but
// were never verified, so inserting a helper column in Excel — a reflex for
// spreadsheet users — silently loaded every segment into the wrong bucket and
// then retrained the model on it. Fail loudly, in the workbook's own vocabulary.
function assertSegmentHeaders(headerCells, sheetLabel) {
  for (let c = 1; c <= 6; c++) {
    if (norm(headerCells[c]) !== norm(SEG_HEADERS[c - 1])) {
      const found = isBlank(headerCells[c]) ? '(blank)' : `"${String(headerCells[c]).trim()}"`
      throw new Error(
        `${sheetLabel}: column ${colLetter(c)} should be "${SEG_HEADERS[c - 1]}" but found ${found}. ` +
        'Remove or move the extra column so the segment columns line up.'
      )
    }
  }
}

// ── Sheet 2: Segment wise data - TIV ────────────────────────────────
// Columns: Month | Bus PVT | Haulage | MAV | Tractor | Tipper | ICV Trucks | TIV
function parseTivSheet(ws, warnings) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const headerRow = findHeaderRow(rows)
  if (headerRow === -1) throw new Error('TIV sheet: cannot find header row')
  assertSegmentHeaders(rows[headerRow], 'TIV sheet')

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    // A month row whose segment cells are all empty carries no data — it is a
    // placeholder the owner typed ahead. Reading it as six zeros poisoned
    // last_data_month, the YoY cap and the seasonal indices.
    if (allSegmentsBlank(row)) continue
    // Row-level reconciliation: a mismatch means the columns shifted or the
    // Total is hand-typed. Surfaced, not fatal — the owner's arithmetic is his.
    const segSum = [1, 2, 3, 4, 5, 6].reduce((s, c) => s + (Number(row[c]) || 0), 0)
    const stated = Number(row[7]) || 0
    if (stated && Math.abs(stated - segSum) > 1) {
      warnings.push(`TIV ${meta.canonicalLabel}: Total column says ${stated} but the six segments sum to ${segSum}.`)
    }
    result.push({
      month_label: meta.canonicalLabel,
      year:        meta.year,
      month_num:   meta.month_num,
      month_index: meta.month_index,
      bus_pvt:     Number(row[1]) || 0,
      haulage:     Number(row[2]) || 0,
      mav:         Number(row[3]) || 0,
      tractor:     Number(row[4]) || 0,
      tipper:      Number(row[5]) || 0,
      icv_trucks:  Number(row[6]) || 0,
      tiv_total:   Number(row[7]) || 0,
    })
  }
  return result
}

// ── Sheet 3: Segment wise data - PTB ────────────────────────────────
// Same structure, last col is "Total Sale"
function parsePtbSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const headerRow = findHeaderRow(rows)
  if (headerRow === -1) throw new Error('PTB sheet: cannot find header row')
  assertSegmentHeaders(rows[headerRow], 'PTB sheet')

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    if (allSegmentsBlank(row)) continue
    result.push({
      month_label: meta.canonicalLabel,
      year:        meta.year,
      month_num:   meta.month_num,
      month_index: meta.month_index,
      bus_pvt:     Number(row[1]) || 0,
      haulage:     Number(row[2]) || 0,
      mav:         Number(row[3]) || 0,
      tractor:     Number(row[4]) || 0,
      tipper:      Number(row[5]) || 0,
      icv_trucks:  Number(row[6]) || 0,
      total_sale:  Number(row[7]) || 0,
    })
  }
  return result
}

// ── Sheet 4: Segment wise prediction - TIV ──────────────────────────
function parseJudgmentTivSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const headerRow = findHeaderRow(rows)
  if (headerRow === -1) return []  // Optional sheet

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    if (allSegmentsBlank(row)) continue
    result.push({
      month_label: meta.canonicalLabel,
      bus_pvt:     row[1] !== '' ? Number(row[1]) : null,
      haulage:     row[2] !== '' ? Number(row[2]) : null,
      mav:         row[3] !== '' ? Number(row[3]) : null,
      tractor:     row[4] !== '' ? Number(row[4]) : null,
      tipper:      row[5] !== '' ? Number(row[5]) : null,
      icv_trucks:  row[6] !== '' ? Number(row[6]) : null,
      tiv_total:   row[7] !== '' ? Number(row[7]) : null,
    })
  }
  return result
}

// ── Sheet 5: Segment wise prediction - PTB ──────────────────────────
function parseJudgmentPtbSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  const headerRow = findHeaderRow(rows)
  if (headerRow === -1) return []

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    if (allSegmentsBlank(row)) continue
    result.push({
      month_label: meta.canonicalLabel,
      bus_pvt:     row[1] !== '' ? Number(row[1]) : null,
      haulage:     row[2] !== '' ? Number(row[2]) : null,
      mav:         row[3] !== '' ? Number(row[3]) : null,
      tractor:     row[4] !== '' ? Number(row[4]) : null,
      tipper:      row[5] !== '' ? Number(row[5]) : null,
      icv_trucks:  row[6] !== '' ? Number(row[6]) : null,
      total_sale:  row[7] !== '' ? Number(row[7]) : null,
    })
  }
  return result
}

// ── Sheet 6: Raw Data ────────────────────────────────────────────────
// Wide pivot: row 0 = month headers (merged cells), row 1 = column sub-labels
// segment total rows at indices in RAW_SEGMENT_ROWS
// NOTE: scan ALL columns in row 0 for month labels — don't rely on fixed stride
function parseRawDataSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  if (rows.length < 2) return { alActuals: [], rawRows: [] }

  // Scan rows 0-3 for month labels — robust to variable header structure
  // Cells may be text ("Apr-22") OR Excel date serials (44652) — handle both
  let months = []
  let monthRowIdx = -1
  for (let r = 0; r <= Math.min(4, rows.length - 1); r++) {
    const found = []
    for (let col = 0; col < rows[r].length; col++) {
      const raw = rows[r][col]
      const label = (typeof raw === 'number') ? excelSerialToLabel(raw) : String(raw).trim()
      if (!label) continue
      const meta = parseMonthLabel(label)
      if (meta) found.push({ label: meta.canonicalLabel || label, startCol: col, ...meta })
    }
    if (found.length > months.length) { months = found; monthRowIdx = r }
  }

  if (months.length === 0) return { alActuals: [], rawRows: [] }

  // Detect the AL column offset by scanning the row after months for sub-headers
  const subHeaderRow = rows[monthRowIdx + 1] || []
  let alOffset = RAW_COL_OFFSET.AL  // default from constants
  const firstStart = months[0].startCol
  for (let c = firstStart; c < firstStart + 15 && c < subHeaderRow.length; c++) {
    const h = String(subHeaderRow[c] || '').trim().toUpperCase()
    if (h === 'AL') { alOffset = c - firstStart; break }
  }

  // AL actuals: read the AL column at each segment total row for each month.
  // A month header can exist while its AL cells are still empty (the AL/LM
  // split lags the TIV data). Emitting a zero row for those months advanced
  // lastAlMonth to match last_data_month, which SILENTLY HID the "AL share as
  // of …" staleness chip — the one safeguard against a stale share cascade —
  // and dragged al_share_recent toward the floor. Only emit a month that
  // actually carries AL data.
  const alActuals = []
  for (const m of months) {
    const row = { month_label: m.label, month_index: m.month_index }
    let hasData = false
    for (const seg of SEGMENTS) {
      const segRow = rows[RAW_SEGMENT_ROWS[seg]] || []
      const cell = segRow[m.startCol + alOffset]
      if (!isBlank(cell)) hasData = true
      row[SEG_COL[seg]] = Number(cell) || 0
    }
    if (hasData) alActuals.push(row)
  }

  // Raw JSONB data: for each month, capture all segment rows using detected offsets
  const rawRows = months.map(m => {
    const data = {}
    for (const [segName, segRowIdx] of Object.entries(RAW_SEGMENT_ROWS)) {
      const segRow = rows[segRowIdx] || []
      data[segName] = {}
      for (const [colName, colOffset] of Object.entries(RAW_COL_OFFSET)) {
        data[segName][colName] = Number(segRow[m.startCol + colOffset]) || 0
      }
    }
    return {
      month_label: m.label,
      month_index: m.month_index,
      data,
    }
  })

  return { alActuals, rawRows }
}

// ── Template generator ───────────────────────────────────────────────
// Builds a blank Market_Data workbook from the SAME constants the parser
// reads (sheet order, month format, Raw-Data segment-row indices), so the
// template can never drift out of sync with what the import expects.
export function downloadMarketDataTemplate() {
  const wb = XLSX.utils.book_new()
  const segHeader = ['Month', ...SEGMENTS]

  const meta = XLSX.utils.aoa_to_sheet([
    ['Market Data template — how to fill'],
    [],
    ['1. Keep the sheets in this order: Metadata, TIV actuals, PTB actuals, TIV judgment, PTB judgment, Raw Data.'],
    ['2. Months go in the first column, one row per month, written as Apr-22, May-22, … (3-letter month, dash, 2-digit year).'],
    ['3. Actuals sheets take whole numbers. The judgment (prediction) sheets are optional — leave them empty if there is no manual forecast.'],
    ['4. Raw Data: replace <Apr-22> in the top row with the real month, then add further months to the right — 10 columns per month (AL PTB LM TML EML M&M BB Others TIV MS%) plus one blank spacer column.'],
    ['5. Raw Data: the six segment TOTAL rows are pre-placed on exact rows the system reads — do not insert or delete rows above or between them.'],
  ])
  meta['!cols'] = [{ wch: 118 }]
  XLSX.utils.book_append_sheet(wb, meta, 'Metadata')

  const tiv = XLSX.utils.aoa_to_sheet([[...segHeader, 'TIV']])
  tiv['!cols'] = segHeader.map(() => ({ wch: 12 }))
  XLSX.utils.book_append_sheet(wb, tiv, 'Segment wise data - TIV')

  const ptb = XLSX.utils.aoa_to_sheet([[...segHeader, 'Total Sale']])
  ptb['!cols'] = segHeader.map(() => ({ wch: 12 }))
  XLSX.utils.book_append_sheet(wb, ptb, 'Segment wise data - PTB')

  const judgTiv = XLSX.utils.aoa_to_sheet([[...segHeader, 'TIV']])
  XLSX.utils.book_append_sheet(wb, judgTiv, 'Segment wise prediction - TIV')

  const judgPtb = XLSX.utils.aoa_to_sheet([[...segHeader, 'Total Sale']])
  XLSX.utils.book_append_sheet(wb, judgPtb, 'Segment wise prediction - PTB')

  // Raw Data skeleton — segment TOTAL rows pinned to the exact indices in
  // RAW_SEGMENT_ROWS. The <Apr-22> month placeholder is deliberately angle-
  // bracketed so parseMonthLabel() ignores it until replaced with a real month.
  const maxRow = Math.max(...Object.values(RAW_SEGMENT_ROWS))
  const raw = Array.from({ length: maxRow + 1 }, () => [''])
  raw[0] = ['Segment ↓', '<Apr-22>']
  raw[1] = ['', ...Object.keys(RAW_COL_OFFSET)]
  raw[2] = ['(sub-model rows may go between the TOTAL rows — totals must stay on their pre-placed rows)']
  for (const [seg, idx] of Object.entries(RAW_SEGMENT_ROWS)) raw[idx][0] = `${seg} — TOTAL`
  const rawWs = XLSX.utils.aoa_to_sheet(raw)
  rawWs['!cols'] = [{ wch: 24 }, ...Object.keys(RAW_COL_OFFSET).map(() => ({ wch: 9 }))]
  XLSX.utils.book_append_sheet(wb, rawWs, 'Raw Data')

  XLSX.writeFile(wb, 'Market_Data_Template.xlsx')
}

// ── Main export ──────────────────────────────────────────────────────
// Sheets were addressed purely by position, so a scratch sheet inserted
// anywhere before position 5 — the other reflex of a spreadsheet user — made
// the parser read the wrong sheet and then blame the right one. Match by name
// first; fall back to position, but say so.
const SHEET_NAMES = {
  tiv:      'Segment wise data - TIV',
  ptb:      'Segment wise data - PTB',
  judgTiv:  'Segment wise prediction - TIV',
  judgPtb:  'Segment wise prediction - PTB',
  raw:      'Raw Data',
}

function resolveSheet(wb, canonical, fallbackIdx, warnings) {
  const hit = wb.SheetNames.find(n => norm(n) === norm(canonical))
  if (hit) return wb.Sheets[hit]
  const fallbackName = wb.SheetNames[fallbackIdx]
  if (!fallbackName) {
    throw new Error(`Cannot find a sheet named "${canonical}", and there is no sheet at position ${fallbackIdx + 1}.`)
  }
  warnings.push(`No sheet named "${canonical}" — read "${fallbackName}" (position ${fallbackIdx + 1}) instead.`)
  return wb.Sheets[fallbackName]
}

export function parseExcelFile(arrayBuffer, now = new Date()) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false, raw: true })
  const sheetNames = wb.SheetNames
  const warnings = []

  // Sheet order by position: 0=Metadata, 1=TIV, 2=PTB, 3=JudgTIV, 4=JudgPTB, 5=RawData
  if (sheetNames.length < 6) {
    throw new Error(
      `Expected 6 sheets, found ${sheetNames.length} (${sheetNames.join(', ') || 'none'}). Check the file format.`
    )
  }

  const tivActuals  = parseTivSheet(resolveSheet(wb, SHEET_NAMES.tiv, 1, warnings), warnings)
  const ptbActuals  = parsePtbSheet(resolveSheet(wb, SHEET_NAMES.ptb, 2, warnings))
  const judgmentTiv = parseJudgmentTivSheet(resolveSheet(wb, SHEET_NAMES.judgTiv, 3, warnings))
  const judgmentPtb = parseJudgmentPtbSheet(resolveSheet(wb, SHEET_NAMES.judgPtb, 4, warnings))
  const { alActuals, rawRows } = parseRawDataSheet(resolveSheet(wb, SHEET_NAMES.raw, 5, warnings))

  if (tivActuals.length === 0) throw new Error('TIV sheet: no month rows with data were found.')

  // Pick the latest month by INDEX. Sheet order is not guaranteed, and the
  // label is text — 'May-26' sorts above 'Jul-26'.
  const latest = tivActuals.reduce((a, b) => (a.month_index > b.month_index ? a : b))

  // A month that has not happened yet cannot have actuals. This is the second
  // half of the pre-typed-future-month guard: blank rows are dropped above, but
  // a row of real-looking zeros typed ahead would still sail through.
  const nowIst = currentIstMonth(now)
  if (monthCursor(latest.year, latest.month_num) > monthCursor(nowIst.year, nowIst.month_num)) {
    throw new Error(
      `TIV sheet: the last month with data is ${latest.month_label}, which is in the future. ` +
      'Remove the rows for months that have not closed yet.'
    )
  }

  if (alActuals.length === 0) warnings.push('Raw Data sheet: no AL figures were found — the AL and PTB share layers cannot be updated.')

  return {
    tivActuals,
    ptbActuals,
    judgmentTiv,
    judgmentPtb,
    alActuals,
    rawRows,
    summary: {
      monthsLoaded: tivActuals.length,
      lastDataMonth: latest.month_label,
      warnings,
      // Per-sheet counts: a preview that only reports TIV cannot reveal that a
      // sheet parsed to nothing, which is how the AL layer froze silently.
      counts: {
        tiv:       tivActuals.length,
        ptb:       ptbActuals.length,
        al:        alActuals.length,
        judgTiv:   judgmentTiv.length,
        judgPtb:   judgmentPtb.length,
        raw:       rawRows.length,
      },
      lastAlMonth: alActuals.length
        ? alActuals.reduce((a, b) => (a.month_index > b.month_index ? a : b)).month_label
        : null,
    },
  }
}
