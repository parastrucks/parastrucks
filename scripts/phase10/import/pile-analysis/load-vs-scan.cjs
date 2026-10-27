// The load (import.json) against the vehicle check (vehicle-scan.cjs → vehicles.csv): every chassis the scan found
// in the sorted books — is it a truck in the load? Those that are not: which kinds of book they were found in
// and whether those books were left out of the load list. Counts and file names only.
//
//   node scripts/phase10/import/pile-analysis/load-vs-scan.cjs <import.json> <vehicles.csv> <load-list.txt>
const fs = require('fs')
const path = require('path')
const [jsonFile, csvFile, listFile] = process.argv.slice(2)
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const units = JSON.parse(fs.readFileSync(jsonFile, 'utf8')).units
const loaded = new Set(units.map((u) => norm(u.chassis_no)))
const listed = new Set(fs.readFileSync(listFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => path.basename(l.split('|')[2].trim()).toLowerCase()))

// a small CSV reader (quoted fields)
const rows = []
{
  const t = fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '')
  let row = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
}
const head = rows.shift()
const col = (n) => head.findIndex((h) => h.toLowerCase().startsWith(n))
const ci = col('chassis'), ii = col('in sorted'), fi = col('first files')
console.log('columns:', head.join(' | '))
const inBooks = rows.filter((r) => /yes/i.test(r[ii] ?? ''))
const missing = inBooks.filter((r) => !loaded.has(norm(r[ci])))
console.log(`scan: ${inBooks.length} chassis in the sorted books · in the load ${inBooks.length - missing.length} · NOT in the load ${missing.length}`)
console.log(`load: ${loaded.size} trucks · of them not found by the scan in the books: ${[...loaded].filter((c) => !inBooks.some((r) => norm(r[ci]) === c)).length}`)
// where the missing ones were found: kind folder + whether that file is on the load list
const byKind = new Map(), byFile = new Map()
for (const r of missing) {
  const files = (r[fi] ?? '').split(/\s*;\s*/).filter(Boolean)
  const sorted = files.filter((f) => /_Sorted/i.test(f))
  const kinds = [...new Set(sorted.map((f) => /_Sorted[\\/]([^\\/]+)/i.exec(f)?.[1] ?? '?'))].sort().join(' + ') || '(no sorted file listed)'
  byKind.set(kinds, (byKind.get(kinds) ?? 0) + 1)
  for (const f of sorted.slice(0, 1)) { const k = `${path.basename(f)}${listed.has(path.basename(f).toLowerCase()) ? ' [ON the list]' : ''}`; byFile.set(k, (byFile.get(k) ?? 0) + 1) }
}
console.log('\nnot in the load, by the kind of book they were found in:')
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)
console.log('\nnot in the load, by the first sorted book they were found in (top 40):')
for (const [k, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${n}  ${k}`)
