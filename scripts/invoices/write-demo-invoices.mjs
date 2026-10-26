// Write the DEMO invoices (demo-invoices.mjs) as PDF files — for uploading on staging.
// Usage (from the repo root):  node scripts/invoices/write-demo-invoices.mjs <out-dir>
import fs from 'node:fs'
import path from 'node:path'
import { demoWorkshop, demoCounter } from './demo-invoices.mjs'

const out = process.argv[2]
if (!out) { console.log('usage: node scripts/invoices/write-demo-invoices.mjs <out-dir>'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const files = {
  'DEMO workshop credit GJ01ZZ0001.pdf': demoWorkshop(),
  'DEMO workshop cash GJ01ZZ0002.pdf': demoWorkshop({
    jobCard: 'WTY57562627099002', order: '2039100002', customer: 'DEMO MAHADEV TRAVELS', code: '900003',
    mobile: '9000000003', regn: 'GJ01ZZ0002', pan: 'AAAPZ7777Z', gstin: '24AAAPZ7777Z1Z1', credit: false,
    bills: [{ no: 'LCS5756269900002', amount: 1534000, exTax: 1300000 }, { no: 'PCS5756269900002', amount: 455000, exTax: 385600 }],
  }),
  'DEMO counter credit MCI5756269900001.pdf': demoCounter(),
}
for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(out, name), bytes)
console.log(`wrote ${Object.keys(files).length} DEMO invoices to ${out}`)
