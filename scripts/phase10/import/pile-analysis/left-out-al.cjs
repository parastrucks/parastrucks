// The deciding test for the trucks left out of the load: does Ashok Leyland's own monthly Balance Sheet (every copy
// in `_Sorted\AL Balance Sheet`) carry them? A truck AL billed to PTB is on it; a chassis typed wrong in a working
// copy and corrected later is not. Same test for the loaded trucks, as the yardstick. Counts only.
//
//   node scripts/phase10/import/pile-analysis/left-out-al.cjs <Backup data> <import.json> <vehicles.csv>
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const [src, jsonFile, csvFile] = process.argv.slice(2)
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const loaded = new Set(JSON.parse(fs.readFileSync(jsonFile, 'utf8')).units.map((u) => norm(u.chassis_no)))
const left = new Set(fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).map((l) => l.split(','))
  .filter((p) => /yes/i.test(p[1] ?? '')).map((p) => norm(p[0].replace(/"/g, ''))).filter((c) => !loaded.has(c)))
const onAl = new Set()
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.xls[xm]?$/i.test(e.name)) files.push(p) } }
walk(path.join(src, '_Sorted', 'AL Balance Sheet'))
const re = /MB1[A-Z0-9]{14}/g
for (const f of files) {
  const wb = XLSX.readFile(f)
  for (const ws of Object.values(wb.Sheets)) for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue
    for (const m of norm(ws[k].v).matchAll(re)) onAl.add(m[0])
  }
}
// the yardstick: of the loaded trucks bought in the months the AL sheets cover, how many are on them
const alMonthsLoaded = [...loaded].filter((c) => onAl.has(c)).length
console.log(`AL Balance Sheet copies read: ${files.length} · chassis on them: ${onAl.size}`)
console.log(`loaded trucks on an AL sheet: ${alMonthsLoaded} of ${loaded.size}`)
console.log(`left-out trucks on an AL sheet: ${[...left].filter((c) => onAl.has(c)).length} of ${left.size}`)
