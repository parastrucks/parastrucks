// TIV Forecast — Excel parser (migration spec Section 3)
// Parses the 6-sheet Market_Data_YY-YY.xlsx workbook into structured arrays.
import * as XLSX from 'xlsx'
import { SEGMENTS, SEG_COL, RAW_SEGMENT_ROWS, RAW_COLS_PER_MONTH, RAW_COL_OFFSET } from '../constants'

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

// ── Sheet 2: Segment wise data - TIV ────────────────────────────────
// Columns: Month | Bus PVT | Haulage | MAV | Tractor | Tipper | ICV Trucks | TIV
function parseTivSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true })
  // Find header row
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) { headerRow = i; break }
  }
  if (headerRow === -1) throw new Error('TIV sheet: cannot find header row')

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    result.push({
      month_label: label,
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
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) { headerRow = i; break }
  }
  if (headerRow === -1) throw new Error('PTB sheet: cannot find header row')

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    const meta = parseMonthLabel(label)
    if (!meta) continue
    result.push({
      month_label: label,
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
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) { headerRow = i; break }
  }
  if (headerRow === -1) return []  // Optional sheet

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    if (!parseMonthLabel(label)) continue
    result.push({
      month_label: label,
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
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().includes('month')) { headerRow = i; break }
  }
  if (headerRow === -1) return []

  const result = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const label = String(row[0]).trim()
    if (!label) continue
    if (!parseMonthLabel(label)) continue
    result.push({
      month_label: label,
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

  // AL actuals: read the AL column at each segment total row for each month
  const alActuals = months.map(m => {
    const row = {
      month_label: m.label,
      month_index: m.month_index,
    }
    for (const seg of SEGMENTS) {
      const segRowIdx = RAW_SEGMENT_ROWS[seg]
      const segRow = rows[segRowIdx] || []
      row[SEG_COL[seg]] = Number(segRow[m.startCol + alOffset]) || 0
    }
    return row
  })

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
export function parseExcelFile(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellDates: false, raw: true })
  const sheetNames = wb.SheetNames

  // Sheet index by position: 0=Metadata, 1=TIV, 2=PTB, 3=JudgTIV, 4=JudgPTB, 5=RawData
  if (sheetNames.length < 6) {
    throw new Error(`Expected 6 sheets, found ${sheetNames.length}. Check the file format.`)
  }

  const tivActuals     = parseTivSheet(wb.Sheets[sheetNames[1]])
  const ptbActuals     = parsePtbSheet(wb.Sheets[sheetNames[2]])
  const judgmentTiv    = parseJudgmentTivSheet(wb.Sheets[sheetNames[3]])
  const judgmentPtb    = parseJudgmentPtbSheet(wb.Sheets[sheetNames[4]])
  const { alActuals, rawRows } = parseRawDataSheet(wb.Sheets[sheetNames[5]])

  const lastMonth = tivActuals.length > 0 ? tivActuals[tivActuals.length - 1].month_label : '?'

  return {
    tivActuals,
    ptbActuals,
    judgmentTiv,
    judgmentPtb,
    alActuals,
    rawRows,
    summary: {
      monthsLoaded: tivActuals.length,
      lastDataMonth: lastMonth,
    },
  }
}
