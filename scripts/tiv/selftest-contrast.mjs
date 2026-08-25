// Computes real WCAG contrast from the ACTUAL source: token hex values are read
// out of src/index.css, and the series colours out of the component that sets
// them. Nothing is hardcoded twice, so re-muting a line in a later redesign
// fails here instead of shipping an invisible chart.
// Usage: node scripts/tiv/selftest-contrast.mjs
import fs from 'node:fs'

let pass = 0, fail = 0
const check = (label, got, want) => {
  const ok = typeof want === 'function' ? want(got) : got === want
  if (ok) { pass++; console.log(`  PASS  ${label} -> ${got}`) }
  else { fail++; console.log(`  FAIL  ${label} -> ${got}`) }
}

// WCAG 2.1 relative luminance + contrast ratio.
const chan = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const lum = hex => {
  const m = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16))
  return 0.2126 * chan(m[0]) + 0.7152 * chan(m[1]) + 0.0722 * chan(m[2])
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const round = n => Math.round(n * 100) / 100

// --- read the tokens from the stylesheet itself ---
const css = fs.readFileSync('src/index.css', 'utf8')
const tokens = {}
for (const m of css.matchAll(/--(gray-\d{3}|white|ink):\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) tokens[m[1]] = m[2]
const WHITE = tokens.white || '#FFFFFF'

console.log('=== tokens read from src/index.css ===')
check('found the gray ramp', Object.keys(tokens).filter(k => k.startsWith('gray')).length >= 4, true)
for (const k of Object.keys(tokens).filter(k => k.startsWith('gray')).sort())
  console.log(`        ${k} = ${tokens[k]}  (${round(ratio(tokens[k], WHITE))}:1 on white)`)

// --- the series colours, read from the component that declares them ---
const tab = fs.readFileSync('src/tiv-forecast/components/SegmentAnalysisTab.jsx', 'utf8')
const seriesBlock = tab.slice(tab.indexOf("key: 'TIV',"), tab.indexOf('height={260}'))
const usedTokens = [...seriesBlock.matchAll(/color:\s*'var\(--(gray-\d{3})\)'/g)].map(m => m[1])

console.log('\n=== chart line colours must clear 3:1 (WCAG graphical objects) ===')
check('the PTB series still uses gray tokens', usedTokens.length >= 2, true)
for (const t of [...new Set(usedTokens)]) {
  const r = round(ratio(tokens[t], WHITE))
  check(`${t} line is distinguishable (${r}:1 >= 3)`, r, v => v >= 3)
}

console.log('\n=== legend LABEL text must clear 4.5:1 (body text) ===')
const chart = fs.readFileSync('src/tiv-forecast/components/SegmentChart.jsx', 'utf8')
const fm = chart.match(/formatter=\{value =>[\s\S]*?color:\s*'var\(--(gray-\d{3}|ink)\)'/)
check('Legend has a formatter forcing a readable ink', !!fm, true)
if (fm) {
  const r = round(ratio(tokens[fm[1]] || '#000000', WHITE))
  check(`legend label ink ${fm[1]} is readable (${r}:1 >= 4.5)`, r, v => v >= 4.5)
}

console.log('\n=== the regression this guards ===')
// The values that were actually shipping before this change.
check('old PTB actual gray-400 would now FAIL 3:1', round(ratio(tokens['gray-400'], WHITE)), v => v < 3)
check('old PTB forecast gray-300 would now FAIL 3:1', round(ratio(tokens['gray-300'], WHITE)), v => v < 3)
check('gray-300 as legend text would FAIL 4.5:1', round(ratio(tokens['gray-300'], WHITE)), v => v < 4.5)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
