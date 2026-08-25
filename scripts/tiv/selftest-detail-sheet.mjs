// "Tap a number to see how it was worked out" — the phone story (audit C9).
//
// The trigger used to be onClick on a <td>, with a `title` for explanation. A td
// is not focusable, so the derivation was unreachable by keyboard and silent to
// a screen reader; and `title` never fires on touch, so on a phone nothing said
// these numbers do anything at all. This locks in the button that replaced it
// and the dialog semantics of the sheet.
//
// LIMIT, stated rather than implied: this renders to static markup, so it
// asserts STRUCTURE. The Escape handler, the focus move on open and the focus
// return on close are effects — they need a DOM, and jsdom is not installed
// here. They are verified by reading ForecastDetail.jsx, not by this file.
// Usage: node scripts/tiv/selftest-detail-sheet.mjs   (bundle with esbuild first)
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server.browser'
import ForecastTable from '../../src/tiv-forecast/components/ForecastTable.jsx'
import ForecastDetail from '../../src/tiv-forecast/components/ForecastDetail.jsx'
import { SEGMENTS } from '../../src/tiv-forecast/constants.js'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${JSON.stringify(got)}`) }
}

const months = [{ label: 'Aug-26', month_num: 8, horizon: 1 }, { label: 'Sep-26', month_num: 9, horizon: 2 }]
const bySegment = Object.fromEntries(SEGMENTS.map(s => [s, months.map((m, i) => ({ month: m.label, tiv: 100 + i, al: 40, ptb: 20 }))]))
const table = onExplain => renderToStaticMarkup(
  h(ForecastTable, { layer: 'tiv', title: 'L', forecastMonths: months, bySegment, judgmentRows: {}, onExplain }))

console.log('=== the figure is a real button when it can be explained ===')
const withExplain = table(() => {})
check('renders buttons', (withExplain.match(/<button/g) || []).length, SEGMENTS.length * months.length)
check('type=button, so it cannot submit anything', !/(<button(?![^>]*type="button")[^>]*class="tiv-cell-btn")/.test(withExplain), true)
check('each carries the cell class', (withExplain.match(/class="tiv-cell-btn"/g) || []).length, SEGMENTS.length * months.length)
check('every button is labelled with segment, month and value',
  (withExplain.match(/aria-label="[^"]*Aug-26: 100\. Show how this number was worked out\."/g) || []).length, SEGMENTS.length)
check('the label names the segment too', withExplain.includes('aria-label="Haulage, Aug-26: 100.'), true)
check('the number itself is still rendered', withExplain.includes('>100<'), true)

console.log('\n=== no explain handler: plain cells, no controls ===')
const plain = table(null)
check('no buttons at all', (plain.match(/<button/g) || []).length, 0)
check('no stale title attribute left behind', plain.includes('Show how this number'), false)
check('the numbers still render', plain.includes('>100<'), true)
check('and the explainable class is not applied', plain.includes('tiv-explainable'), false)

console.log('\n=== the sheet is a dialog, not a styled div ===')
const sheet = renderToStaticMarkup(
  h(ForecastDetail, { title: 'Haulage · Aug-26 = 109', onClose: () => {} }, h('p', null, 'derivation')))
check('role=dialog', sheet.includes('role="dialog"'), true)
check('labelled by what it explains', sheet.includes('aria-label="How Haulage · Aug-26 = 109 was worked out"'), true)
check('focusable so focus can be moved to it', sheet.includes('tabindex="-1"'), true)
check('NOT aria-modal — the page behind stays usable', sheet.includes('aria-modal'), false)
check('carries the phone sheet class', sheet.includes('tiv-detail-sheet'), true)
check('keeps the desktop receipt class', sheet.includes('tiv-receipt'), true)
check('has a labelled close control', sheet.includes('aria-label="Close"'), true)
check('renders its children', sheet.includes('derivation'), true)
check('shows the title', sheet.includes('Haulage · Aug-26 = 109'), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
