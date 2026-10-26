// COUNTS + headers only: what are the files that hold trucks missing from the sorted books?
const fs = require('fs'), path = require('path')
const XLSX = require(process.argv[2] + '/node_modules/xlsx')
const S = 'D:/PTB/Finances/Backup data'
const t = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/vehicles.csv', 'utf8').replace(/^\uFEFF/, '')
const rows = []; let row = [], f = '', q = false
for (let i = 0; i < t.length; i++) { const c = t[i]
  if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
  else if (c === '"') q = true; else if (c === ',') { row.push(f); f = '' } else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' } else f += c }
rows.shift()
const missing = new Set(rows.filter((r) => r[1] === 'NO').map((r) => r[0]))
const books = new Set(rows.filter((r) => r[1] === 'yes').map((r) => r[0]))
const byFile = new Map()
for (const r of rows.filter((r) => r[1] === 'NO')) for (const fl of r[4].split(' | ')) byFile.set(fl, (byFile.get(fl) ?? 0) + 1)
const top = [...byFile].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3]) || 12)
for (const [rel, n] of top) {
  const p = path.join(S, rel)
  if (!/\.xls[xmb]?$/i.test(p)) { console.log(`\n${path.basename(rel)} — ${n} missing (not a spreadsheet)`); continue }
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer' })
  console.log(`\n${rel.split(path.sep).slice(-3).join(' / ')} — ${n} missing`)
  for (const sn of wb.SheetNames.slice(0, 4)) {
    const ws = wb.Sheets[sn]; if (!ws['!ref']) continue
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, range: 0, sheetRows: 400 })
    const hr = aoa.findIndex((r) => r.some((v) => /chassis|vin/i.test(String(v))))
    let inB = 0, inM = 0, tot = 0
    const all = JSON.stringify(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })).toUpperCase()
    for (const m of all.matchAll(/(?<![A-Z0-9])MB1[A-Z0-9]{14}(?![A-Z0-9])/g)) { tot++; if (books.has(m[0])) inB++; else if (missing.has(m[0])) inM++ }
    console.log(`  sheet "${sn}": headers: ${(aoa[hr >= 0 ? hr : 0] || []).filter(Boolean).slice(0, 14).join(' | ').slice(0, 220)}`)
    console.log(`    chassis on sheet: ${tot} · in the books: ${inB} · not in the books: ${inM}`)
    // a dealer / customer-type column: show how many distinct values, and the top 3 values only when they look like dealer names
    const head = (aoa[hr >= 0 ? hr : 0] || []).map(String)
    const di = head.findIndex((h) => /dealer|sold.?to|bill.?to|party|customer.?name/i.test(h))
    if (di >= 0) {
      const vals = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }).slice((hr >= 0 ? hr : 0) + 1).map((r) => String(r[di] ?? '').trim()).filter(Boolean)
      const c = new Map(); for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1)
      const topv = [...c].sort((a, b) => b[1] - a[1]).slice(0, 4)
      console.log(`    column "${head[di]}": ${c.size} distinct values` + (/dealer|sold.?to/i.test(head[di]) ? ` · top: ${topv.map(([v, k]) => `${v.slice(0, 40)} (${k})`).join('; ')}` : ''))
    }
  }
}
