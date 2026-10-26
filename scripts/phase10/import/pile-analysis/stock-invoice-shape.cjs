// COUNTS + SHAPES only: in the yard stock registers, the INVOICE NO / PLANT NAME / receive year of trucks in the
// books vs the stock-register-only trucks missing from them
const fs = require('fs'), path = require('path')
const XLSX = require(process.argv[2] + '/node_modules/xlsx')
const S = 'D:/PTB/Finances/Backup data'
const mc = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/missing-classified.csv', 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1)
const only = new Set(mc.map((l) => l.replace(/\r$/, '').split('","').map((x) => x.replace(/"/g, ''))).filter((x) => x[4] === 'PTB stock register').map((x) => x[0]))
const v = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/vehicles.csv', 'utf8')
const inBooks = new Set([...v.matchAll(/^"(MB1[A-Z0-9]{14})","yes"/gm)].map((m) => m[1]))
const files = new Set()
for (const m of v.matchAll(/^"(MB1[A-Z0-9]{14})","NO","\d+","[^"]*","([^"]*)"/gm)) if (only.has(m[1])) for (const f of m[2].split(' | ')) if (/\.xls/i.test(f)) files.add(f)
const shape = (s) => String(s).trim().toUpperCase().replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9').replace(/9{4,}/g, (m) => `9×${m.length}`) || '(blank)'
const t = new Map(), seen = new Set()
const add = (col, val, side) => { const k = `${col}|${val}`; const e = t.get(k) ?? [0, 0]; e[side]++; t.set(k, e) }
for (const rel of files) {
  let wb; try { wb = XLSX.read(fs.readFileSync(path.join(S, rel)), { type: 'buffer', cellDates: true }) } catch { continue }
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]; if (!ws['!ref']) continue
    const byRow = new Map(); for (const k in ws) if (k[0] !== '!' && ws[k].v != null) { const a = XLSX.utils.decode_cell(k); (byRow.get(a.r) ?? byRow.set(a.r, []).get(a.r))[a.c] = ws[k].v }
    const rs = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r))
    const hi = rs.slice(0, 15).findIndex((r) => (r || []).some((x) => /chassis/i.test(String(x))))
    if (hi < 0) continue
    const head = (rs[hi] || []).map((x) => String(x ?? '').trim().toUpperCase())
    if (!head.includes('RECEIVE DATE')) continue
    const ci = head.findIndex((h) => /CHASSIS/.test(h)), ii = head.indexOf('INVOICE NO'), pi = head.indexOf('PLANT NAME'), ri = head.indexOf('RECEIVE DATE')
    for (const r of rs.slice(hi + 1)) {
      const c = String(r?.[ci] ?? '').replace(/\s+/g, '').toUpperCase()
      const side = inBooks.has(c) ? 0 : only.has(c) ? 1 : -1
      if (side < 0 || seen.has(c)) continue
      seen.add(c)
      if (ii >= 0) add('INVOICE NO shape', shape(r[ii] ?? ''), side)
      if (pi >= 0) add('PLANT NAME', String(r[pi] ?? '').trim().toUpperCase().slice(0, 25) || '(blank)', side)
      const d = r[ri]; if (d instanceof Date) add('RECEIVE year-month', d.toISOString().slice(0, 7), side)
    }
  }
}
for (const col of ['INVOICE NO shape', 'PLANT NAME', 'RECEIVE year-month']) {
  console.log(`\n${col}   (trucks in books / stock-register-only, not in books)`)
  const rows = [...t].filter(([k]) => k.startsWith(col + '|')).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0])
  for (const [k, [a, b]] of (col.startsWith('RECEIVE') ? rows.sort((x, y) => x[0].localeCompare(y[0])) : rows.slice(0, 10))) if (a + b >= 2) console.log(`  ${k.split('|')[1].padEnd(26)} ${String(a).padStart(5)} / ${b}`)
}
console.log(`\nmatched: ${[...seen].filter((c) => only.has(c)).length} of ${only.size} stock-register-only trucks`)
