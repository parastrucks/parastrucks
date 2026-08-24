// Self-tests for the 2026-08-25 parser hardening (audit findings A2, A6, A8).
// Builds synthetic workbooks in memory — no fixture files, no network, no DB.
// Usage: node scripts/tiv/selftest-parser.mjs
import * as XLSX from 'xlsx'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { SEGMENTS, RAW_SEGMENT_ROWS, RAW_COL_OFFSET } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const throws = (name, fn, match) => {
  try { fn(); fail++; console.log(`  FAIL  ${name} — expected a throw, got none`) }
  catch (e) {
    if (!match || e.message.includes(match)) { pass++; console.log(`  PASS  ${name}\n          → "${e.message}"`) }
    else { fail++; console.log(`  FAIL  ${name} — wrong message: "${e.message}"`) }
  }
}

const SEG_HEADER = ['Month', ...SEGMENTS]

// Build a workbook. `tivRows`/`ptbRows` are arrays of [label, ...6 values, total].
// `alMonths` = [{label, values:[6] | null}] — null means the month header exists
// but every AL cell is blank.
function build({ tivRows, ptbRows = tivRows, judgRows = [], alMonths = [], sheetNames, headerOverride }) {
  const wb = XLSX.utils.book_new()
  const names = sheetNames || [
    'Metadata', 'Segment wise data - TIV', 'Segment wise data - PTB',
    'Segment wise prediction - TIV', 'Segment wise prediction - PTB', 'Raw Data',
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['meta']]), names[0])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headerOverride || [...SEG_HEADER, 'TIV'], ...tivRows]), names[1])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'Total Sale'], ...ptbRows]), names[2])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'TIV'], ...judgRows]), names[3])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'Total Sale']]), names[4])

  // Raw Data: month headers across the top, segment TOTAL rows at pinned indices.
  const maxRow = Math.max(...Object.values(RAW_SEGMENT_ROWS))
  const raw = Array.from({ length: maxRow + 1 }, () => [''])
  const cols = Object.keys(RAW_COL_OFFSET)
  raw[0] = ['Segment']
  raw[1] = ['']
  alMonths.forEach((m, mi) => {
    const start = 1 + mi * (cols.length + 1)
    raw[0][start] = m.label
    cols.forEach((c, ci) => { raw[1][start + ci] = c })
    SEGMENTS.forEach((seg, si) => {
      const r = RAW_SEGMENT_ROWS[seg]
      while (raw[r].length < start + cols.length) raw[r].push('')
      raw[r][start + RAW_COL_OFFSET.AL] = m.values ? m.values[si] : ''
    })
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(raw), names[5])
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

const row = (label, v, total) => [label, ...v, total ?? v.reduce((a, b) => a + b, 0)]
const blankRow = label => [label, '', '', '', '', '', '', '']
const SIX = [10, 20, 30, 40, 50, 60]
const base = [row('Apr-25', SIX), row('May-25', SIX), row('Jun-25', SIX)]

console.log('\n=== A2a: pre-typed future months (blank cells) ===')
{
  const wb = build({ tivRows: [...base, blankRow('Jul-25'), blankRow('Aug-25')], alMonths: [] })
  const p = parseExcelFile(wb, new Date('2026-08-25T00:00:00Z'))
  ok('all-blank month rows are dropped', p.tivActuals.length === 3, `got ${p.tivActuals.length}`)
  ok('lastDataMonth is the last month with data', p.summary.lastDataMonth === 'Jun-25', p.summary.lastDataMonth)
}

console.log('\n=== genuine zeros survive (the 2022 PTB ramp-up) ===')
{
  const zeros = row('Apr-25', [0, 0, 0, 0, 0, 0])
  const wb = build({ tivRows: [zeros, row('May-25', SIX)], alMonths: [] })
  const p = parseExcelFile(wb, new Date('2026-08-25T00:00:00Z'))
  ok('a real all-zero month is KEPT', p.tivActuals.length === 2, `got ${p.tivActuals.length}`)
  ok('its values are zero, not dropped', p.tivActuals[0].bus_pvt === 0)
}

console.log('\n=== A2a: actuals dated in the future are refused ===')
throws('future last month rejected',
  () => parseExcelFile(build({ tivRows: [...base, row('Mar-27', SIX)], alMonths: [] }), new Date('2026-08-25T00:00:00Z')),
  'in the future')

console.log('\n=== A2b: blank AL cells must not create zero AL rows ===')
{
  const wb = build({
    tivRows: base,
    alMonths: [
      { label: 'Apr-25', values: [1, 2, 3, 4, 5, 6] },
      { label: 'May-25', values: null },   // header present, cells blank
      { label: 'Jun-25', values: null },
    ],
  })
  const p = parseExcelFile(wb, new Date('2026-08-25T00:00:00Z'))
  ok('AL months with no data are not emitted', p.alActuals.length === 1, `got ${p.alActuals.length}`)
  ok('lastAlMonth stays at the real AL data', p.summary.lastAlMonth === 'Apr-25', String(p.summary.lastAlMonth))
  ok('=> staleness chip would SHOW (lastAl !== lastData)',
    p.summary.lastAlMonth !== p.summary.lastDataMonth)
}

console.log('\n=== A8: an inserted column is caught, not silently mis-bucketed ===')
throws('shifted segment headers rejected',
  () => parseExcelFile(build({
    tivRows: base, alMonths: [],
    headerOverride: ['Month', 'Notes', ...SEGMENTS, 'TIV'],
  }), new Date('2026-08-25T00:00:00Z')),
  'should be "Bus PVT" but found "Notes"')

console.log('\n=== A8: sheets are found by name even when reordered ===')
{
  const names = ['Metadata', 'Segment wise data - TIV', 'Segment wise data - PTB',
    'Segment wise prediction - TIV', 'Segment wise prediction - PTB', 'Raw Data']
  const wb = XLSX.utils.book_new()
  // Insert a scratch sheet at position 1 — the classic Excel habit.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['meta']]), 'Metadata')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['scratch']]), 'Working')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'TIV'], ...base]), names[1])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'Total Sale'], ...base]), names[2])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'TIV']]), names[3])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...SEG_HEADER, 'Total Sale']]), names[4])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Segment']]), names[5])
  const p = parseExcelFile(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), new Date('2026-08-25T00:00:00Z'))
  ok('scratch sheet ignored, real TIV sheet read', p.tivActuals.length === 3, `got ${p.tivActuals.length}`)
}

console.log('\n=== A6: "April 2025" is canonicalised to Apr-25 ===')
{
  const wb = build({ tivRows: [row('April 2025', SIX), row('May-25', SIX)], alMonths: [] })
  const p = parseExcelFile(wb, new Date('2026-08-25T00:00:00Z'))
  ok('stored label is canonical', p.tivActuals[0].month_label === 'Apr-25', p.tivActuals[0].month_label)
}

console.log('\n=== reconciliation mismatch is warned, not fatal ===')
{
  const wb = build({ tivRows: [row('Apr-25', SIX, 999), row('May-25', SIX)], alMonths: [] })
  const p = parseExcelFile(wb, new Date('2026-08-25T00:00:00Z'))
  ok('warning raised', p.summary.warnings.some(w => w.includes('Total column says 999')),
    JSON.stringify(p.summary.warnings))
  ok('rows still parsed', p.tivActuals.length === 2)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
