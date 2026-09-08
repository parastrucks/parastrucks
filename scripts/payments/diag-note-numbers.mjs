// What do customers actually type in a Google Pay note?
//
//   node scripts/payments/diag-note-numbers.mjs --billing <x.xlsx> --gpay <y.csv>
//
// The plan treats a bill number in the note as the STRONGEST matching signal.
// That is only true if the number a customer types can be found on a bill. This
// script tests every field it could plausibly refer to — invoice number, job
// card, SAP billing document, dealer order, registration, and the last 4/5/6
// digits of each — and reports which one actually hits.

import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseBillingReport } from '../../src/service-payments/lib/parseBillingReport.js'
import { parseGpay } from '../../src/service-payments/lib/parseUpi.js'

const arg = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null }
const billPath = arg('--billing'), gpPath = arg('--gpay')
if (!billPath || !gpPath) { console.error('need --billing and --gpay'); process.exit(2) }

const wb = XLSX.read(fs.readFileSync(billPath), { type: 'buffer' })
const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
const invoices = parseBillingReport(sheet, { entityId: 'PTB' }).invoices
const receipts = parseGpay(fs.readFileSync(gpPath, 'utf8')).receipts.filter((r) => r.note_numbers.length)

console.log(`invoices ${invoices.length} · receipts carrying a note number ${receipts.length}\n`)

const FIELDS = {
  invoice_number: (v) => v.invoice_number,
  'invoice last4': (v) => String(v.invoice_number || '').slice(-4),
  'invoice last5': (v) => String(v.invoice_number || '').slice(-5),
  'invoice last6': (v) => String(v.invoice_number || '').slice(-6),
  job_ref: (v) => v.job_ref,
  'job last4': (v) => String(v.job_ref || '').slice(-4),
  'job last5': (v) => String(v.job_ref || '').slice(-5),
  billing_doc: (v) => v.sap_billing_doc,
  'billing_doc last4': (v) => String(v.sap_billing_doc || '').slice(-4),
  'billing_doc last5': (v) => String(v.sap_billing_doc || '').slice(-5),
  dealer_order: (v) => v.dealer_order_no,
  'dealer_order last4': (v) => String(v.dealer_order_no || '').slice(-4),
  'dealer_order last5': (v) => String(v.dealer_order_no || '').slice(-5),
  reg_no: (v) => v.vehicle_reg_no,
  'reg_no last4': (v) => String(v.vehicle_reg_no || '').slice(-4),
}

console.log('EXACT match — a typed number equals the whole field value:')
const scored = []
for (const [name, fn] of Object.entries(FIELDS)) {
  const set = new Set(invoices.map(fn).filter(Boolean).map(String))
  let hits = 0
  const examples = []
  for (const r of receipts) {
    const hit = r.note_numbers.find((n) => set.has(n))
    if (hit) { hits++; if (examples.length < 3) examples.push(`${hit} in "${r.payer_remark}"`) }
  }
  scored.push([name, hits, examples])
}
for (const [name, hits, ex] of scored.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(hits).padStart(3)}/${receipts.length}  ${name.padEnd(20)} ${ex.join(' · ')}`)
}

console.log('\nSUBSTRING match — a typed number appears anywhere inside the field:')
const subs = []
for (const [name, fn] of Object.entries(FIELDS)) {
  const vals = invoices.map(fn).filter(Boolean).map(String)
  let hits = 0
  for (const r of receipts) if (r.note_numbers.some((n) => vals.some((v) => v.includes(n)))) hits++
  subs.push([name, hits])
}
for (const [name, hits] of subs.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(hits).padStart(3)}/${receipts.length}  ${name}`)
}

console.log('\nEvery note that carried a number:')
for (const r of receipts) {
  console.log(`  ${r.note_numbers.join(',').padEnd(16)} ` +
              `${('₹' + (r.amount_paise / 100).toFixed(0)).padStart(9)}  ` +
              `${r.received_at.slice(0, 10)}  "${r.payer_remark}"`)
}
