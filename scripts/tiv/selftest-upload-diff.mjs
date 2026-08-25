// Self-tests for the pre-commit upload diff (audit finding C1).
// Usage: node scripts/tiv/selftest-upload-diff.mjs
import { buildUploadDiff, buildForecastDelta } from '../../src/tiv-forecast/lib/uploadDiff.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const row = (month_label, v) => ({
  month_label,
  bus_pvt: v[0], haulage: v[1], mav: v[2], tractor: v[3], tipper: v[4], icv_trucks: v[5],
})
const A = [10, 20, 30, 40, 50, 60]
const mk = months => ({ tivActuals: months })

console.log('\n=== first upload ===')
{
  const d = buildUploadDiff(mk([row('Apr-25', A), row('May-25', A)]), {})
  ok('flagged as first upload', d.isFirstUpload)
  ok('everything counted as added', d.added.length === 2, String(d.added.length))
  ok('no coverage shortfall on an empty database', d.coverageShortfall === null)
  ok('not flagged wholesale', !d.wholesaleRewrite)
}

console.log('\n=== routine monthly update: one new month, one corrected cell ===')
{
  const current = mk([row('Apr-25', A), row('May-25', A), row('Jun-25', A)])
  const incoming = mk([
    row('Apr-25', A),
    row('May-25', [10, 21, 30, 40, 50, 60]),   // haulage corrected 20 -> 21
    row('Jun-25', A),
    row('Jul-25', A),                          // new month
  ])
  const d = buildUploadDiff(incoming, current)
  ok('one new month', d.added.length === 1 && d.added[0] === 'Jul-25', d.added.join(','))
  ok('one amended month', d.changed.length === 1, String(d.changed.length))
  ok('exactly one changed cell, named', d.changedCells === 1 && d.changed[0].cells[0].segment === 'Haulage',
    JSON.stringify(d.changed[0]?.cells))
  ok('from/to captured', d.changed[0].cells[0].from === 20 && d.changed[0].cells[0].to === 21)
  ok('two months unchanged', d.unchanged === 2, String(d.unchanged))
  ok('no acknowledgement demanded', !d.wholesaleRewrite && !d.coverageShortfall)
}

console.log('\n=== re-uploading the SAME file changes nothing ===')
{
  const same = [row('Apr-25', A), row('May-25', A)]
  const d = buildUploadDiff(mk(same), mk(same))
  ok('no additions', d.added.length === 0)
  ok('no changes', d.changed.length === 0 && d.changedCells === 0)
  ok('all unchanged', d.unchanged === 2, String(d.unchanged))
}

console.log('\n=== "5" and 5 are not a change ===')
{
  const current = mk([row('Apr-25', A)])
  const incoming = mk([row('Apr-25', ['10', '20', '30', '40', '50', '60'])])
  const d = buildUploadDiff(incoming, current)
  ok('string vs number does not read as an edit', d.changed.length === 0, JSON.stringify(d.changed))
}

console.log('\n=== a different dataset (the multi-brand hazard) is flagged ===')
{
  const current = mk(['Apr-25', 'May-25', 'Jun-25', 'Jul-25', 'Aug-25', 'Sep-25'].map(m => row(m, A)))
  const B = [99, 98, 97, 96, 95, 94]
  const incoming = mk(['Apr-25', 'May-25', 'Jun-25', 'Jul-25', 'Aug-25', 'Sep-25'].map(m => row(m, B)))
  const d = buildUploadDiff(incoming, current)
  ok('every overlapping month differs', d.changed.length === 6, String(d.changed.length))
  ok('flagged as a wholesale rewrite', d.wholesaleRewrite)
}

console.log('\n=== a short file would train on less history than is stored ===')
{
  const current = mk(Array.from({ length: 40 }, (_, i) => row(`M${i}`, A)))
  const incoming = mk(Array.from({ length: 12 }, (_, i) => row(`M${i}`, A)))
  const d = buildUploadDiff(incoming, current)
  ok('coverage shortfall reported', d.coverageShortfall?.fileMonths === 12 && d.coverageShortfall?.dbMonths === 40,
    JSON.stringify(d.coverageShortfall))
  ok('28 stored months would survive untouched', d.untouched.length === 28, String(d.untouched.length))
}

console.log('\n=== forecast delta ===')
{
  const before = { totals: [{ month: 'Aug-26', tiv: 700 }, { month: 'Sep-26', tiv: 779 }] }
  const after  = { totals: [{ month: 'Aug-26', tiv: 736 }, { month: 'Sep-26', tiv: 779 }, { month: 'Oct-26', tiv: 850 }] }
  const d = buildForecastDelta(before, after)
  ok('rise reported with its delta', d[0].before === 700 && d[0].after === 736 && d[0].delta === 36, JSON.stringify(d[0]))
  ok('unchanged month has zero delta', d[1].delta === 0)
  ok('brand-new month has null before', d[2].before === null && d[2].delta === null, JSON.stringify(d[2]))
  ok('no current model yields no delta rows', buildForecastDelta(null, after).length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
