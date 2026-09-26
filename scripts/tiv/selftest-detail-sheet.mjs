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
import fs from 'node:fs'
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

// --- The CSS contract: a phone claim that markup cannot prove ---------------
// Found by reading the stylesheet, not by a test: below 760px the app's bottom
// nav is fixed at bottom: 0 with z-index 100, and the sheet was fixed at
// bottom: 0 with z-index 60 — so its last ~62px sat BEHIND the nav, and with
// only 12px of its own padding those lines could never be scrolled into view.
// Every assertion above rendered the sheet alone and passed.
//
// A string match on one rule would pass a fix that forgot a width, so this
// evaluates the cascade instead: for every viewport width it collects the
// declarations that apply to the nav, the top bar and the sheet (min/max-width
// media only; any other media is treated as not applying), resolves var(),
// env(), calc(), min() and vh/dvh to pixels, and asserts geometry.
// Point TIV_CSS at another stylesheet to run the contract against it (that is
// how the old CSS is shown to fail).
// LIMIT: a model of the cascade, not a browser. It knows single-class rules,
// source order and width media — not specificity ties across compound
// selectors, not transforms, not the on-screen keyboard.
console.log('\n=== CSS: the sheet clears the bottom nav and the top bar at every phone width ===')
const cssPath = process.env.TIV_CSS || 'src/index.css'
const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
console.log(`        (stylesheet: ${cssPath})`)

const rules = []
const parse = (src, media) => {
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i), semi = src.indexOf(';', i)
    if (open < 0) break
    if (semi >= 0 && semi < open) { i = semi + 1; continue }   // @import / @charset
    let depth = 1, j = open + 1
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++ }
    const prelude = src.slice(i, open).trim(), body = src.slice(open + 1, j - 1)
    if (prelude.startsWith('@media')) parse(body, prelude)
    else if (!prelude.startsWith('@')) rules.push({ media, sels: prelude.split(',').map(s => s.trim()), body })
    i = j
  }
}
parse(css, null)

const mediaApplies = (media, w) => {
  if (!media) return true
  const cond = media.replace(/^@media\s*/, '').replace(/^(only\s+)?screen\s+and\s+/, '')
  const parts = cond.split(/\s+and\s+/)
  return parts.every(p => {
    const m = p.match(/^\(\s*(min|max)-width:\s*([\d.]+)px\s*\)$/)
    if (!m) return false
    return m[1] === 'min' ? w >= Number(m[2]) : w <= Number(m[2])
  })
}
const styleAt = (classes, w) => {
  const out = {}
  for (const r of rules) {
    if (!r.sels.some(s => classes.includes(s)) || !mediaApplies(r.media, w)) continue
    for (const d of r.body.split(';')) {
      const k = d.indexOf(':')
      if (k > 0) out[d.slice(0, k).trim()] = d.slice(k + 1).trim()
    }
  }
  return out
}
const root = styleAt([':root'], 1000)
const px = (value, { vpH, inset }) => {
  if (value == null) return NaN
  let v = value
  for (let n = 0; n < 5 && /var\(/.test(v); n++) v = v.replace(/var\((--[\w-]+)\)/g, (_, t) => root[t] ?? 'NaN')
  v = v.replace(/env\(\s*safe-area-inset-bottom\s*(,[^)]*)?\)/g, String(inset))
       .replace(/env\([^)]*\)/g, '0')
       .replace(/([\d.]+)d?vh/g, (_, n) => String(Number(n) * vpH / 100))
       .replace(/([\d.]+)px/g, '$1')
       .replace(/calc\(/g, '(').replace(/min\(/g, 'Math.min(').replace(/max\(/g, 'Math.max(')
  if (!/^[\d\s.+\-*/(),]*$/.test(v.replace(/Math\.m(in|ax)\(/g, '('))) return NaN   // fail closed
  try { return Function(`return (${v})`)() } catch { return NaN }
}

const SHEET = ['.tiv-receipt', '.tiv-detail-sheet']
const WIDTHS = Array.from({ length: 1400 - 280 + 1 }, (_, k) => 280 + k)
// Real phone viewports, portrait and landscape: SE, 8, 12-15, Pro Max, small Android.
const HEIGHTS = [375, 568, 640, 667, 740, 844, 932]
const INSETS = [0, 34]                                  // no home bar / iPhone home bar

// Sets, because the nav checks do not depend on viewport height and would
// otherwise repeat once per height.
const both = [], underNav = new Set(), floating = new Set(), underTopbar = new Set()
for (const w of WIDTHS) {
  const nav = styleAt(['.bottom-nav'], w), sheetCss = styleAt(SHEET, w), top = styleAt(['.topbar'], w)
  const sheetFixed = sheetCss.position === 'fixed'
  const navShown = nav.display !== 'none' && nav.position === 'fixed'
  if (sheetFixed && navShown) both.push(w)
  for (const vpH of HEIGHTS) for (const inset of INSETS) {
    const env = { vpH, inset }
    if (!sheetFixed) continue
    const sheetBottom = px(sheetCss.bottom, env)
    if (navShown) {
      const navTop = px(nav.height, env)             // the nav's top edge, measured from the viewport bottom
      const lifted = sheetBottom >= navTop
      const overAndPadded = Number(sheetCss['z-index']) > Number(nav['z-index'])
        && px(sheetCss['padding-bottom'], env) >= navTop + 12
      if (!(lifted || overAndPadded)) underNav.add(`${w}px/inset ${inset}`)
    } else if (!(sheetBottom === 0)) floating.add(`${w}px`)
    if (top.display && top.display !== 'none' && top.position === 'fixed'
        && Number(top['z-index']) > Number(sheetCss['z-index'])) {
      const sheetTopEdge = vpH - sheetBottom - px(sheetCss['max-height'], env)
      if (!(sheetTopEdge >= px(top.height, env))) underTopbar.add(`${w}x${vpH}/inset ${inset}`)
    }
  }
}
const span = set => {
  const a = [...set]
  return a.length ? `${a.length} cases, e.g. ${a.slice(0, 3).join(', ')} … ${a[a.length - 1]}` : 'none'
}

check('(premise) the sheet is pinned at a 375px phone', styleAt(SHEET, 375).position, 'fixed')
check('(premise) the bottom nav is shown at a 375px phone', styleAt(['.bottom-nav'], 375).display !== 'none', true)
check('(premise) there are widths where both are pinned — the contract below is not vacuous',
  both.length, n => n > 0)
console.log(`        sheet and nav both pinned at ${both.length ? `${both[0]}–${both[both.length - 1]}px` : 'no width'}`)
check('the sheet\'s bottom edge clears the nav at every width the nav is shown (home bar or not)',
  span(underNav), 'none')
check('and where the nav is gone, the sheet does not float above an empty gap', span(floating), 'none')
check('the sheet\'s top edge — and its close button — stays below the top bar, portrait and landscape',
  span(underTopbar), 'none')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
