// Renders the REAL ForecastTable to static markup and checks the header row.
// Guards the case the ghost cleanup created: a forecast month with NO judgment
// row sitting beside months that have one. It used to render an empty cell, so
// the number had no label at all -- ambiguous on screen ("is 94 the model's or
// a person's?") and no header association for a screen reader.
// Usage: node scripts/tiv/selftest-table-header.mjs   (bundle with esbuild first)
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server.browser'
import ForecastTable from '../../src/tiv-forecast/components/ForecastTable.jsx'
import { SEGMENTS } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label} -> got ${JSON.stringify(got)}`) }
}

const months = [
  { label: 'Aug-26', month_num: 8,  horizon: 1 },
  { label: 'Sep-26', month_num: 9,  horizon: 2 },
  { label: 'Oct-26', month_num: 10, horizon: 3 },
]
const bySegment = Object.fromEntries(SEGMENTS.map(s =>
  [s, months.map((m, i) => ({ month: m.label, tiv: 100 + i, al: 40 + i, ptb: 20 + i }))]))
const jRow = () => Object.fromEntries(SEGMENTS.map(s => [s, 55]))

const markup = judgmentRows => renderToStaticMarkup(
  h(ForecastTable, { layer: 'tiv', title: 'Layer 1 — TIV', forecastMonths: months, bySegment, judgmentRows }))

console.log("=== judgment for Aug-26 + Sep-26 only (today's prod shape) ===")
const m1 = markup({ 'Aug-26': jRow(), 'Sep-26': jRow() })
check('every forecast month carries a sub-header', (m1.match(/>Model</g) || []).length, 3)
check('exactly two Judg headers', (m1.match(/>Judg</g) || []).length, 2)
check('sub-header cells are th, never td', !/<td[^>]*class="tiv-sub/.test(m1), true)
check('every sub-header th has scope=col', (m1.match(/<th scope="col" class="tiv-sub/g) || []).length >= 3, true)

console.log('\n=== no judgment anywhere (AL layer) ===')
const m2 = markup({})
check('no Model headers when nothing is judged', (m2.match(/>Model</g) || []).length, 0)
check('no Judg headers either', (m2.match(/>Judg</g) || []).length, 0)
check('table still renders every segment', SEGMENTS.every(s => m2.includes(s)), true)

console.log('\n=== every month judged (pre-cleanup shape) ===')
const m3 = markup({ 'Aug-26': jRow(), 'Sep-26': jRow(), 'Oct-26': jRow() })
check('three Model headers', (m3.match(/>Model</g) || []).length, 3)
check('three Judg headers', (m3.match(/>Judg</g) || []).length, 3)

console.log('\n=== only Oct-26 judged (mirror case) ===')
const m4 = markup({ 'Oct-26': jRow() })
check('still three Model headers', (m4.match(/>Model</g) || []).length, 3)
check('one Judg header', (m4.match(/>Judg</g) || []).length, 1)

// The invariant: header columns must match the body's data cells, and when a
// sub-header row exists it must label every one of them.
console.log('\n=== column count invariant ===')
for (const [name, mk] of [['Aug+Sep', m1], ['none', m2], ['all', m3], ['Oct only', m4]]) {
  const headRow1 = mk.split('</tr>')[0]
  const headerCols = 2 * (headRow1.match(/colspan="2"/gi) || []).length
                   + 1 * (headRow1.match(/colspan="1"/gi) || []).length
  const bodyRow  = mk.split('<tbody>')[1].split('</tr>')[0]
  const bodyCols = (bodyRow.match(/<td/g) || []).length
  check(`${name}: header spans ${headerCols}, body row has ${bodyCols}`, bodyCols === headerCols, true)

  if (mk.includes('tiv-sub')) {
    const subRow   = mk.split('</tr>')[1] || ''
    const subCells = (subRow.match(/<th[^>]*class="tiv-sub/g) || []).length
    check(`${name}: sub-header labels all ${headerCols} columns`, subCells === headerCols, true)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
