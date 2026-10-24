// DEMO SAP invoices — invented customers, numbers and amounts, laid out like the real
// SAP forms (same labels, same row structure, same Creator field). Used by
// selftest-sap-invoice.mjs and for staging, where the owner chose dummy data: no real
// customer invoice is ever uploaded there.
//
// Write the files:  node scripts/invoices/demo-invoices.mjs <out-dir>
// (from the repo root; it uses the portal's own jsPDF.)

import { jsPDF } from 'jspdf'

const fmt = (paise) => {
  const r = String(Math.floor(Math.abs(paise) / 100))
  const g = r.length > 3 ? r.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + r.slice(-3) : r
  return `${g}.${String(Math.abs(paise) % 100).padStart(2, '0')}${paise < 0 ? '-' : ''}`
}
const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
  'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
function words(n) {
  const out = []
  const two = (x) => (x < 20 ? [ONES[x]] : [TENS[Math.floor(x / 10)], ...(x % 10 ? [ONES[x % 10]] : [])])
  const three = (x) => [...(x >= 100 ? [ONES[Math.floor(x / 100)], 'HUNDRED'] : []), ...(x % 100 ? two(x % 100) : [])]
  if (n === 0) return 'ZERO'
  for (const [v, w] of [[1e7, 'CRORE'], [1e5, 'LAKH'], [1e3, 'THOUSAND']]) {
    if (n >= v) { out.push(...three(Math.floor(n / v)), w); n %= v }
  }
  if (n) out.push(...three(n))
  return out.join(' ')
}
export const amountWords = (paise, withPaise) =>
  `${words(Math.floor(paise / 100))} RUPEES${withPaise ? ` AND ${words(paise % 100)} PAISE` : ''} ONLY`

// rows: [y, [[x, text], …]] in PDF points from the TOP of an A4 page.
function page(doc, rows) {
  doc.setFontSize(7)
  for (const [y, cells] of rows) for (const [x, t] of cells) if (t !== '') doc.text(String(t), x, y)
}

function newDoc(form) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setProperties({ creator: `Form ${form} EN`, title: 'DEMO invoice' })
  return doc
}

/** A workshop job: summary page + one page per bill. `bills` = [{ no, amount, exTax }] in paise. */
export function demoWorkshop({
  jobCard = 'WTY57562627099001', order = '2039100001', date = '24.10.2026',
  customer = 'DEMO KRISHNA LOGISTICS', code = '900001', mobile = '9000000001', regn = 'GJ01ZZ0001',
  pan = 'AAAPZ9999Z', gstin = '24AAAPZ9999Z1Z5', credit = true,
  bills = [{ no: 'LCR5756269900001', amount: 708000, exTax: 600000 }, { no: 'PCR5756269900001', amount: 3358500, exTax: 2847650 }],
  totalOverride = null,
} = {}) {
  const doc = newDoc('ZDBMF_COVERING_LETTER_001')
  const total = totalOverride ?? bills.reduce((n, b) => n + b.amount, 0)
  page(doc, [
    [55, [[40, 'Paras Trucks And Buses']]],
    [67, [[40, 'Survey No. 271P, Sp Ring Road,']]],
    [91, [[40, 'Mob No: 7496970321']]],
    [103, [[40, 'GSTIN Number :24ABCFP3133C1ZV']]],
    [130, [[250, 'INVOICE SUMMARY']]],
    [190, [[40, 'JOB CARD NO'], [120, `: ${jobCard}`], [330, 'JOB CARD DATE'], [420, ':'], [430, date]]],
    [205, [[40, 'ORDER NUMBER'], [120, `: ${order}`], [330, 'INVOICE DATE'], [420, `: ${date}`]]],
    [219, [[40, 'CUSTOMER'], [110, ':'], [120, customer], [300, `[${code}]`]]],
    [231, [[120, 'DEMO Address Line, Ahmedabad']]],
    [243, [[120, 'Gujarat,INDIA']]],
    [255, [[120, `Mob No: ${mobile}`]]],
    [307, [[40, 'JOB CARD DETAILS'], [330, 'VEHICLE DETAILS']]],
    [321, [[40, 'ORDER TYPE'], [120, 'Warranty Order'], [330, 'VEHICLE MODEL'], [420, 'DEMO MODEL']]],
    [335, [[330, 'CHASSIS NO'], [420, 'MB1DEMO0000000001']]],
    [349, [[330, 'ENGINE NO'], [420, 'DEMO0001']]],
    [363, [[40, 'AGGREGATE NO'], [330, 'REGN. NO'], [420, regn]]],
    [474, [[40, 'BILL NO'], [150, 'BILL DATE'], [250, 'BILL AMOUNT(INR) Without'], [400, 'BILL AMOUNT(INR) With Tax']]],
    ...bills.map((b, i) => [500 + i * 14, [[40, b.no], [150, date], [250, fmt(b.exTax)], [400, fmt(b.amount)]]]),
    [500 + bills.length * 14, [[250, 'GRAND TOTAL (INR)'], [400, fmt(total)]]],
    [808, [[40, 'Printed on: 24.10.2026 17:30:45'], [450, 'Page: 1 of 1']]],
  ])
  for (const b of bills) {
    doc.addPage()
    page(doc, [
      [111, [[40, 'Paras Trucks And Buses']]],
      [196, [[250, 'TAX INVOICE']]],
      [208, [[250, credit ? 'CREDIT BILL' : 'CASH BILL']]],
      [244, [[40, 'INVOICE NO'], [110, ':'], [120, b.no], [330, 'INVOICE DATE'], [410, ':'], [420, date]]],
      [259, [[40, 'JOB CARD NO'], [110, ':'], [120, jobCard]]],
      [301, [[40, 'CUSTOMER'], [110, ':'], [120, customer], [250, `[${code}]`], [330, 'CUSTOMER PAN'], [410, ':'], [420, pan]]],
      [313, [[330, 'GSTIN / UIN'], [410, ':'], [420, gstin]]],
      [400, [[40, 'REGISTRATION'], [120, regn]]],
      [700, [[40, 'Subtotal'], [450, fmt(b.amount)]]],
      [730, [[300, 'GRAND TOTAL (INR)'], [450, fmt(b.amount)]]],
      [760, [[40, 'AMOUNT IN WORDS :'], [150, amountWords(b.amount, false)]]],
    ])
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

/** A counter (spares) sale: one page. */
export function demoCounter({
  invoiceNo = 'MCI5756269900001', date = '24.10.2026', customer = 'DEMO SHIV SPARES', code = '900002',
  mobile = '9000000002', pan = 'AAAPZ8888Z', gstin = '24AAAPZ8888Z1Z3', terms = 'CREDIT', total = 3140000,
  wordsOverride = null,
} = {}) {
  const doc = newDoc('ZSF_RETAIL_INVOICE_GST_NEW')
  page(doc, [
    [38, [[250, 'TAX INVOICE']]],
    [80, [[40, 'Paras Trucks-Ahmedabad'], [330, 'GSTIN/UIN: 24ABCFP3133C1ZV']]],
    [150, [[40, 'Bill To Customer Name & Address:']]],
    [158, [[330, 'DLR INVOICE NO'], [420, ':'], [430, invoiceNo]]],
    [164, [[40, `${customer}(${code})`]]],
    [171, [[330, 'INVOICE DATE'], [420, ':'], [430, date]]],
    [184, [[330, 'DEALER REF NO'], [420, ':'], [430, 'PCR57562627099001']]],
    [198, [[330, 'SAP INVOICE NO'], [420, ':'], [430, '990000001']]],
    [207, [[40, `Ahmedabad-382213 Mob No: ${mobile}`]]],
    [223, [[330, 'CUSTOMER PAN'], [420, ':'], [430, pan]]],
    [236, [[330, 'GSTIN'], [420, ':'], [430, gstin]]],
    [242, [[40, `${customer}(${code})`]]],
    [279, [[330, 'PAYMENT TERMS'], [420, ':'], [430, terms]]],
    [285, [[40, `Ahmedabad-382213 Mob No: ${mobile}`]]],
    [338, [[40, '1'], [60, 'DEMO0001'], [480, fmt(total)]]],
    [619, [[40, 'Discount(INR)'], [140, 'Handling Charges(INR)'], [240, 'Other Charges(INR)'], [320, 'Round Off(INR)'], [400, 'Tax At Source(INR)'], [480, 'Grand Total(INR)']]],
    [634, [[40, '0.00'], [140, '0.00'], [320, '0.00'], [400, '0.00'], [480, fmt(total)]]],
    [676, [[40, 'AMOUNT IN WORDS'], [120, `: ${wordsOverride ?? amountWords(total, true)}`]]],
  ])
  return new Uint8Array(doc.output('arraybuffer'))
}

import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2]
  if (!out) console.log('usage: node scripts/invoices/demo-invoices.mjs <out-dir>')
  else {
    const fs = await import('node:fs')
    const path = await import('node:path')
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
  }
}
