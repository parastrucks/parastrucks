// The left-out trucks that ARE on an AL Balance Sheet: on which sheet (file + month) and what kind of line — the
// text columns of the line (DETAILS / OFFTAKE MODE / TYPE …), never an amount, a chassis or a customer. Counts only.
//
//   node scripts/phase10/import/pile-analysis/left-out-al-lines.cjs <Backup data> <import.json> <vehicles.csv>
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const [src, jsonFile, csvFile] = process.argv.slice(2)
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const loaded = new Set(JSON.parse(fs.readFileSync(jsonFile, 'utf8')).units.map((u) => norm(u.chassis_no)))
const left = new Set(fs.readFileSync(csvFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).map((l) => l.split(','))
  .filter((p) => /yes/i.test(p[1] ?? '')).map((p) => norm(p[0].replace(/"/g, ''))).filter((c) => !loaded.has(c)))
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.xls[xm]?$/i.test(e.name)) files.push(p) } }
walk(path.join(src, '_Sorted', 'AL Balance Sheet'))
const kinds = new Map(), months = new Map(), trucks = new Set()
// a text cell is shown only when it reads like a category (no digits, short) — never a name or a number
const category = (v) => typeof v === 'string' && v.length <= 30 && !/\d/.test(v) && /^[A-Za-z .&/()-]+$/.test(v)
for (const f of files) {
  const wb = XLSX.readFile(f)
  for (const [sn, ws] of Object.entries(wb.Sheets)) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
    const hr = rows.slice(0, 10).findIndex((r) => (r ?? []).some((v) => /^DETAILS$/i.test(String(v ?? '').trim())))
    const head = (rows[hr] ?? []).map((h) => String(h ?? '').trim().toUpperCase())
    rows.forEach((r, i) => {
      if (i <= hr || !r) return
      const hit = r.map(norm).find((v) => [...left].some((c) => v.includes(c)))
      if (!hit) return
      const c = [...left].find((x) => hit.includes(x)); trucks.add(c)
      const label = head.map((h, j) => (h && category(r[j]) && !/NAME|CUSTOMER|PARTY|DEALER/.test(h) ? `${h}=${String(r[j]).trim().toUpperCase()}` : null)).filter(Boolean).join(' · ')
      kinds.set(label || '(no text columns)', (kinds.get(label || '(no text columns)') ?? 0) + 1)
      const m = `${path.basename(f)} [${sn}]`; months.set(m, (months.get(m) ?? 0) + 1)
    })
  }
}
console.log(`left-out trucks found on AL sheets: ${trucks.size}`)
console.log('\nthe kind of AL line (text columns):'); for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`)
console.log('\nwhich AL sheet:'); for (const [k, n] of [...months].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}  ${k}`)
