// COUNTS ONLY: each truck missing from the sorted books — what kind of list it is on, and the date on its row
const fs = require('fs'), path = require('path')
const XLSX = require(process.argv[2] + '/node_modules/xlsx')
const S = 'D:/PTB/Finances/Backup data'
const OUT = S + '/_Sorted/_Inventory/vehicle-check/missing-classified.csv'
const t = fs.readFileSync(S + '/_Sorted/_Inventory/vehicle-check/vehicles.csv', 'utf8').replace(/^\uFEFF/, '')
const rows = []; let row = [], f = '', q = false
for (let i = 0; i < t.length; i++) { const c = t[i]
  if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
  else if (c === '"') q = true; else if (c === ',') { row.push(f); f = '' } else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' } else f += c }
rows.shift()
const miss = rows.filter((r) => r[1] === 'NO')
const missing = new Set(miss.map((r) => r[0]))
const files = new Set(miss.flatMap((r) => r[4].split(' | ')))
const RE = /(?<![A-Z0-9])MB1[A-Z0-9]{14}(?![A-Z0-9])/g
const fy = (d) => { const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String(y + 1).slice(2)}` }
function kindOf(head, name) {
  const h = head.join(' | ').toUpperCase()
  if (/SOLD TO PARTY/.test(h)) return 'AL billing export (many dealers)'
  if (/ZONAL OFFICE/.test(h)) return 'AL direct billing'
  if (/ALLOTED TO/.test(h)) return 'Government allotment'
  if (/RECEIVE DATE/.test(h)) return 'PTB stock register'
  if (/SALE ORDER NO|SALES PERSON/.test(h)) return 'DMS sales data'
  if (/INVOICE LIST/i.test(name)) return 'Invoice list'
  return 'other spreadsheet'
}
const info = new Map() // chassis → { kinds:Set, dates:[] }
const note = (c, kind, d) => { const x = info.get(c) ?? info.set(c, { kinds: new Set(), dates: [] }).get(c); x.kinds.add(kind); if (d) x.dates.push(d) }
for (const rel of files) {
  const p = path.join(S, rel)
  if (!/\.(xlsx|xlsm|xls|xlsb)$/i.test(p)) { const k = /\.eml$/i.test(p) ? (/subvention/i.test(p) ? 'AL subvention claim e-mail' : 'e-mail') : /\.pdf$/i.test(p) ? 'PDF' : 'Word / other document'
    for (const r of miss) if (r[4].split(' | ').includes(rel)) note(r[0], k, null); continue }
  let wb; try { wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true }) } catch { continue }
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]; if (!ws['!ref']) continue
    const byRow = new Map()
    for (const k in ws) if (k[0] !== '!' && ws[k].v != null) { const a = XLSX.utils.decode_cell(k); (byRow.get(a.r) ?? byRow.set(a.r, []).get(a.r))[a.c] = ws[k].v }
    const rs = [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r))
    const hi = rs.slice(0, 15).findIndex((r) => (r || []).some((v) => /chassis|vin/i.test(String(v))))
    const head = (rs[hi >= 0 ? hi : 0] || []).map((v) => String(v ?? ''))
    const kind = kindOf(head, rel)
    const dateCols = head.map((h, i) => (/date/i.test(h) ? i : -1)).filter((i) => i >= 0)
    for (const r of rs) {
      if (!r) continue
      const cs = [...String(r.map((v) => v instanceof Date ? '' : v).join(' ')).toUpperCase().matchAll(RE)].map((m) => m[0]).filter((c) => missing.has(c))
      if (!cs.length) continue
      let d = dateCols.map((i) => r[i]).find((v) => v instanceof Date) ?? r.find((v) => v instanceof Date)
      if (d && (d.getUTCFullYear() < 2010 || d.getUTCFullYear() > 2030)) d = null
      for (const c of cs) note(c, kind, d)
    }
  }
}
// strongest claim that it is PTB's own truck first
const ORDER = ['DMS sales data', 'PTB stock register', 'Invoice list', 'other spreadsheet', 'AL billing export (many dealers)', 'AL direct billing', 'Government allotment', 'AL subvention claim e-mail', 'e-mail', 'PDF', 'Word / other document']
const grid = new Map(), lines = ['chassis,kind of list,earliest date,financial year,all kinds of list']
for (const r of miss) {
  const x = info.get(r[0]) ?? { kinds: new Set(['(not re-found)']), dates: [] }
  const kind = ORDER.find((k) => x.kinds.has(k)) ?? [...x.kinds][0]
  const d = x.dates.sort((a, b) => a - b)[0]
  const y = d ? fy(d) : 'no date'
  const key = `${kind}|${y}`; grid.set(key, (grid.get(key) ?? 0) + 1)
  lines.push([r[0], kind, d ? d.toISOString().slice(0, 10) : '', y, [...x.kinds].sort().join(' + ')].map((v) => `"${v}"`).join(','))
}
fs.writeFileSync(OUT, '\uFEFF' + lines.join('\r\n'))
const kinds = [...new Set([...grid.keys()].map((k) => k.split('|')[0]))]
for (const k of kinds) {
  const ys = [...grid].filter(([key]) => key.startsWith(k + '|')).sort()
  console.log(`${k}: ${ys.reduce((s, [, n]) => s + n, 0)} — ` + ys.map(([key, n]) => `${key.split('|')[1]} ${n}`).join(' · '))
}
console.log('list:', OUT)

const combo = new Map(); for (const r of miss) { const x = info.get(r[0]); if (!x || !x.kinds.has('PTB stock register')) continue; const k = [...x.kinds].filter((k) => k !== 'PTB stock register').sort().join(' + ') || '(only stock registers)'; combo.set(k, (combo.get(k) ?? 0) + 1) }
console.log('stock-register trucks not in books, also seen in:'); for (const [k, n] of [...combo].sort((a, b) => b[1] - a[1])) console.log('  ' + String(n).padStart(4) + '  ' + k)
