// Dummy import files for a first walk-through of /payments on STAGING.
//
//   node scripts/payments/make-demo-files.mjs <output-dir>
//
// Writes four files, dated around TODAY (so the set never goes stale):
//   DEMO Billing Report 1.xlsx   the day's bills
//   DEMO Billing Report 2.xlsx   the "next day's re-export": one bill changed, one
//                                new, and DEMO ASHA's ₹1,930 bill now CANCELLED
//   DEMO BharatPe statement.csv
//   DEMO GPay export.csv
//
// Everything is fake and says so: customers are "DEMO …", SAP codes 0099…,
// UTRs 99…, plates …DM…. No real customer, amount or transaction appears.
//
// Every row exists to show ONE behaviour, and the SCENARIOS table below says
// which. scripts/payments/selftest-demo-files.mjs generates a set and proves
// each scenario through the screens' own code before anyone is shown it.

import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

// ── Dates: bills over the last five IST days; one payment arrives TODAY ──
const IST = 330 * 60000
const istDay = (offsetDays) => new Date(Date.now() + IST + offsetDays * 86400000).toISOString().slice(0, 10)
export const DAYS = { d4: istDay(-4), d3: istDay(-3), d2: istDay(-2), d1: istDay(-1), today: istDay(0) }
const excelSerial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000)

// ── Bills ──────────────────────────────────────────────────────────────
const SPEC = {
  PCS: ['ZMSI', 'D001', 'Post warranty /Paid Order'], PCR: ['ZMSI', 'D002', 'Post warranty /Paid Order'],
  LCS: ['ZMSI', 'D001', 'Post warranty /Paid Order'], LCR: ['ZMSI', 'D002', 'Post warranty /Paid Order'],
  MPI: ['ZMPI', 'D001', 'Workshop Cash Sales'], MCI: ['ZMCI', 'D002', 'Workshop Credit Sales'],
  PEI: ['ZFCI', 'D001', 'Free Of Cost Service Order'], MPR: ['ZMPR', 'D001', ''],
}
let serial = 9000
const bill = (prefix, plant, day, rupees, cust, code, o = {}) => {
  const total = Math.round(rupees * 100)
  const net = Math.round(total / 1.18)
  return { prefix, plant, day, total, net, tax: total - net, cust, code,
    number: o.number ?? `${prefix}${plant}26000${++serial}`, reg: o.reg ?? '', job: o.job ?? '',
    cancelled: o.cancelled ?? '' }
}

export const BILLS_1 = [
  // The ₹1,930 pile: five identical counter sales on one day. Only a NAME can split them.
  bill('MPI', '5756', DAYS.d1, 1930, 'DEMO ASHA ENTERPRISE', '0099000001', { number: 'MPI5756260009101' }),
  bill('MPI', '5756', DAYS.d1, 1930, 'DEMO BHAVIN TRADING', '0099000002'),
  bill('MPI', '5756', DAYS.d1, 1930, 'DEMO CHIRAG AUTO', '0099000003'),
  bill('MPI', '6370', DAYS.d1, 1930, 'DEMO DHRUVI MOTORS', '0099000004'),
  bill('MPI', '6370', DAYS.d1, 1930, 'DEMO EKTA LOGISTICS', '0099000005'),
  // A job billed as parts + labour, paid as ONE sum with the plate's last four in the note.
  bill('PCS', '5756', DAYS.d2, 8450, 'DEMO FLEET CARRIERS', '0099000006', { reg: 'GJ01DM9044', job: '7009000001', number: 'PCS5756260009201' }),
  bill('LCS', '5756', DAYS.d2, 3200, 'DEMO FLEET CARRIERS', '0099000006', { reg: 'GJ01DM9044', job: '7009000001', number: 'LCS5756260009202' }),
  // A unique amount, and a payer whose name matches the customer.
  bill('MCI', '6370', DAYS.d3, 12345.67, 'DEMO KISAN TRADERS', '0099000007', { number: 'MCI6370260009301' }),
  // A credit bill paid only in part.
  bill('PCR', '6370', DAYS.d3, 25000, 'DEMO GANGA ROADWAYS', '0099000008', { reg: 'GJ06DM5566', job: '7009000002', number: 'PCR6370260009401' }),
  // A whole registration written into the note.
  bill('LCS', '5756', DAYS.d2, 4800, 'DEMO RAMESH SHARMA', '0099000009', { reg: 'GJ27DM7715', job: '7009000003', number: 'LCS5756260009501' }),
  // Same amount, two customers, two days apart — genuinely ambiguous.
  bill('MPI', '5756', DAYS.d4, 3400, 'DEMO HARSH TYRES', '0099000010'),
  bill('MPI', '6370', DAYS.d2, 3400, 'DEMO INDU SPARES', '0099000011'),
  // Not payable: free of cost, and a parts return (parked until accounts decide).
  bill('PEI', '5756', DAYS.d2, 2000, 'DEMO FLEET CARRIERS', '0099000006', { reg: 'GJ01DM9044', job: '7009000001' }),
  bill('MPR', '5756', DAYS.d1, 1200, 'DEMO CHIRAG AUTO', '0099000003'),
  // Ordinary bills, so the screens look like a day's work.
  bill('MPI', '5756', DAYS.d4, 2150, 'DEMO JAY BATTERIES', '0099000012', { number: 'MPI5756260009601' }),
  bill('PCS', '6370', DAYS.d4, 6120.5, 'DEMO KAVYA TRANSPORT', '0099000013', { reg: 'GJ23DM1180', job: '7009000004' }),
  bill('LCR', '6370', DAYS.d3, 9800, 'DEMO LALIT CARGO', '0099000014', { reg: 'GJ05DM4412', job: '7009000005' }),
  bill('MPI', '5756', DAYS.d3, 745, 'DEMO MANAN AUTO', '0099000015'),
  bill('PCS', '5756', DAYS.d1, 15260, 'DEMO NEEL ROADLINES', '0099000016', { reg: 'GJ18DM3021', job: '7009000006' }),
  bill('MCI', '5756', DAYS.d1, 5555.55, 'DEMO OM BUILDERS', '0099000017'),
]

// Report 2 = the same bills re-exported a day later, with three differences.
export const BILLS_2 = [
  ...BILLS_1.map((b) =>
    b.number === 'MPI5756260009101' ? { ...b, cancelled: 'X' } :            // DEMO ASHA cancelled in SAP
    b.cust === 'DEMO MANAN AUTO' ? { ...b, total: 84500, net: Math.round(84500 / 1.18), tax: 84500 - Math.round(84500 / 1.18) } : b), // ₹745 → ₹845
  bill('MPI', '6370', DAYS.today, 2990, 'DEMO PRIYA MOTORS', '0099000018', { number: 'MPI6370260009701' }), // new
]

const BR_COLUMNS = ['Billing Date', 'Plant', 'Reg.No', 'Order number', 'Customer Name',
  'Dealer invoice number', 'Net value', 'Tax Value', 'Total', 'Billing Type', 'Cancelled',
  'Customer Number', 'Billing Document', 'Payment terms', 'Split Order Type description',
  'Dealer specific order number', 'Customer GSTN', 'Customer PAN', 'Chassis', 'IRN No']
const brRow = (b, i) => {
  const [type, terms, split] = SPEC[b.prefix]
  return [excelSerial(b.day), b.plant, b.reg, b.job, b.cust, b.number, b.net / 100, b.tax / 100,
    b.total / 100, type, b.cancelled, b.code, `09900${String(10000 + i)}`, terms, split, '', '', '', '', '']
}
export function billingReportAoa(bills) {
  return [['Billing Report'], ['No. of entries', String(bills.length)], [], BR_COLUMNS, ...bills.map(brRow)]
}

// ── Payments ───────────────────────────────────────────────────────────
const at = (day, hhmm) => `${day} ${hhmm}:00`
export const BHARATPE = [
  // [txn, amount, payer, when]
  ['990000001001', '12345.67', 'DEMO KISAN TRADERS', at(DAYS.d3, '16:05')],   // unique amount + name
  ['990000001002', '1930.0', 'DEMO ASHA ENTERPRISE', at(DAYS.d1, '11:20')],   // the pile, split by name
  ['990000001003', '1930.0', 'NIRAV PATEL', at(DAYS.d1, '12:40')],            // the pile, no clue at all
  ['990000001004', '30.0', 'DEMO KISAN TRADERS', at(DAYS.d3, '16:11')],       // a ₹30 top-up
  ['990000001005', '7777.0', 'DEMO QUICK FREIGHT', at(DAYS.d2, '10:00')],     // no bill exists
  ['990000001006', '3400.0', 'MEHUL SHAH', at(DAYS.d2, '15:30')],             // two ₹3,400 bills
  ['990000001007', '1930.0', 'DEMO BHAVIN TRADING', at(DAYS.today, '09:15')], // after the bills' coverage
]
export const GPAY = [
  // [id, amount, payer, when, note, status]
  ['DEMOGPAY0001', '11650.00', 'Suresh', at(DAYS.d2, '18:10'), '9044 service', 'Settled'],     // job, plate last-4
  ['DEMOGPAY0002', '10000.00', 'Ganga R', at(DAYS.d3, '17:45'), '5566', 'Settled'],            // part payment
  ['DEMOGPAY0003', '4800.00', 'Ramesh', at(DAYS.d2, '13:05'), 'Gj27dm 7715', 'Settled'],       // whole plate
  ['DEMOGPAY0004', '2150.00', '', at(DAYS.d4, '12:00'), '', 'Settled'],                        // nameless, unique amount
  ['DEMOGPAY0005', '999.00', 'Test', at(DAYS.d1, '10:00'), '', 'Pending'],                     // not settled
]
const BP_HEADER = 'Transaction Date and Time,Product,Received From,Payment Mode,' +
                  'Transaction ID,Transaction Amount,Net MDR (Inclusive GST),Amount Added'
const GP_HEADER = 'Payer/Receiver,Paid via,Type,Creation time,Transaction ID,Amount,' +
                  'Processing fee,Net amount,Status,Update time,Notes'
export const bharatpeCsv = () => [BP_HEADER,
  ...BHARATPE.map(([id, amt, payer, when]) => `${when},BharatPe QR,${payer},UPI,${id},${amt},0.0,${amt}`)].join('\n')
export const gpayCsv = () => [GP_HEADER,
  ...GPAY.map(([id, amt, payer, when, note, status]) =>
    `${payer},Google Pay,UPI,${when},${id},${amt},0.00,${amt},${status},${when},${note}`)].join('\n')

export function xlsxBytes(aoa) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

export function writeDemoFiles(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const files = {
    'DEMO Billing Report 1.xlsx': xlsxBytes(billingReportAoa(BILLS_1)),
    'DEMO Billing Report 2.xlsx': xlsxBytes(billingReportAoa(BILLS_2)),
    'DEMO BharatPe statement.csv': bharatpeCsv(),
    'DEMO GPay export.csv': gpayCsv(),
  }
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body)
  return Object.keys(files).map((n) => path.join(dir, n))
}

// Run as a script only when invoked by NAME — when bundled into the self-test,
// import.meta.url is the bundle itself and a URL comparison would fire there too.
if (/make-demo-files\.mjs$/.test(process.argv[1] ?? '')) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node scripts/payments/make-demo-files.mjs <output-dir>'); process.exit(2) }
  for (const f of writeDemoFiles(dir)) console.log('wrote', f)
  console.log('bills dated', DAYS.d4, '→', DAYS.d1, '(+ one new bill in report 2 dated', DAYS.today + ')')
}
