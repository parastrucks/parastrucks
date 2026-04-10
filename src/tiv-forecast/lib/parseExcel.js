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

  // DEBUG: log first 3 rows to see actual sheet structure
  console.log('[parseRawDataSheet] total rows:', rows.length)
  console.log('[parseRawDataSheet] row0 (first 20 cells):', (rows[0] || []).slice(0, 20))
  console.log('[parseRawDataSheet] row1 (first 20 cells):', (rows[1] || []).slice(0, 20))
  console.log('[parseRawDataSheet] row2 (first 20 cells):', (rows[2] || []).slice(0, 20))

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

  console.log('[parseRawDataSheet] months found:', months.length, 'in row', monthRowIdx, months.slice(0, 3).map(m => m.label))

  if (months.length === 0) return { alActuals: [], rawRows: [] }

  // Detect the AL column offset by scanning the row after months for sub-headers
  const subHeaderRow = rows[monthRowIdx + 1] || []
  console.log('[parseRawDataSheet] subheader row', monthRowIdx + 1, '(first 20):', subHeaderRow.slice(0, 20))
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
