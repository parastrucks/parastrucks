// The trucks the vehicle check found in the sorted books but the load does not hold: which sorted books (top or
// older copy) carry them, in which family, and whether that book is on the load list. Reads every sorted book
// with the importer's own reader. Counts and file names only.
//
//   node scripts/phase10/import/pile-analysis/left-out-trucks.cjs <Backup data> <import.json> <vehicles.csv> <load-list.txt>
const fs = require('fs')
const path = require('path')
const { readAll } = require('../read.cjs')
const [src, jsonFile, csvFile, listFile] = process.argv.slice(2)
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const loaded = new Set(JSON.parse(fs.readFileSync(jsonFile, 'utf8')).units.map((u) => norm(u.chassis_no)))
const listed = new Set(fs.readFileSync(listFile, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => path.resolve(l.split('|')[2].trim()).toLowerCase()))
const scanned = fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)
  .map((l) => l.split(',')).filter((p) => /yes/i.test(p[1] ?? '')).map((p) => norm(p[0].replace(/"/g, '')))
const want = new Set(scanned.filter((c) => !loaded.has(c)))
console.log(`left out: ${want.size}`)
const CH = { IT: 'CHASSIS NO', IT_OD: 'CHASSIS NO', FY: 'CHASSIS NUMBER', LIST: 'CHASSIS NUMBER', LIST_OD: 'CHASSIS NO', RET_INT: 'CHASSIS NO', RET_AL: 'CHASSIS NO', REBILL: 'CHASSIS NUMBER', DEALERS: 'CHASSIS NO' }
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '_Inventory') walk(p) } else if (/\.xlsx$/i.test(e.name)) files.push(p) } }
walk(path.join(src, '_Sorted'))
const found = new Map() // chassis → [where]
const anyCell = new Map() // chassis found only outside a chassis column: book → n
for (const f of files) {
  let res; try { res = readAll([f]) } catch { continue }
  const rel = path.relative(path.join(src, '_Sorted'), f)
  const onList = listed.has(path.resolve(f).toLowerCase())
  for (const [fam, rows] of Object.entries(res.families)) for (const r of rows) {
    for (const [h, cell] of Object.entries(r.cells)) {
      const v = norm(cell.v)
      if (!want.has(v)) continue
      if (!found.has(v)) found.set(v, [])
      found.get(v).push(`${fam}${h === CH[fam] ? '' : `[${h}]`} ${onList ? 'LISTED ' : ''}${rel}`)
    }
  }
}
const byWhere = new Map()
for (const c of want) {
  const w = found.get(c)
  const k = !w ? '(in a sheet the importer does not read)' : [...new Set(w.map((x) => x.split(' ')[0]))].sort().join(' + ')
  byWhere.set(k, (byWhere.get(k) ?? 0) + 1)
}
console.log('\nby family / column they sit in (a [column] = not the family\'s chassis column):')
for (const [k, n] of [...byWhere].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)
const byBook = new Map()
for (const [, w] of found) for (const x of new Set(w)) byBook.set(x, (byBook.get(x) ?? 0) + 1)
console.log('\nby book (top 40):')
for (const [k, n] of [...byBook].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${n}  ${k}`)

// per truck: is it on an AL Balance Sheet (AL billed it to PTB), and the LATEST-saved book still holding it
const onAl = new Set()
for (const f of files.filter((f) => /AL Balance Sheet/i.test(f))) {
  const wb = require('xlsx').readFile(f)
  for (const ws of Object.values(wb.Sheets)) for (const k of Object.keys(ws)) if (k[0] !== '!') for (const m of norm(ws[k].v).matchAll(/MB1[A-Z0-9]{14}/g)) onAl.add(m[0])
}
const saved = (rel) => fs.statSync(path.join(src, '_Sorted', rel.replace(/^LISTED /, ''))).mtime.toISOString().slice(0, 10)
const byLatest = new Map()
for (const c of want) {
  const w = (found.get(c) ?? []).map((x) => { const [fam, ...rest] = x.split(' '); const rel = rest.join(' ').replace(/^LISTED /, ''); return { fam, rel, saved: saved(rel) } })
  const last = w.sort((a, b) => a.saved.localeCompare(b.saved)).at(-1)
  const k = `${onAl.has(c) ? 'ON AL sheet ' : 'not on AL   '} | last seen ${last ? `${last.saved} ${last.fam} ${path.basename(last.rel)}` : '(no read sheet)'}`
  byLatest.set(k, (byLatest.get(k) ?? 0) + 1)
}
console.log(`\nper truck — on an AL Balance Sheet? and the latest-saved book still holding it (${[...want].filter((c) => onAl.has(c)).length} of ${want.size} on an AL sheet):`)
for (const [k, n] of [...byLatest].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${n}  ${k}`)
