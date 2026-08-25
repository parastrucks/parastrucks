// Self-test for the forecast-quality helpers (audit C2/C3/C4), against the
// REAL trained model — a range or a receipt that doesn't match the number it
// describes is worse than none.
// Usage: node scripts/tiv/selftest-quality.mjs "<workbook>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'
import { runForecast } from '../../src/tiv-forecast/lib/forecastEngine.js'
import { buildDefaultTriggerState } from '../../src/tiv-forecast/lib/triggerDefs.js'
import { forecastBand, toleranceOdds, explainForecast } from '../../src/tiv-forecast/lib/forecastQuality.js'
import { SEGMENTS, V3_METHOD } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const buf = fs.readFileSync(process.argv[2])
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
const res = runForecast(params, buildDefaultTriggerState(), new Date('2026-08-25T06:00:00Z'))
const backtest = params.model_backtest
const actuals = parsed.tivActuals
const first = res.forecastMonths[0].label

console.log(`Trained through ${params.last_data_month}; backtest rows ${backtest.length}; first forecast ${first}\n`)

console.log('=== ranges are built around the point, from real errors ===')
for (const seg of SEGMENTS) {
  const point = res.bySegment[seg][0].tiv
  const band = forecastBand(seg, point, backtest, actuals)
  const odds = toleranceOdds(seg, backtest, actuals)
  console.log(`  ${seg.padEnd(11)} ${String(point).padStart(4)}  range ${band ? `${band.low}–${band.high} (±${(band.spread*100).toFixed(0)}%)` : 'n/a'}   within tolerance ${odds ? `${odds.within}/${odds.total}` : 'n/a'}`)
  ok(`${seg}: range brackets the forecast`, band && band.low <= point && band.high >= point,
    band ? `${band.low}..${band.high} vs ${point}` : 'no band')
  ok(`${seg}: range is not absurd (spread < 100%)`, band && band.spread < 1, band ? String(band.spread) : 'no band')
  ok(`${seg}: tolerance odds within bounds`, odds && odds.within <= odds.total && odds.total > 0)
}

console.log('\n=== a missing point yields no range, not a fake one ===')
ok('null point -> null band', forecastBand('Haulage', null, backtest, actuals) === null)
ok('no backtest -> null band', forecastBand('Haulage', 100, [], actuals) === null)

console.log('\n=== the receipt reproduces the number it explains ===')
for (const seg of SEGMENTS) {
  const exp = explainForecast(seg, first, params)
  ok(`${seg}: receipt exists and names the right method`, exp && exp.method === V3_METHOD[seg],
    exp ? exp.method : 'null')
  if (exp && (exp.method === 'ROB' || exp.method === 'ADAPT')) {
    // The final step ends "= N"; N must equal the untriggered forecast.
    const shown = Number(exp.steps[exp.steps.length - 1].split('=').pop().trim())
    const actual = res.bySegment[seg][0].tiv
    ok(`${seg}: receipt arithmetic matches the displayed forecast`, Math.abs(shown - actual) <= 1,
      `receipt ${shown} vs displayed ${actual}`)
  }
}
console.log('\n  (THETA receipts describe the blend in words rather than restating it,')
console.log('   because the trend term is not a figure the reader can check by hand.)')
console.log('\n  Sample receipt — Bus PVT:')
for (const s of explainForecast('Bus PVT', first, params).steps) console.log(`    · ${s}`)

console.log('\n=== a month with no anchor has no receipt ===')
ok('unknown month -> null', explainForecast('Bus PVT', 'Nov-26', params) === null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
