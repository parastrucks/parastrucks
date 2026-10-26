// COUNTS ONLY: for the stock registers and the DMS sales data — status/type/plant columns of the rows whose truck
// is NOT in the sorted books, beside the same columns for rows whose truck IS in the books
const fs = require('fs'), path = require('path')
const XLSX = require(process.argv[2] + '/node_modules/xlsx')
const S = 'D:/PTB/Finances/Backup data'
const t = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/missing-classified.csv', 'utf8').replace(/^\uFEFF/, '')
const own = new Map(t.split('\n').slice(1).map((l) => l.replace(/\r$/, '').split('","').map((x) => x.replace(/"/g, ''))).filter((x) => /stock register|DMS sales/.test(x[1])).map((x) => [x[0], x[1]]))
const v = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/vehicles.csv', 'utf8')
const inBooks = new Set([...v.matchAll(/^"(MB1[A-Z0-9]{14})","yes"/gm)].map((m) => m[1]))
// the files: every file that holds one of these trucks
const files = new Set()
for (const m of v.matchAll(/^"(MB1[A-Z0-9]{14})","NO","\d+","[^"]*","([^"]*)"/gm)) if (own.has(m[1])) for (const f of m[2].split(' | ')) if (/\.xls/i.test(f)) files.add(f)
const RE = /(?<![A-Z0-9])MB1[A-Z0-9]{14}(?![A-Z0-9])/
const tally = new Map() // "kind|column|value|side" → n
const seen = new Set()
for (const rel of files) {
  let wb; try { wb = XLSX.read(fs.readFileSync(path.join(S, rel)), { type: 'buffer' }) } catch { continue }
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]; if (!ws['!ref']) continue; const byRow = new Map(); for (const k in ws) if (k[0] !== '!' && ws[k].v != null) { const a = XLSX.utils.decode_cell(k); (byRow.get(a.r) ?? byRow.set(a.r, []).get(a.r))[a.c] = ws[k].w ?? String(ws[k].v) }; const aoa = [...byRow.keys()].sort((a, b) => a - b).map((r) => Array.from(byRow.get(r), (x) => x ?? ''))
    const hi = aoa.slice(0, 15).findIndex((r) => r.some((x) => /chassis/i.test(String(x))))
    if (hi < 0) continue
    const head = aoa[hi].map(String)
    const kind = /RECEIVE DATE/i.test(head.join('|')) ? 'stock register' : /SALE ORDER NO|SALES PERSON/i.test(head.join('|')) ? 'DMS sales data' : null
    if (!kind) continue
    const cols = head.map((h, i) => [h, i]).filter(([h]) => /status|transaction type|^plant$|line of business|remark|delivered|segment/i.test(h))
    for (const r of aoa.slice(hi + 1)) {
      const m = RE.exec(r.join(' ').toUpperCase()); if (!m) continue
      const c = m[0], side = inBooks.has(c) ? 'in books' : own.has(c) ? 'NOT in books' : null
      if (!side || seen.has(`${kind}|${c}`)) continue
      seen.add(`${kind}|${c}`)
      for (const [h, i] of cols) { const val = String(r[i] ?? '').trim().toUpperCase().slice(0, 30) || '(blank)'; const k = `${kind}|${h}|${val}|${side}`; tally.set(k, (tally.get(k) ?? 0) + 1) }
    }
  }
}
const groups = new Map()
for (const [k, n] of tally) { const [kind, h, val, side] = k.split('|'); const g = `${kind} · ${h}`; const e = groups.get(g) ?? groups.set(g, new Map()).get(g); const x = e.get(val) ?? [0, 0]; x[side === 'in books' ? 0 : 1] += n; e.set(val, x) }
for (const [g, e] of groups) {
  console.log(`\n${g}   (value: trucks in books / NOT in books)`)
  for (const [val, [a, b]] of [...e].sort((x, y) => y[1][1] - x[1][1]).slice(0, 8)) if (a + b >= 3) console.log(`  ${val.padEnd(30)} ${String(a).padStart(5)} / ${b}`)
}
