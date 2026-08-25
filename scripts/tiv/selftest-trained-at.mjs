// Guards the status strip against rendering the words "Invalid Date".
// The object retrainModel builds in the browser carries no `trained_at` --
// that column is stamped by the database -- so straight after an upload the
// page had `new Date(undefined)` in its hands. Runs the REAL shipped helper.
// Usage: node scripts/tiv/selftest-trained-at.mjs   (bundle with esbuild first)
import { formatTrainedAt } from '../../src/tiv-forecast/lib/formatTrainedAt.js'
import { retrainModel } from '../../src/tiv-forecast/lib/retrainModel.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (ok) { pass++; console.log(`  PASS  ${label} -> ${JSON.stringify(got)}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${JSON.stringify(got)} (wanted ${want})`) }
}

console.log('=== formatTrainedAt ===')
// The cases that actually occurred
check('undefined (fresh client retrain)', formatTrainedAt(undefined), 'just now')
check('null (column never written)',      formatTrainedAt(null), 'just now')
check('empty string',                     formatTrainedAt(''), 'just now')
check('garbage text',                     formatTrainedAt('not a date'), 'just now')
check('NaN',                              formatTrainedAt(NaN), 'just now')
check('object',                           formatTrainedAt({}), 'just now')

// Real shapes PostgREST returns
check('ISO with offset', formatTrainedAt('2026-08-24T18:47:15.607003+00:00'), s => /\d/.test(s) && s !== 'Invalid Date')
check('ISO with Z',      formatTrainedAt('2026-08-24T18:47:15.607Z'),        s => /\d/.test(s) && s !== 'Invalid Date')
check('postgres space form', formatTrainedAt('2026-08-24 18:47:15.607003+00'), s => s !== 'Invalid Date')
check('Date object',     formatTrainedAt(new Date('2026-08-24T18:47:15Z')),  s => /\d/.test(s))
check('epoch number',    formatTrainedAt(1787000000000),                     s => /\d/.test(s))

// The invariant that matters: nothing renders the words "Invalid Date"
const hostile = [undefined, null, '', 'x', {}, [], NaN, Infinity, -1e20, 'Invalid Date', '0000-00-00', false, true]
check('no input yields "Invalid Date"', hostile.every(v => formatTrainedAt(v) !== 'Invalid Date'), true)

// And the root cause is real, not assumed: retrainModel emits no trained_at.
console.log('\n=== root cause ===')
const keys = Object.keys(retrainModel(
  Array.from({ length: 40 }, (_, i) => ({ month_label: `M${i}`, month_index: i, bus_pvt: 10, haulage: 10, mav: 10, tractor: 10, tipper: 10, icv_trucks: 10 })),
  Array.from({ length: 40 }, (_, i) => ({ month_label: `M${i}`, month_index: i, bus_pvt: 5, haulage: 5, mav: 5, tractor: 5, tipper: 5, icv_trucks: 5 })),
  Array.from({ length: 40 }, (_, i) => ({ month_label: `M${i}`, month_index: i, bus_pvt: 7, haulage: 7, mav: 7, tractor: 7, tipper: 7, icv_trucks: 7 })),
))
check('retrainModel omits trained_at', keys.includes('trained_at'), false)
check('formatTrainedAt handles that object', formatTrainedAt(undefined), 'just now')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
