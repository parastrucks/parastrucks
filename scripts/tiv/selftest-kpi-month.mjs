// Self-test for the summary-row month rule (owner, 2026-08-25):
// "if today's date is >19th show next month forecast on the summary row".
// Usage: node scripts/tiv/selftest-kpi-month.mjs "<workbook>"
import fs from 'node:fs'
import { parseExcelFile } from '../../src/tiv-forecast/lib/parseExcel.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'
import { runForecast } from '../../src/tiv-forecast/lib/forecastEngine.js'
import { buildDefaultTriggerState } from '../../src/tiv-forecast/lib/triggerDefs.js'
import { currentIstMonth, shouldLeadWithNextMonth, NEXT_MONTH_FROM_DAY } from '../../src/tiv-forecast/lib/istMonth.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

// Mirrors the page's selection so the rule is exercised, not just the predicate.
function kpiIndex(totals, now) {
  if (!totals?.length) return 0
  if (!shouldLeadWithNextMonth(now) || totals.length < 2) return 0
  return totals[1].tiv === null || totals[1].tiv === undefined ? 0 : 1
}

console.log(`Switch day: after the ${NEXT_MONTH_FROM_DAY}th\n`)

console.log('=== the boundary is the 19th/20th, in IST ===')
ok('19th leads with the current month',  !shouldLeadWithNextMonth(new Date('2026-08-19T06:00:00Z')))
ok('20th leads with next month',          shouldLeadWithNextMonth(new Date('2026-08-20T06:00:00Z')))
ok('1st leads with the current month',   !shouldLeadWithNextMonth(new Date('2026-08-01T06:00:00Z')))
ok('31st leads with next month',          shouldLeadWithNextMonth(new Date('2026-08-31T06:00:00Z')))
// 19 Aug 20:00 UTC is already 20 Aug 01:30 in India.
ok('19 Aug 20:00 UTC counts as the 20th in IST',
  shouldLeadWithNextMonth(new Date('2026-08-19T20:00:00Z')),
  JSON.stringify(currentIstMonth(new Date('2026-08-19T20:00:00Z'))))
ok('19 Aug 17:00 UTC is still the 19th in IST',
  !shouldLeadWithNextMonth(new Date('2026-08-19T17:00:00Z')),
  JSON.stringify(currentIstMonth(new Date('2026-08-19T17:00:00Z'))))

const buf = fs.readFileSync(process.argv[2])
const parsed = parseExcelFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const params = retrainModel(parsed.tivActuals, parsed.ptbActuals, parsed.alActuals)

console.log('\n=== against the real trained model ===')
{
  // Early in August: window is Aug/Sep/Oct-26, lead with Aug.
  const early = runForecast(params, buildDefaultTriggerState(), new Date('2026-08-05T06:00:00Z'))
  const iEarly = kpiIndex(early.totals, new Date('2026-08-05T06:00:00Z'))
  ok('5 Aug leads with Aug-26', early.totals[iEarly].month === 'Aug-26', early.totals[iEarly].month)
  ok('and it is the verified 736', early.totals[iEarly].tiv === 736, String(early.totals[iEarly].tiv))

  // Today (25 Aug): still Aug/Sep/Oct-26, but lead with Sep.
  const late = runForecast(params, buildDefaultTriggerState(), new Date('2026-08-25T06:00:00Z'))
  const iLate = kpiIndex(late.totals, new Date('2026-08-25T06:00:00Z'))
  ok('25 Aug leads with Sep-26', late.totals[iLate].month === 'Sep-26', late.totals[iLate].month)
  ok('and it is the verified 779', late.totals[iLate].tiv === 779, String(late.totals[iLate].tiv))
  ok('the table itself is unchanged — still three months',
    late.forecastMonths.length === 3 && late.totals[0].month === 'Aug-26')
}

console.log('\n=== a stale next month falls back rather than showing a dash ===')
{
  // 20 Oct: window is Oct/Nov/Dec-26; only Oct has an anchor.
  const when = new Date('2026-10-20T06:00:00Z')
  const stale = runForecast(params, buildDefaultTriggerState(), when)
  const i = kpiIndex(stale.totals, when)
  ok('past the 19th but next month is stale', stale.totals[1].tiv === null)
  ok('falls back to the month that has a number', i === 0 && stale.totals[i].tiv !== null,
    `idx ${i}, value ${stale.totals[i]?.tiv}`)
  console.log(`    leads with ${stale.totals[i].month} = ${stale.totals[i].tiv}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
