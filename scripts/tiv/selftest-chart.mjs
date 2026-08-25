// Self-test for the segment chart series — the REAL builder the tab uses.
// Covers the two defects the owner's screenshot showed: a line that fell to
// zero after the last real month, and month labels appearing twice on the axis.
// Usage: node scripts/tiv/selftest-chart.mjs "<workbook>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'
import { runForecast } from '../../src/tiv-forecast/lib/forecastEngine.js'
import { buildDefaultTriggerState } from '../../src/tiv-forecast/lib/triggerDefs.js'
import { buildSegmentChartData, buildShareSeries } from '../../src/tiv-forecast/lib/chartData.js'
import { SEGMENTS } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const buf = fs.readFileSync(process.argv[2])
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)
const res = runForecast(params, buildDefaultTriggerState(), new Date('2026-08-25T06:00:00Z'))

console.log(`Actuals end ${parsed.summary.lastDataMonth}; forecast starts ${res.forecastMonths[0].label} (horizon ${res.forecastMonths[0].horizon})\n`)

console.log('=== every month appears exactly once on the axis ===')
for (const seg of SEGMENTS) {
  const data = buildSegmentChartData(parsed.tivActuals, parsed.ptbActuals, seg, res)
  const labels = data.map(d => d.month)
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
  ok(`${seg}: no duplicate month categories`, dupes.length === 0, dupes.join(','))
}

console.log('\n=== history hands over to forecast without a hole ===')
{
  const data = buildSegmentChartData(parsed.tivActuals, parsed.ptbActuals, 'Bus PVT', res)
  const lastActualIdx = data.findIndex(d => d.month === parsed.summary.lastDataMonth)
  const handover = data[lastActualIdx]
  const firstFcst = data[lastActualIdx + 1]
  ok('the last actual month also carries a forecast point',
    handover['TIV Fcst'] === handover.TIV && handover['TIV Fcst'] !== null,
    JSON.stringify(handover))
  ok('PTB hands over too', handover['PTB Fcst'] === handover.PTB)
  ok('the next row is the first forecast month',
    firstFcst?.month === res.forecastMonths[0].label, firstFcst?.month)
  ok('forecast rows carry no actual', firstFcst?.TIV === null && firstFcst?.PTB === null)
  console.log(`    handover at ${handover.month}: actual ${handover.TIV}, forecast starts ${handover['TIV Fcst']} -> ${firstFcst['TIV Fcst']}`)
}

console.log('\n=== nothing trails off to zero after the last real month ===')
for (const seg of SEGMENTS) {
  const data = buildSegmentChartData(parsed.tivActuals, parsed.ptbActuals, seg, res)
  const lastActualIdx = data.findIndex(d => d.month === parsed.summary.lastDataMonth)
  const after = data.slice(lastActualIdx + 1)
  ok(`${seg}: no zero actuals after ${parsed.summary.lastDataMonth}`,
    after.every(d => d.TIV === null), JSON.stringify(after.map(d => d.TIV)))
}

console.log('\n=== a stale model is NOT bridged (the gap there is real) ===')
{
  // Stand three months later: the window runs ahead of the trained anchors.
  const stale = runForecast(params, buildDefaultTriggerState(), new Date('2026-11-01T06:00:00Z'))
  const data = buildSegmentChartData(parsed.tivActuals, parsed.ptbActuals, 'Bus PVT', stale)
  const lastActual = data.find(d => d.month === parsed.summary.lastDataMonth)
  ok('horizon is greater than 1', stale.forecastMonths[0].horizon > 1, String(stale.forecastMonths[0].horizon))
  ok('no handover point is invented across a real gap',
    lastActual['TIV Fcst'] === undefined, JSON.stringify(lastActual))
}

console.log('\n=== genuine zeros survive, missing months stay missing ===')
{
  const data = buildSegmentChartData(parsed.tivActuals, parsed.ptbActuals, 'Bus PVT', res)
  const ptbZeroMonths = ['Apr-22', 'May-22', 'Jun-22', 'Jul-22', 'Aug-22', 'Oct-22']
  const kept = ptbZeroMonths.filter(m => data.find(d => d.month === m)?.PTB === 0)
  ok('the six 2022 PTB ramp-up zeros plot as zero, not as gaps', kept.length === 6, kept.join(','))
}

console.log('\n=== AL share series ===')
{
  const share = buildShareSeries(parsed.tivActuals, parsed.alActuals, 'Bus PVT')
  ok('share series is non-empty', share.length > 0, String(share.length))
  ok('no month is plotted without a known share', share.every(r => r['AL Share'] !== null))
  ok('every share is a sane percentage', share.every(r => r['AL Share'] >= 0 && r['AL Share'] <= 100))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
