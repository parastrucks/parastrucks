// The trucks left out of the load: is each a mistyped chassis whose corrected spelling IS loaded? A twin = a loaded
// chassis one or two characters apart (same length), or one character inserted/dropped. Counts only.
//
//   node scripts/phase10/import/pile-analysis/left-out-twins.cjs <import.json> <vehicles.csv>
const fs = require('fs')
const [jsonFile, csvFile] = process.argv.slice(2)
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const loaded = JSON.parse(fs.readFileSync(jsonFile, 'utf8')).units.map((u) => norm(u.chassis_no))
const loadedSet = new Set(loaded)
const left = fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).map((l) => l.split(','))
  .filter((p) => /yes/i.test(p[1] ?? '')).map((p) => norm(p[0].replace(/"/g, ''))).filter((c) => !loadedSet.has(c))
const dist = (a, b) => { // Levenshtein, small strings
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const tally = { one: 0, two: 0, tail8: 0, none: 0 }
for (const c of left) {
  let best = 99
  for (const l of loaded) { if (Math.abs(l.length - c.length) > 2) continue; const x = dist(c, l); if (x < best) best = x; if (best === 1) break }
  if (best === 1) tally.one++
  else if (best === 2) tally.two++
  else if (loaded.some((l) => l.slice(-8) === c.slice(-8))) tally.tail8++
  else tally.none++
}
console.log(`left out ${left.length}: a loaded twin 1 character apart ${tally.one} · 2 apart ${tally.two} · same last 8 characters ${tally.tail8} · no twin ${tally.none}`)
