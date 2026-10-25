// Phase 10 — DUMMY AL Balance Sheets for trying the monthly check on staging (September + October 2026),
// built from the staging DEMO trucks, laid out like the team's real file (same headers, the credit as the
// formula =CTD*0.999, CARRY OVER and Net Balance lines). Most lines are right; a few are wrong ON PURPOSE so
// the panel has something to show — each is listed below and printed when the files are written.
//
//   1. the DEMO trucks of those months (staging):
//      npx supabase@2.109.1 db query --linked --workdir <scratch>/sb "select chassis_no, engine_no, vpart_no, ctd,
//        al_payment_status, al_payment_date, mto_advance from vehicle_units where chassis_no like 'DEMO-L1-%' and
//        superseded_at is null and al_payment_date >= '2026-09-01' and al_payment_date < '2026-11-01'
//        order by al_payment_date, chassis_no"  → keep the "rows" array as <trucks.json>
//   2. node scripts/phase10/write-demo-al-sheets.mjs <trucks.json> <output folder>
//      (the browser test reads them from node_modules/al-sheet-demo-files/ — gitignored, wiped by npm ci)
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'node:path'
import { isoToSerial } from '../../src/tracker/lib/cellValues.js'

const [, , trucksFile, outDir] = process.argv
if (!trucksFile || !outDir) { console.error('usage: write-demo-al-sheets.mjs <trucks.json> <output folder>'); process.exit(2) }
const trucks = JSON.parse(fs.readFileSync(trucksFile, 'utf8'))
if (!trucks.length || !trucks.every((t) => t.chassis_no.startsWith('DEMO-'))) { console.error('refused: only DEMO trucks'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })

const HEAD = ['Date', 'Details', 'Debit', 'Credit', 'CBN Number', 'Chassis No', 'Engine No', 'CTD', 'Offtake Mode']
const r2 = (v) => Math.round(v * 100) / 100
let carry = 25_00_000   // what PTB had paid ahead at the start of September
const made = []

for (const [mk, label] of [['2026-09', '0926'], ['2026-10', '1026']]) {
  const month = trucks.filter((t) => t.al_payment_date.startsWith(mk))
  const rows = [HEAD]
  const formulas = []          // [row index, formula] for the credit cells
  const wrong = []
  const [y, m] = mk.split('-').map(Number)
  const prevLast = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
  rows.push([isoToSerial(prevLast), 'CARRY OVER', carry, null, null, null, null, null, null])
  month.forEach((t, k) => {
    // deliberate problems, a few per month
    if (k === 3) { wrong.push(`${t.chassis_no}: left off the sheet (AL took it — "on no sheet")`); return }
    let ctd = Number(t.ctd), share = 1, typed = false, mode = t.al_payment_status === 'IBND' ? 'IBND' : 'FRESH OFFTAKE'
    if (k === 5) { ctd = r2(ctd * 1.03); wrong.push(`${t.chassis_no}: CTD 3% higher than the tracker`) }
    if (k === 7) { typed = true; wrong.push(`${t.chassis_no}: credit typed as a number`) }
    if (k === 9) { share = 0.95; wrong.push(`${t.chassis_no}: only 95% (MTO Advance not Yes)`) }
    if (k === 11 && mk === '2026-10') { mode = 'Fresh offtake'; } // a different case is NOT a different spelling
    const at = rows.length
    rows.push([isoToSerial(t.al_payment_date), `${t.vpart_no} ${t.chassis_no} ${t.engine_no ?? ''}`.trim(), null,
      r2(ctd * 0.999 * share), t.vpart_no, t.chassis_no, t.engine_no, ctd, mode])
    if (!typed) formulas.push([at, share === 1 ? `H${at + 1}*0.999` : `H${at + 1}*0.999*${share}`])
  })
  // an add-on with a second spelling, a chassis the tracker does not know, money paid
  const any = month[0]
  rows.push([isoToSerial(`${mk}-15`), `PARTS PKG ${any.chassis_no}`, null, 12_500, any.vpart_no, any.chassis_no, any.engine_no, 12_500, 'PARTS PKG'])
  wrong.push(`${any.chassis_no}: an add-on spelt "PARTS PKG"`)
  rows.push([isoToSerial(`${mk}-16`), 'DEMO-NOT-A-TRUCK', null, 9_99_000, 'X', `DEMO-NOTINBOOK-${label}`, 'X', 10_00_000, 'FRESH OFFTAKE'])
  wrong.push(`DEMO-NOTINBOOK-${label}: a chassis not in the tracker`)
  const owed = rows.slice(1).reduce((s, r) => s + (r[3] ?? 0), 0)
  for (const [d, what, amt] of [[`${mk}-10`, 'INDENT AXIS BANK', r2(owed * 0.45)], [`${mk}-24`, 'INDENT INDUSIND', r2(owed * 0.5)], [`${mk}-28`, 'PRICE SUPPORT', 1_50_000]]) {
    rows.push([isoToSerial(d), what, amt, null, null, null, null, null, null])
  }
  const paid = rows.slice(1).reduce((s, r) => s + (r[2] ?? 0), 0)
  const net = r2(paid - owed)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  rows.push([isoToSerial(last), 'Net Balance', net, null, null, null, null, null, null])
  carry = net

  const ws = XLSX.utils.aoa_to_sheet(rows)
  for (const [ri, f] of formulas) ws[XLSX.utils.encode_cell({ r: ri, c: 3 })].f = f
  for (let ri = 1; ri < rows.length; ri++) { const c = ws[XLSX.utils.encode_cell({ r: ri, c: 0 })]; if (c) c.z = 'dd-mm-yyyy' }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary (not read)']]), 'Summary')
  XLSX.utils.book_append_sheet(wb, ws, 'AL Balance Sheet')
  const file = path.join(outDir, `AL Balance Sheet -${label}.xlsx`)
  fs.writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))   // the ESM build has no file access
  made.push(file)
  console.log(`${path.basename(file)}: ${rows.length - 1} lines (${month.length} trucks that month) · wrong on purpose:\n  - ${wrong.join('\n  - ')}`)
}
console.log(`written to ${outDir}`)
