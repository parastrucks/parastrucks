// The owner receives last month's market data on the 5th-7th of the following
// month. The model's anchors run out on the 1st. So a gap opens EVERY month by
// design and closes a few days later. This locks in the distinction between
// that normal rhythm and data that is genuinely late.
// Usage: node scripts/tiv/selftest-data-cadence.mjs   (bundle with esbuild first)
import { dataCadence, coverageWindow, parseMonthLabel, formatMonthLabel, addMonths } from '../../src/tiv-forecast/lib/dataCadence.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  PASS  ${label} -> ${JSON.stringify(got)}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${JSON.stringify(got)} (wanted ${JSON.stringify(want)})`) }
}
// Midday UTC keeps every case unambiguously inside its IST day.
const at = iso => new Date(iso + 'T06:00:00Z')
const st = (last, iso) => dataCadence(last, at(iso))?.status

console.log('=== month arithmetic ===')
check('parse Jul-26', parseMonthLabel('Jul-26'), { year: 2026, month_num: 7 })
check('parse is case-insensitive', parseMonthLabel('jul-26'), { year: 2026, month_num: 7 })
check('reject junk', parseMonthLabel('Juillet-26'), null)
check('reject empty', parseMonthLabel(''), null)
check('format round-trips', formatMonthLabel(parseMonthLabel('Jan-27')), 'Jan-27')
check('+1 across year end', formatMonthLabel(addMonths(parseMonthLabel('Dec-26'), 1)), 'Jan-27')
check('+2 across year end', formatMonthLabel(addMonths(parseMonthLabel('Nov-26'), 2)), 'Jan-27')

console.log('\n=== the awaited month and when it lands (trained through Jul-26) ===')
const c = dataCadence('Jul-26', at('2026-09-06'))
check('awaits August data', c.awaitedMonth, 'Aug-26')
check('which lands in September', c.arrivesInMonth, 'Sep-26')
check('window is the 5th to 7th', [c.dueFrom, c.dueBy], [5, 7])

console.log('\n=== the rhythm, day by day (trained through Jul-26) ===')
check('25 Aug — data cannot be here yet', st('Jul-26', '2026-08-25'), 'current')
check('31 Aug — still not due',           st('Jul-26', '2026-08-31'), 'current')
check(' 1 Sep — anchors run out, but data is not due', st('Jul-26', '2026-09-01'), 'current')
check(' 4 Sep — day before the window',   st('Jul-26', '2026-09-04'), 'current')
check(' 5 Sep — window opens',            st('Jul-26', '2026-09-05'), 'due')
check(' 7 Sep — window closes',           st('Jul-26', '2026-09-07'), 'due')
check('10 Sep — still within grace',      st('Jul-26', '2026-09-10'), 'due')
check('11 Sep — now genuinely late',      st('Jul-26', '2026-09-11'), 'overdue')
check('25 Sep — clearly late',            st('Jul-26', '2026-09-25'), 'overdue')
check(' 1 Oct — a whole month missed',    st('Jul-26', '2026-10-01'), 'overdue')

console.log('\n=== after an on-time upload, the alarm clears ===')
check('12 Sep, now trained through Aug-26', st('Aug-26', '2026-09-12'), 'current')
check('30 Sep, still current',              st('Aug-26', '2026-09-30'), 'current')
check(' 6 Oct, next month due again',       st('Aug-26', '2026-10-06'), 'due')

console.log('\n=== year boundary ===')
check('trained Nov-26, 6 Jan 27 -> due',      st('Nov-26', '2027-01-06'), 'due')
check('trained Nov-26, awaited month',        dataCadence('Nov-26', at('2027-01-06')).awaitedMonth, 'Dec-26')
check('trained Nov-26, arrives in',           dataCadence('Nov-26', at('2027-01-06')).arrivesInMonth, 'Jan-27')
check('trained Dec-26, 20 Jan 27 -> current', st('Dec-26', '2027-01-20'), 'current')
check('trained Dec-26, 11 Feb 27 -> overdue', st('Dec-26', '2027-02-11'), 'overdue')

console.log('\n=== IST, not the viewer\'s laptop ===')
// 2026-08-31 20:00 UTC is already 1 Sep in India. Status must not differ,
// but the day boundary must be read in IST.
check('31 Aug 20:00 UTC is 1 Sep IST', dataCadence('Jul-26', new Date('2026-08-31T20:00:00Z')).status, 'current')
check('10 Sep 19:00 UTC is 11 Sep IST -> overdue', dataCadence('Jul-26', new Date('2026-09-10T19:00:00Z')).status, 'overdue')

console.log('\n=== bad input never throws ===')
check('null last month', dataCadence(null, at('2026-09-06')), null)
check('junk last month', dataCadence('nonsense', at('2026-09-06')), null)

console.log('\n=== coverage window ===')
const mp = { smly_robust: { 'Aug-26': {}, 'Sep-26': {}, 'Oct-26': {} } }
check('reads the anchors', coverageWindow(mp).text, 'Aug-26 → Oct-26')
check('sorted by month, not alphabetically',
  coverageWindow({ smly_robust: { 'May-26': {}, 'Jul-26': {}, 'Jun-26': {} } }).text, 'May-26 → Jul-26')
check('falls back to smly_plain', coverageWindow({ smly_plain: { 'Sep-26': {} } }).text, 'Sep-26')
check('single month reads plain', coverageWindow({ smly_robust: { 'Sep-26': {} } }).text, 'Sep-26')
check('no anchors -> null', coverageWindow({}), null)
check('no params -> null', coverageWindow(null), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
