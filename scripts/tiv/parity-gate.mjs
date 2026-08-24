// Parity gate for the v3.0 port (docs/WEBSITE_BUILD_HANDOFF.md section 5).
// Runs the REAL shipped modules against the real workbook -- nothing reimplemented.
// Usage: node scripts/tiv/parity-gate.mjs "<path to Market Data 22-27.xlsx>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel }   from '../../src/tiv-forecast/lib/retrainModel.js'
import { runForecast }    from '../../src/tiv-forecast/lib/forecastEngine.js'
import { buildDefaultTriggerState } from '../../src/tiv-forecast/lib/triggerDefs.js'
import { SEGMENTS, SEG_COL } from '../../src/tiv-forecast/constants.js'

const file = process.argv[2]
const buf  = fs.readFileSync(file)
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

console.log(`Parsed: ${parsed.summary.monthsLoaded} months, last = ${parsed.summary.lastDataMonth}`)
console.log(`PTB rows ${parsed.ptbActuals.length} · AL rows ${parsed.alActuals.length} · judgment TIV ${parsed.judgmentTiv.length}`)

const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
console.log(`\nTrained through ${params.last_data_month} (${params.total_months} months)`)
console.log('yoy_t12:', Object.fromEntries(SEGMENTS.map(s => [s, +(params.yoy_t12[s]*100).toFixed(1) + '%'])))
console.log('adapt g:', JSON.stringify(params.adapt_params))

// All triggers OFF (v3 default) -- buildDefaultTriggerState now returns all off.
const triggers = buildDefaultTriggerState()
const anyOn = Object.values(triggers).filter(t => t.on)
console.log(`triggers on: ${anyOn.length} (expected 0)`)

const res = runForecast(params, triggers)

const EXPECT = {
  'Aug-26': [64, 109, 125, 88, 147, 203, 736],
  'Sep-26': [89, 184, 102, 92, 147, 165, 779],
  'Oct-26': [94, 159, 157, 92, 170, 178, 850],
}

let pass = 0, fail = 0
console.log('\n=== PARITY GATE (all triggers OFF) ===')
console.log('month    ' + SEGMENTS.map(s => s.slice(0,6).padStart(7)).join('') + '  TOTAL')
for (const fm of res.forecastMonths) {
  const got = SEGMENTS.map(s => res.bySegment[s].find(r => r.month === fm.label)?.tiv ?? 0)
  const tot = res.totals.find(t => t.month === fm.label)?.tiv ?? 0
  const row = [...got, tot]
  const want = EXPECT[fm.label]
  console.log(`${fm.label.padEnd(9)}` + got.map(v => String(v).padStart(7)).join('') + String(tot).padStart(7)
    + (want ? '' : '   (no expectation on file)'))
  if (want) {
    console.log(`  expect ` + want.slice(0,6).map(v => String(v).padStart(7)).join('') + String(want[6]).padStart(7))
    const ok = row.every((v, i) => v === want[i])
    const diff = row.map((v,i) => v - want[i])
    console.log(`  ${ok ? 'PASS' : 'FAIL  delta ' + JSON.stringify(diff)}`)
    ok ? pass++ : fail++
  }
}

// Backtest gate: 12 rows, mean model error 26.4%
const bt = params.model_backtest || []
const actualMap = {}
for (const r of parsed.tivActuals) actualMap[r.month_label] = r
let errs = []
for (const row of bt) {
  const a = actualMap[row.month_label]; if (!a) continue
  for (const seg of SEGMENTS) {
    const av = Number(a[SEG_COL[seg]]) || 0
    const mv = Number(row[SEG_COL[seg]]) || 0
    if (av > 0) errs.push(Math.abs(mv - av) / av)
  }
}
const mape = errs.length ? errs.reduce((x,y)=>x+y,0)/errs.length*100 : NaN
console.log(`\n=== BACKTEST GATE ===`)
console.log(`rows: ${bt.length} (expect 12)  ${bt.length===12?'PASS':'FAIL'}`)
console.log(`window: ${bt[0]?.month_label} .. ${bt[bt.length-1]?.month_label}`)
console.log(`mean segment MAPE: ${mape.toFixed(1)}% (expect 26.4%)`)

console.log(`\nforward gates: ${pass} passed, ${fail} failed`)
