// COUNTS ONLY: are the yard's 2025-26 receipts on AL's "Invoice List - 2025-26" — for trucks in the books vs the
// stock-register-only trucks missing from them?
const fs = require('fs'), path = require('path')
const XLSX = require(process.argv[2] + '/node_modules/xlsx')
const S = 'D:/PTB/Finances/Backup data'
const RE = /(?<![A-Z0-9])MB1[A-Z0-9]{14}(?![A-Z0-9])/g
function walk(d, acc = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!(d === S && /^_/.test(e.name))) walk(p, acc) } else acc.push(p) } return acc }
const all = walk(S)
const lists = all.filter((p) => /invoice list - 2025-26/i.test(path.basename(p)))
const onList = new Set()
for (const p of lists) { const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer' }); for (const n of wb.SheetNames) { const ws = wb.Sheets[n]; for (const k in ws) if (k[0] !== '!' && ws[k].v != null) for (const m of String(ws[k].v).toUpperCase().matchAll(RE)) onList.add(m[0]) } }
console.log(`${lists.length} copies of "Invoice List - 2025-26": ${onList.size} distinct trucks`)
const mc = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/missing-classified.csv', 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1)
const only = new Set(mc.map((l) => l.replace(/\r$/, '').split('","').map((x) => x.replace(/"/g, ''))).filter((x) => x[4] === 'PTB stock register').map((x) => x[0]))
const v = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/vehicles.csv', 'utf8')
const inBooks = new Set([...v.matchAll(/^"(MB1[A-Z0-9]{14})","yes"/gm)].map((m) => m[1]))
// yard receipts dated Apr 2025 – Mar 2026, from every stock register in the pile
const regs = all.filter((p) => /stock/i.test(path.basename(p)) && /\.xls/i.test(p))
const recv = new Map()
for (const p of regs) {
  let wb; try { wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true }) } catch { continue }
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n]; if (!ws['!ref']) continue
    const byRow = new Map(); for (const k in ws) if (k[0] !== '!' && ws[k].v != null) { const a = XLSX.utils.decode_cell(k); (byRow.get(a.r) ?? byRow.set(a.r, []).get(a.r))[a.c] = ws[k].v }
    const rs = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r))
    const hi = rs.slice(0, 15).findIndex((r) => (r || []).some((x) => /chassis/i.test(String(x))))
    if (hi < 0) continue
    const head = (rs[hi] || []).map((x) => String(x ?? '').trim().toUpperCase())
    const ri = head.indexOf('RECEIVE DATE'), ci = head.findIndex((h) => /CHASSIS/.test(h))
    if (ri < 0 || ci < 0) continue
    for (const r of rs.slice(hi + 1)) { const d = r?.[ri], c = String(r?.[ci] ?? '').replace(/\s+/g, '').toUpperCase(); if (d instanceof Date && /^MB1/.test(c)) recv.set(c, d) }
  }
}
const from = new Date('2025-04-01T00:00:00Z'), to = new Date('2026-04-01T00:00:00Z')
let a = [0, 0], b = [0, 0]
for (const [c, d] of recv) { if (d < from || d >= to) continue
  if (inBooks.has(c)) { a[0]++; if (onList.has(c)) a[1]++ } else if (only.has(c)) { b[0]++; if (onList.has(c)) b[1]++ } }
console.log(`yard receipts Apr 2025 – Mar 2026:`)
console.log(`  trucks in the books:                 ${a[0]}, of which on the AL invoice list: ${a[1]}`)
console.log(`  stock-register-only, not in books:   ${b[0]}, of which on the AL invoice list: ${b[1]}`)
