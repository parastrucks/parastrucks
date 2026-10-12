// Dummy import files for a first walk-through of /payments on STAGING.
//
//   node scripts/payments/make-demo-files.mjs <output-dir>
//
// Writes four files, dated around TODAY (so the set never goes stale):
//   DEMO Billing Report 1.xlsx   the day's bills
//   DEMO Billing Report 2.xlsx   the "next day's re-export": one bill changed, one
//                                new, and DEMO ASHA's ₹1,930 bill now CANCELLED
//   DEMO HDFC report 1.xlsx      HDFC SmartHub payments up to the end of yesterday,
//                                including one failed attempt and its retry
//   DEMO HDFC report 2.xlsx      this morning's report: it OVERLAPS yesterday
//                                (as daily downloads do) and adds one payment
//
// UPI is HDFC from October 2026 (owner: BharatPe and Google Pay retired). The
// HDFC report has NO note field, so nothing here can be found by a number
// plate — every payment is found by its amount or its payer's name, as real
// ones now are.
//
// Everything is fake and says so: customers are "DEMO …", SAP codes 0099…,
// transaction ids and RRNs 99…, plates …DM…, QR terminal DEMO0001. No real
// customer, amount or transaction appears.
//
// Every row exists to show ONE behaviour, and the comments say which.
// scripts/payments/selftest-demo-files.mjs generates a set and proves each
// scenario through the screens' own code before anyone is shown it.

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
  // A job billed as parts + labour, paid as ONE sum — found by the sum alone.
  bill('PCS', '5756', DAYS.d2, 8450, 'DEMO FLEET CARRIERS', '0099000006', { reg: 'GJ01DM9044', job: '7009000001', number: 'PCS5756260009201' }),
  bill('LCS', '5756', DAYS.d2, 3200, 'DEMO FLEET CARRIERS', '0099000006', { reg: 'GJ01DM9044', job: '7009000001', number: 'LCS5756260009202' }),
  // A unique amount, and a payer whose name matches the customer.
  bill('MCI', '6370', DAYS.d3, 12345.67, 'DEMO KISAN TRADERS', '0099000007', { number: 'MCI6370260009301' }),
  // A credit bill paid only in part — found by the proprietor's NAME (the firm
  // carries it, as many do), since ₹10,000 matches no bill. THREE shared words,
  // not two: with ~20 demo bills one rare word scores far less than it does
  // among ~1,000 real ones, and two fall just short of 'strong'.
  bill('PCR', '6370', DAYS.d3, 25000, 'DEMO GANGA SAGAR MAHESHWARI', '0099000008', { reg: 'GJ06DM5566', job: '7009000002', number: 'PCR6370260009401' }),
  // A unique amount — paid after one failed attempt.
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
  // The bill QUICK FREIGHT paid for two days early. Marked "Bill not raised
  // yet" in the walkthrough, the ₹7,777 payment comes back by itself with this.
  bill('MPI', '5756', DAYS.today, 7777, 'DEMO QUICK FREIGHT', '0099000019', { number: 'MPI5756260009801' }), // new
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

// ── Payments: the HDFC SmartHub Vyapar "Transaction Report" ─────────────
// Payer names are on every row, as in the real report. No note, no payer VPA.
// [n, amount ₹, payer, day, HH:MM (24h, IST), state]
const P = (n, rupees, payer, day, hhmm, state = 'SaleSuccess') => ({ n, rupees, payer, day, hhmm, state })
export const HDFC_1 = [
  P(1, 2150, 'JAYESH PATEL', DAYS.d4, '12:00'),                   // pays for a firm he is not named after: unique amount
  P(2, 12345.67, 'DEMO KISAN TRADERS', DAYS.d3, '16:05'),         // unique amount + name
  P(3, 30, 'DEMO KISAN TRADERS', DAYS.d3, '16:11'),               // a ₹30 top-up
  P(4, 10000, 'GANGA SAGAR MAHESHWARI', DAYS.d3, '17:45'),        // part payment, found by NAME
  P(5, 7777, 'DEMO QUICK FREIGHT', DAYS.d2, '10:00'),             // no bill exists
  P(6, 4800, 'RAMESH SHARMA', DAYS.d2, '13:02', 'SaleFailed'),    // a failed attempt — NOT money…
  P(7, 4800, 'RAMESH SHARMA', DAYS.d2, '13:05'),                  // …and its successful retry
  P(8, 3400, 'MEHUL SHAH', DAYS.d2, '15:30'),                     // two ₹3,400 bills
  P(9, 11650, 'SURESH DESAI', DAYS.d2, '18:10'),                  // parts + labour, paid as one sum
  P(10, 1930, 'DEMO ASHA ENTERPRISE', DAYS.d1, '11:20'),          // the pile, split by name
  P(11, 1930, 'NIRAV PATEL', DAYS.d1, '12:40'),                   // the pile, no clue at all
]
// This morning's download overlaps yesterday — the overlap must be recognised,
// never counted twice.
export const HDFC_2 = [
  ...HDFC_1.filter((p) => p.day === DAYS.d1),
  P(12, 1930, 'DEMO BHAVIN TRADING', DAYS.today, '09:15'),        // after the bills' coverage
]

// The real header, verbatim — including the typographic apostrophe.
export const HDFC_HEADER = ['Transaction Date', 'Transaction Time', 'Corporate ID', 'Merchant ID', 'Terminal ID',
  'Doing Business As', 'Pincode', 'City', 'Location', 'User Mobile Number', 'description',
  'Transaction Type', 'Payment Type', 'Transaction State', 'Payment Network', 'Mintoak Transaction ID',
  'Amount(Rs.)', 'Offer Name', 'Transaction Amount', 'Discount Amount', 'Tip Amount', 'RRN No',
  'Payer’s name', 'Invoice No', 'ERP Reference Number']
export const DEMO_QR = { merchant: 'KTR510', terminal: 'DEMO0001' }
export const hdfcTxnId = (n) => `990000000000000${String(1000 + n)}0`   // 20 digits, text
export const hdfcRrn = (n) => `99000000${String(1000 + n)}`               // 12 digits
const to12h = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}:00 ${h < 12 ? 'AM' : 'PM'}`
}
const hdfcRow = (p) => {
  const d = {
    'Transaction Date': p.day, 'Transaction Time': to12h(p.hhmm), 'Corporate ID': '9900001',
    'Merchant ID': DEMO_QR.merchant, 'Terminal ID': DEMO_QR.terminal, 'Doing Business As': 'DEMO PARAS QR',
    Pincode: '380000', City: 'AHMEDABAD', Location: 'AHMEDA', 'User Mobile Number': '', description: 'Digital Static QR',
    'Transaction Type': 'SALE', 'Payment Type': 'BharatQR', 'Transaction State': p.state, 'Payment Network': '',
    // Kept as TEXT, as HDFC sends it: a 20-digit number would lose its tail.
    'Mintoak Transaction ID': hdfcTxnId(p.n), 'Amount(Rs.)': p.rupees, 'Offer Name': '',
    'Transaction Amount': p.rupees, 'Discount Amount': 0, 'Tip Amount': 0, 'RRN No': hdfcRrn(p.n),
    'Payer’s name': p.payer, 'Invoice No': '', 'ERP Reference Number': '',
  }
  return HDFC_HEADER.map((h) => d[h])
}
export const hdfcAoa = (payments) => [HDFC_HEADER, ...payments.map(hdfcRow)]

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
    'DEMO HDFC report 1.xlsx': xlsxBytes(hdfcAoa(HDFC_1)),
    'DEMO HDFC report 2.xlsx': xlsxBytes(hdfcAoa(HDFC_2)),
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
