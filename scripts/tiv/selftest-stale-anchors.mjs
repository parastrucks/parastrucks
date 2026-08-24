// Self-test for audit finding A1: once the calendar rolls past the trained
// anchors without a new upload, the forecast used to render bold ZEROS (ROB)
// and plausible ~60%-low numbers (THETA) instead of admitting it had nothing.
//
// Trains on the REAL workbook, then stands at chosen dates and inspects what
// the shipped engine produces. Usage:
//   node scripts/tiv/selftest-stale-anchors.mjs "<path to Market Data 22-27.xlsx>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'
import { runForecast } from '../../src/tiv-forecast/lib/forecastEngine.js'
import { buildDefaultTriggerState } from '../../src/tiv-forecast/lib/triggerDefs.js'
import { SEGMENTS, V3_METHOD } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const buf = fs.readFileSync(process.argv[2])
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
const triggers = buildDefaultTriggerState()

console.log(`Trained through ${params.last_data_month}; anchors for: ${Object.keys(params.smly_plain).join(', ')}\n`)

function report(when, label) {
  const res = runForecast(params, triggers, new Date(when))
  const months = res.forecastMonths.map(f => f.label)
  console.log(`--- ${label} (${when.slice(0, 10)}) — columns: ${months.join(', ')} ---`)
  console.log(`    staleMonths: [${res.staleMonths.join(', ')}]`)
  for (const fm of res.forecastMonths) {
    const idx = months.indexOf(fm.label)
    const cells = SEGMENTS.map(s => {
      const v = res.bySegment[s][idx].tiv
      return `${V3_METHOD[s] === 'ROB' ? 'R' : V3_METHOD[s] === 'THETA' ? 'T' : 'A'}:${v === null ? '—' : v}`
    })
    const tot = res.totals[idx].tiv
    console.log(`    ${fm.label}  ${cells.join(' ')}  TOTAL ${tot === null ? '—' : tot}`)
  }
  return res
}

console.log('=== Today: anchors cover the window (regression check) ===')
{
  const res = report('2026-08-25T06:00:00Z', 'today')
  ok('no stale months', res.staleMonths.length === 0, res.staleMonths.join(','))
  ok('Aug-26 total is 736', res.totals[0].tiv === 736, String(res.totals[0].tiv))
  ok('every cell is a real number', SEGMENTS.every(s => res.bySegment[s].every(c => c.tiv !== null)))
}

console.log('\n=== 1 Sep 2026: window rolls to Sep/Oct/NOV — Nov has no anchor ===')
{
  const res = report('2026-09-01T06:00:00Z', 'one week from today')
  ok('Nov-26 reported stale', res.staleMonths.includes('Nov-26'), res.staleMonths.join(','))
  const novIdx = res.forecastMonths.findIndex(f => f.label === 'Nov-26')
  ok('no segment renders a number for Nov-26',
    SEGMENTS.every(s => res.bySegment[s][novIdx].tiv === null))
  ok('NO ZERO anywhere (the old ROB behaviour)',
    SEGMENTS.every(s => res.bySegment[s][novIdx].tiv !== 0))
  ok('Nov-26 total is null, not a partial sum', res.totals[novIdx].tiv === null, String(res.totals[novIdx].tiv))
  ok('Sep/Oct-26 still forecast normally',
    res.totals[0].tiv === 779 && res.totals[1].tiv === 850,
    `${res.totals[0].tiv}/${res.totals[1].tiv}`)
  ok('AL/PTB cascade also null (not Math.round(null*share)=0)',
    SEGMENTS.every(s => res.bySegment[s][novIdx].al === null && res.bySegment[s][novIdx].ptb === null))
}

console.log('\n=== 1 Nov 2026: the whole window is past the anchors ===')
{
  const res = report('2026-11-01T06:00:00Z', 'three months from today')
  ok('all three months stale', res.staleMonths.length === 3, res.staleMonths.join(','))
  ok('nothing renders as a number', res.totals.every(t => t.tiv === null))
  ok('no zeros anywhere', SEGMENTS.every(s => res.bySegment[s].every(c => c.tiv !== 0)))
}

console.log('\n=== IST boundary: 31 Aug 20:00 UTC is already 1 Sep in India ===')
{
  const before = runForecast(params, triggers, new Date('2026-08-31T17:00:00Z')) // 22:30 IST 31 Aug
  const after  = runForecast(params, triggers, new Date('2026-08-31T19:00:00Z')) // 00:30 IST 1 Sep
  ok('22:30 IST on 31 Aug still starts at Aug-26', before.forecastMonths[0].label === 'Aug-26',
    before.forecastMonths[0].label)
  ok('00:30 IST on 1 Sep starts at Sep-26', after.forecastMonths[0].label === 'Sep-26',
    after.forecastMonths[0].label)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
