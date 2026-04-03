// Generates a sample quotation PDF with mock data
// Run: node scripts/sample_quotation.cjs
// Output: sample_quotation.pdf

const { jsPDF } = require('jspdf')
const autoTable = require('jspdf-autotable').default
const fs = require('fs')

const MARGIN    = 14
const PAGE_W    = 210
const CONTENT_W = PAGE_W - MARGIN * 2

const BLUE       = [0, 137, 207]
const GRAY_DARK  = [30, 30, 30]
const GRAY       = [90, 90, 90]
const GRAY_LIGHT = [210, 210, 210]

const C_PARTICULARS = 86
const C_QTY         = 12
const C_UNITCOST    = 42
const C_AMOUNT      = 42

function fmt(n) {
  return 'Rs. ' + Number(n).toLocaleString('en-IN')
}

// ── Mock data ────────────────────────────────────────────────────────────────
const quotationNumber = 'ALAH/25-26/0042'
const date            = '2025-09-22'
const validUntil      = '2025-10-07'

const customer = {
  name:          'Rajesh Kumar Patel',
  address:       'Plot 14, GIDC Industrial Estate, Vatva, Ahmedabad – 382445',
  mobile:        '+91 98765 43210',
  gstin:         '24ABCDE1234F1Z5',
  hypothecation: 'HDFC Bank, Ahmedabad',
}

const entity = {
  full_name:    'Paras Trucks And Buses Pvt. Ltd.',
  address:      'Survey No. 421/1, Nr. Tata Motors, Sarkhej–Bavla Highway, Ahmedabad – 382210',
  gstin:        '24AAKCP1234Q1ZR',
  bank_account: '50200012345678',
  bank_name:    'HDFC Bank, Sarkhej Branch, Ahmedabad',
  bank_ifsc:    'HDFC0001234',
}

const lineItems = [
  {
    description: 'Ashok Leyland 1415 HB, 14T GVW, 150 HP – H4 BS6 Engine, 3900 WB, Day AC Cabin CBC, 208L fuel tank, 6-speed OD GB',
    cbn:         'CDB141514C0002',
    qty:         1,
    mrp:         2850000,
    total_cost:  2850000,
  },
  {
    description: 'Ashok Leyland 2518 IL, 25T GVW, 180 HP – H6 BS6 Engine, 4800 WB, Day AC Cabin CBC, 300L fuel tank, 9-speed OD GB',
    cbn:         'CHU181914C0012',
    qty:         2,
    mrp:         4200000,
    total_cost:  8400000,
  },
]

const tcsRate   = 1
const tcsAmount = Math.round((lineItems.reduce((s, i) => s + i.total_cost, 0)) * 0.01)
const rtoTax    = 145000
const insurance = 68500
const grandTotal = lineItems.reduce((s, i) => s + i.total_cost, 0) + tcsAmount + rtoTax + insurance

const TERMS = [
  'Above prices are current ex-showroom prices. Buyer will have to pay prices prevailing at the time of delivery.',
  'Optional accessories, Insurance, Registration, Taxes, Octroi, other levies etc. will be charged extra as applicable.',
  'Prices are for current specifications and are subject to change without notice.',
  'Prices and additional charges as above will have to be paid completely, to conclude the sales.',
  'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS AND BUSES.',
  'Delivery will be effected after two days of completion of finance documentation, submission of PDCs, approval & disbursement of loans etc.',
  'Acceptance of advance/deposit by seller is merely an indication of intention of sell and does not result into a contract of sale.',
  'All disputes arising between the parties hereto shall be referred to arbitration according to the arbitration laws of the country.',
  'Only the court of Ahmedabad shall have jurisdiction in any proceedings relating to this contract.',
  'The company shall not be liable due to any prevention, hindrance, or delay in manufacture or delivery of vehicles due to shortage of material, strike, riot, civil commotion, accident, machinery breakdown, government policies, act of God or nature, and all events beyond the control of the company.',
  'The seller shall have a general lien on goods for all moneys due to seller from buyer on account of this or other transaction.',
  'Taxes and duties will be applicable as per regulations on the date of supply.',
  'I/We hereby certify that my/our Registration certificate under the G.S.T. is in force on the date on which the sale of the goods specified in this bill/cash memorandum has been effected by me/us in the regular course of my/our business.',
]

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Generate ─────────────────────────────────────────────────────────────────
const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
let y = MARGIN

// Logos placeholder
doc.setFont('helvetica', 'bold')
doc.setFontSize(14)
doc.setTextColor(...BLUE)
doc.text('PARAS TRUCKS & BUSES', MARGIN, y + 8)
doc.setFontSize(10)
doc.setTextColor(...GRAY)
doc.text('ASHOK LEYLAND', PAGE_W - MARGIN, y + 8, { align: 'right' })
y += 14 + 2

// Auth dealer line
doc.setFont('helvetica', 'italic')
doc.setFontSize(7.5)
doc.setTextColor(...GRAY)
doc.text('(Auth. Dealer :- Ashok Leyland India Ltd.)', MARGIN, y)
y += 4

doc.setFont('helvetica', 'normal')
doc.setFontSize(7.5)
doc.setTextColor(...GRAY_DARK)
const addrLines = doc.splitTextToSize('Main Office : ' + entity.address, CONTENT_W)
doc.text(addrLines, MARGIN, y)
y += addrLines.length * 4 + 2

// Blue divider
doc.setDrawColor(...BLUE)
doc.setLineWidth(0.6)
doc.line(MARGIN, y, PAGE_W - MARGIN, y)
y += 5

// Title
doc.setFont('helvetica', 'bold')
doc.setFontSize(13)
doc.setTextColor(...GRAY_DARK)
doc.text('QUOTATION', PAGE_W / 2, y, { align: 'center' })
y += 7

// S.No + Date
doc.setFontSize(8.5)
doc.setFont('helvetica', 'bold')
doc.text('S.No: ' + quotationNumber, MARGIN, y)
doc.text('DATE : ' + fmtDate(date), PAGE_W - MARGIN, y, { align: 'right' })
y += 7

// Customer divider
doc.setDrawColor(...GRAY_LIGHT)
doc.setLineWidth(0.2)
doc.line(MARGIN, y, PAGE_W - MARGIN, y)
y += 4

// Customer fields
const custFields = [
  ['NAME',     customer.name],
  ['ADDRESS',  customer.address],
  ['MOBILE NO',customer.mobile],
  ['GSTIN',    customer.gstin],
  ['Hypo',     customer.hypothecation],
]
doc.setFontSize(8.5)
custFields.forEach(([label, value]) => {
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY_DARK)
  doc.text(label + ':', MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.text(value || '', MARGIN + 28, y)
  y += 5
})

y += 2
doc.setDrawColor(...GRAY_LIGHT)
doc.line(MARGIN, y, PAGE_W - MARGIN, y)
y += 4

// Vehicle table
const totalQty = lineItems.reduce((s, i) => s + i.qty, 0)

const bodyRows = lineItems.map(item => [
  item.description + (item.cbn ? '\n' + item.cbn : ''),
  { content: String(item.qty), styles: { halign: 'center' } },
  { content: fmt(item.mrp), styles: { halign: 'right' } },
  { content: fmt(item.total_cost), styles: { halign: 'right' } },
])

bodyRows.push([
  { content: 'TCS ' + tcsRate + '% ……………………………………', styles: { halign: 'right', fontStyle: 'normal', textColor: GRAY_DARK } },
  { content: '', styles: { halign: 'center' } },
  { content: totalQty > 0 ? fmt(Math.round(tcsAmount / totalQty)) : '', styles: { halign: 'right' } },
  { content: fmt(tcsAmount), styles: { halign: 'right' } },
])
bodyRows.push([
  { content: 'RTO TAX (ADDITIONAL) ……………………………………', styles: { halign: 'left', fontStyle: 'normal', textColor: GRAY_DARK } },
  { content: '', styles: { halign: 'center' } },
  { content: '', styles: { halign: 'right' } },
  { content: fmt(rtoTax), styles: { halign: 'right' } },
])
bodyRows.push([
  { content: 'INSURANCE (ADDITIONAL) ………………………………', styles: { halign: 'left', fontStyle: 'normal', textColor: GRAY_DARK } },
  { content: '', styles: { halign: 'center' } },
  { content: '', styles: { halign: 'right' } },
  { content: fmt(insurance), styles: { halign: 'right' } },
])

autoTable(doc, {
  startY: y,
  margin: { left: MARGIN, right: MARGIN },
  head: [[
    { content: 'Particulars', styles: { halign: 'center' } },
    { content: 'Qty.', styles: { halign: 'center' } },
    { content: 'Unit Cost', styles: { halign: 'center' } },
    { content: 'Amount', styles: { halign: 'center' } },
  ]],
  body: bodyRows,
  foot: [[
    { content: 'GRAND TOTAL', styles: { halign: 'right', fontStyle: 'bold', fontSize: 9, textColor: GRAY_DARK } },
    { content: String(totalQty), styles: { halign: 'center', fontStyle: 'bold', fontSize: 9, textColor: GRAY_DARK } },
    { content: '', styles: {} },
    { content: fmt(grandTotal), styles: { halign: 'right', fontStyle: 'bold', fontSize: 9, textColor: GRAY_DARK } },
  ]],
  styles: { fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 3, right: 3 }, valign: 'top', overflow: 'linebreak', lineColor: GRAY_LIGHT, lineWidth: 0.2 },
  headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
  columnStyles: {
    0: { cellWidth: C_PARTICULARS },
    1: { cellWidth: C_QTY, halign: 'center' },
    2: { cellWidth: C_UNITCOST, halign: 'right' },
    3: { cellWidth: C_AMOUNT, halign: 'right' },
  },
  alternateRowStyles: { fillColor: [248, 252, 255] },
  footStyles: { fillColor: [235, 245, 252], textColor: GRAY_DARK, lineColor: GRAY_LIGHT, lineWidth: 0.2 },
  showFoot: 'lastPage',
})

y = doc.lastAutoTable.finalY + 5

// Note + bank
doc.setFont('helvetica', 'bold')
doc.setFontSize(8)
doc.setTextColor(...GRAY_DARK)
doc.text('Note : Please issue DD / Cheque / RTGS in Favour of ' + entity.full_name, MARGIN, y)
y += 5
doc.setFont('helvetica', 'normal')
doc.setFontSize(7.5)
doc.text('Account No. :- ' + entity.bank_account, MARGIN, y); y += 4
doc.text('Bank Name :- ' + entity.bank_name, MARGIN, y); y += 4
doc.text('RTGS/NEFT/IFSC Code : ' + entity.bank_ifsc, MARGIN, y); y += 7

// Terms
doc.setFont('helvetica', 'bold')
doc.setFontSize(8)
doc.text('Terms & Conditions', MARGIN, y)
y += 4

doc.setFont('helvetica', 'normal')
doc.setFontSize(6.8)
doc.setTextColor(...GRAY)

const validityDays = Math.ceil((new Date(validUntil) - new Date(date)) / (1000 * 60 * 60 * 24))
const allTerms = [
  `This quotation is valid for ${validityDays} days from the date of issue (until ${fmtDate(validUntil)}).`,
  ...TERMS,
]

allTerms.forEach((term, i) => {
  const line = (i + 1) + '-  ' + term
  const lines = doc.splitTextToSize(line, CONTENT_W)
  doc.text(lines, MARGIN, y)
  y += lines.length * 3.3 + 0.5
})

y += 5

// Signatures
const sigY = y
const rx = PAGE_W - MARGIN
doc.setFont('helvetica', 'bold')
doc.setFontSize(8.5)
doc.setTextColor(...GRAY_DARK)
doc.text('For ' + entity.full_name, rx, sigY, { align: 'right' })

// Stamp image — 33×22mm
const stampData = fs.readFileSync('public/al-stamp.png')
const stampB64 = 'data:image/png;base64,' + stampData.toString('base64')
doc.addImage(stampB64, 'PNG', rx - 33, sigY + 3, 33, 22)

const sigLineY = sigY + 26
doc.setDrawColor(...GRAY_LIGHT)
doc.setLineWidth(0.3)
doc.line(rx - 55, sigLineY, rx, sigLineY)
doc.line(MARGIN, sigLineY, MARGIN + 50, sigLineY)

doc.setFont('helvetica', 'normal')
doc.setFontSize(7.5)
doc.setTextColor(...GRAY)
doc.text('Authorised Signatory', rx - 55, sigLineY + 4)
doc.text("Customer's Signature", MARGIN, sigLineY + 4)

doc.setFontSize(7)
doc.text('GSTN:- ' + entity.gstin, MARGIN, sigLineY + 12)

// Save
const pdfBytes = doc.output('arraybuffer')
fs.writeFileSync('sample_quotation.pdf', Buffer.from(pdfBytes))
console.log('Saved: sample_quotation.pdf')
