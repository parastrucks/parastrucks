// counts only: the master payment tracker per sheet, and how much of the 2023-24 monthly files it covers
const fs = require('fs'), path = require('path')
const repo = process.argv[2], src = process.argv[3]
const XLSX = require(repo + '/node_modules/xlsx')
const { recognise } = require(repo + '/scripts/phase10/import/inventory-open.cjs')
const B = String.fromCharCode(92)
const open = (rel) => recognise(XLSX.read(fs.readFileSync(path.join(src, rel)), { type: 'buffer', cellDates: true }))
const m = open('ASHOK PRAJAPATI' + B + 'PAYMENT TRACKER FROM NOV22 ONWARDS.xlsx')
const all = new Set()
for (const f of m) { console.log(`master sheet "${f.sheet}": family ${f.family}, ${f.chassis.size} chassis, ${f.rows} rows, most dates in FY ${f.dataFy}`); for (const c of f.chassis) all.add(c) }
const csv = fs.readFileSync(path.join(src, '_Sorted/_Inventory/inventory.csv'), 'utf8')
const rels = [...csv.matchAll(/^"([^"]+)","[^"]*","([^"]*)","(2023-24|2022-23)"/gm)].filter((x) => x[2].split('+').includes('FY')).map((x) => [x[1], x[3]])
for (const fy of ['2022-23', '2023-24']) {
  const u = new Set(); const byFolder = new Map()
  for (const [rel, y] of rels) if (y === fy) for (const f of open(rel)) if (f.family === 'FY') for (const c of f.chassis) u.add(c)
  const inM = [...u].filter((c) => all.has(c)).length
  console.log(`${fy} monthly/other sales-book files: ${u.size} distinct trucks, ${inM} of them in the master, ${u.size - inM} only in the monthly files`)
}
