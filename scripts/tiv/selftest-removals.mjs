// The removal preview is a promise about what will be deleted. It must apply the
// SAME rule tiv_upload_and_prune() applies: per table, a stored month the
// incoming payload for THAT table does not contain.
// Usage: node scripts/tiv/selftest-removals.mjs   (bundle with esbuild first)
import { computeRemovals, REMOVAL_TABLES } from '../../src/tiv-forecast/lib/uploadDiff.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  PASS  ${label} -> ${JSON.stringify(got)}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`) }
}
const rows = labels => labels.map(month_label => ({ month_label }))
// A parsed workbook shaped like the real one: 52 actual months, 14 judgment.
const months52 = Array.from({ length: 52 }, (_, i) => `M${String(i).padStart(2, '0')}`)
const months14 = months52.slice(38)
const parsed = () => ({
  tivActuals: rows(months52), ptbActuals: rows(months52), alActuals: rows(months52),
  judgmentTiv: rows(months14), judgmentPtb: rows(months14), rawRows: rows(months52),
})
const stored = (over = {}) => ({
  tiv_forecast_tiv_actuals: [...months52], tiv_forecast_ptb_actuals: [...months52],
  tiv_forecast_al_actuals: [...months52], tiv_forecast_judgment_tiv: [...months14],
  tiv_forecast_judgment_ptb: [...months14], tiv_forecast_raw_data: [...months52],
  ...over,
})

console.log('=== the file matches the database ===')
check('nothing to remove', computeRemovals(parsed(), stored()).total, 0)
check('no tables listed', computeRemovals(parsed(), stored()).byTable.length, 0)
check('not blocked', computeRemovals(parsed(), stored()).blocked, false)

console.log('\n=== per table, never global (the trap this must avoid) ===')
// Judgment legitimately holds only 14 of the 52 months. A global month set
// would propose deleting 38 judgment months that were never meant to exist.
const r1 = computeRemovals(parsed(), stored())
check('judgment is NOT proposed for removal', r1.byTable.find(t => t.table.includes('judgment')), undefined)

console.log('\n=== a month dropped from one sheet only ===')
const p2 = parsed(); p2.judgmentTiv = rows(months14.slice(0, 13))
const r2 = computeRemovals(p2, stored())
check('one row, from one table', r2.total, 1)
check('and it is the judgment table', r2.byTable[0].table, 'tiv_forecast_judgment_tiv')
check('naming the right month', r2.byTable[0].months, [months14[13]])
check('actuals untouched', r2.byTable.length, 1)

console.log('\n=== the real case: 12 ghost judgment rows ===')
const ghosts = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']
const r3 = computeRemovals(parsed(), stored({
  tiv_forecast_judgment_tiv: [...months14, ...ghosts],
  tiv_forecast_judgment_ptb: [...months14, ...ghosts],
}))
check('12 rows across two tables', r3.total, 12)
check('two tables listed', r3.byTable.length, 2)
check('six distinct months', r3.months.length, 6)
check('months are the ghosts', r3.months, ghosts)

console.log('\n=== an empty sheet proposes nothing and blocks ===')
const p4 = parsed(); p4.judgmentTiv = []
const r4 = computeRemovals(p4, stored())
check('blocked', r4.blocked, true)
check('proposes zero removals for the empty sheet', r4.total, 0)
const p5 = parsed(); p5.tivActuals = []
const r5 = computeRemovals(p5, stored())
check('an empty ACTUALS sheet also blocks', r5.blocked, true)
check('and proposes nothing', r5.total, 0)

console.log('\n=== a genuinely shorter file ===')
const p6 = parsed()
p6.tivActuals = rows(months52.slice(0, 50)); p6.rawRows = rows(months52.slice(0, 50))
const r6 = computeRemovals(p6, stored())
check('4 rows: 2 months x 2 tables', r6.total, 4)
check('two months', r6.months, months52.slice(50))

console.log('\n=== degenerate input never throws ===')
check('no parsed', computeRemovals(null, stored()).total, 0)
check('no parsed blocks', computeRemovals(null, stored()).blocked, true)
check('no stored', computeRemovals(parsed(), {}).total, 0)
check('no args at all', computeRemovals().total, 0)

console.log('\n=== the table map covers all six ===')
check('six tables', REMOVAL_TABLES.length, 6)
check('every table has a parsed key', REMOVAL_TABLES.every(t => t.key && t.table && t.label), true)
check('keys match parseExcelFile output',
  REMOVAL_TABLES.map(t => t.key).sort(),
  ['alActuals', 'judgmentPtb', 'judgmentTiv', 'ptbActuals', 'rawRows', 'tivActuals'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
