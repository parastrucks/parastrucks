// The previous-vintage ghost line answers "is this view steady, or does it swing
// every retrain?". Several things can quietly make it lie, and every one of them
// is a row that actually sits in production:
//   - a re-upload writes a new params row with identical inputs (prod holds
//     three for Jul-26), so "the second row" compares a model against itself;
//   - a row stamped 'Mar-27' is residue from the 2026-08-21 parser reading
//     pre-typed future months as data - newer by trained_at, different by
//     month, and completely wrong to compare against;
//   - anything from before v3.0 carries no anchors, so replaying it draws
//     nothing while the legend claims a comparison;
//   - replaying at today's horizons instead of the ones it originally had
//     changes the numbers, because horizon feeds the damped trend in THETA.
// Usage: node scripts/tiv/selftest-vintage.mjs   (bundle with esbuild first)
import { previousVintage, vintageAsOf } from '../../src/tiv-forecast/lib/vintage.js'
import { buildSegmentChartData, hasVintageOverlap } from '../../src/tiv-forecast/lib/chartData.js'
import { currentIstMonth } from '../../src/tiv-forecast/lib/istMonth.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  PASS  ${label} -> ${JSON.stringify(got)}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`) }
}
// A replayable v3 vintage carries anchors; preV3 mimics an older row.
const v     = (last, trained) => ({ last_data_month: last, trained_at: trained, smly_robust: { X: {} } })
const preV3 = (last, trained) => ({ last_data_month: last, trained_at: trained })

console.log('=== picking the previous vintage ===')
check('plain previous when they differ',
  previousVintage([v('Jul-26', 'b'), v('Jun-26', 'a')], v('Jul-26'))?.last_data_month, 'Jun-26')
check('skips a re-upload of the SAME data month',
  previousVintage([v('Jul-26', 'c'), v('Jul-26', 'b'), v('Jun-26', 'a')], v('Jul-26'))?.last_data_month, 'Jun-26')
check('skips a LATER last_data_month (the Mar-27 parser residue)',
  previousVintage([v('Mar-27', 'd'), v('Jul-26', 'c'), v('Jun-26', 'a')], v('Jul-26'))?.last_data_month, 'Jun-26')
check('skips a pre-v3 vintage this engine cannot replay',
  previousVintage([preV3('Jun-26', 'b'), v('May-26', 'a')], v('Jul-26'))?.last_data_month, 'May-26')
check('smly_plain alone counts as replayable',
  previousVintage([{ last_data_month: 'Jun-26', smly_plain: { X: {} } }], v('Jul-26'))?.last_data_month, 'Jun-26')
check('an empty anchor object is NOT replayable',
  previousVintage([{ last_data_month: 'Jun-26', smly_robust: {} }], v('Jul-26')), null)
check('nothing earlier and replayable -> no ghost line',
  previousVintage([v('Mar-27', 'd'), preV3('Jun-26', 'b')], v('Jul-26')), null)
check('only one vintage', previousVintage([v('Jul-26', 'a')], v('Jul-26')), null)
check('all the same month', previousVintage([v('Jul-26', 'b'), v('Jul-26', 'a')], v('Jul-26')), null)
check('empty history', previousVintage([], v('Jul-26')), null)
check('no arguments at all', previousVintage(), null)
check('rows with no last_data_month are skipped',
  previousVintage([v('Jul-26', 'c'), { trained_at: 'b' }, v('May-26', 'a')], v('Jul-26'))?.last_data_month, 'May-26')
check('falls back to history[0] as "current" when params are absent',
  previousVintage([v('Jul-26', 'b'), v('Jun-26', 'a')])?.last_data_month, 'Jun-26')

console.log('\n=== against production as it stands today ===')
// Measured 2026-08-25: three Jul-26 v3 rows, a pre-v3 Jul-26, the Mar-27
// residue, and a pre-v3 Jun-26. Nothing qualifies, so no line is drawn - and
// crucially the Mar-27 residue is NOT chosen.
const prod = [v('Jul-26', '21'), v('Jul-26', '19'), v('Jul-26', '18'),
              preV3('Jul-26', '16'), preV3('Mar-27', '15'), preV3('Jun-26', '14')]
check('no comparable vintage yet, and no wrong one chosen', previousVintage(prod, v('Jul-26')), null)
check('once Aug-26 data lands, Jul-26 becomes the comparison',
  previousVintage([v('Aug-26', '22'), ...prod], v('Aug-26'))?.trained_at, '21')

console.log('\n=== replaying a vintage at ITS OWN horizons ===')
const asOf = vintageAsOf('Jun-26')
check('as-of lands in the month after its data', currentIstMonth(asOf).month_num, 7)
check('...of the right year', currentIstMonth(asOf).year, 2026)
check('mid-month, so the IST shift cannot cross a boundary',
  currentIstMonth(asOf).day, d => d > 1 && d < 28)
check('crosses the year end',
  (() => { const m = currentIstMonth(vintageAsOf('Dec-26')); return [m.year, m.month_num] })(), [2027, 1])
check('junk month -> null, never a wrong date', vintageAsOf('nonsense'), null)
check('missing month -> null', vintageAsOf(undefined), null)

console.log('\n=== the ghost line only covers the OVERLAP ===')
const seg = 'Haulage'
const actuals = [{ month_label: 'Jun-26', haulage: 50 }, { month_label: 'Jul-26', haulage: 60 }]
const cur = {
  forecastMonths: [{ label: 'Aug-26', horizon: 1 }, { label: 'Sep-26', horizon: 2 }, { label: 'Oct-26', horizon: 3 }],
  bySegment: { [seg]: [
    { month: 'Aug-26', tiv: 109, ptb: 20 },
    { month: 'Sep-26', tiv: 184, ptb: 22 },
    { month: 'Oct-26', tiv: 159, ptb: 24 },
  ] },
}
// Trained a month earlier: its window was Jul/Aug/Sep-26. Jul-26 is now history.
const prev = {
  forecastMonths: [{ label: 'Jul-26', horizon: 1 }, { label: 'Aug-26', horizon: 2 }, { label: 'Sep-26', horizon: 3 }],
  bySegment: { [seg]: [
    { month: 'Jul-26', tiv: 999, ptb: 9 },
    { month: 'Aug-26', tiv: 100, ptb: 19 },
    { month: 'Sep-26', tiv: 170, ptb: 21 },
  ] },
}
const rows = buildSegmentChartData(actuals, [], seg, cur, prev)
const at = m => rows.find(r => r.month === m)
check('overlap months carry the old value', [at('Aug-26')['TIV Prev'], at('Sep-26')['TIV Prev']], [100, 170])
check('a month the old model never reached has none', at('Oct-26')['TIV Prev'], undefined)
check('the old vintage does NOT paint over history', at('Jul-26')['TIV Prev'], undefined)
check('Jul-26 is still an actual', at('Jul-26').TIV, 60)
check('the current forecast is unchanged by the comparison',
  [at('Aug-26')['TIV Fcst'], at('Sep-26')['TIV Fcst'], at('Oct-26')['TIV Fcst']], [109, 184, 159])
check('overlap detected', hasVintageOverlap(rows), true)

console.log('\n=== a stale old vintage contributes nothing, and says so ===')
const stalePrev = {
  forecastMonths: [{ label: 'Aug-26', horizon: 1 }],
  bySegment: { [seg]: [{ month: 'Aug-26', tiv: null, ptb: null }] },
}
const staleRows = buildSegmentChartData(actuals, [], seg, cur, stalePrev)
check('a null old value is not plotted as zero', staleRows.find(r => r.month === 'Aug-26')['TIV Prev'], undefined)
check('and no comparison is advertised', hasVintageOverlap(staleRows), false)
check('no previous at all -> no overlap', hasVintageOverlap(buildSegmentChartData(actuals, [], seg, cur)), false)
check('undefined chart data', hasVintageOverlap(undefined), false)

console.log('\n=== nothing else about the chart changed ===')
const before = buildSegmentChartData(actuals, [], seg, cur)
const after  = buildSegmentChartData(actuals, [], seg, cur, prev)
check('same number of points', after.length, before.length)
check('handover still bridges history to forecast', before.find(r => r.month === 'Jul-26')['TIV Fcst'], 60)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
