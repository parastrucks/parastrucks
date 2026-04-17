import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MARGIN = 14
const PAGE_W = 210
const CONTENT_W = PAGE_W - MARGIN * 2   // 182 mm

const BLUE       = [0, 137, 207]
const GRAY_DARK  = [30, 30, 30]
const GRAY       = [90, 90, 90]
const GRAY_LIGHT = [210, 210, 210]

// Table column widths — must sum to CONTENT_W (182 mm)
const C_PARTICULARS = 102
const C_QTY         = 12
const C_UNITCOST    = 34
const C_AMOUNT      = 34
// 86 + 12 + 42 + 42 = 182 ✓

function fmt(n) {
  if (n == null || n === '') return ''
  return 'Rs. ' + Number(n).toLocaleString('en-IN')
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const safe = (v, fallback = '—') => (v == null || v === '' ? fallback : String(v))

// Module-level so repeat PDF exports in the same session skip refetching assets.
const imageCache = new Map()

async function loadImageAsDataURI(path) {
  if (imageCache.has(path)) return imageCache.get(path)
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUri = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
    imageCache.set(path, dataUri)
    return dataUri
  } catch {
    return null
  }
}

// Converts an SVG text string → PNG base64 via canvas
async function svgToPng(svgText, renderW, renderH) {
  return new Promise((resolve) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = renderW
      canvas.height = renderH
      canvas.getContext('2d').drawImage(img, 0, 0, renderW, renderH)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

async function getALLogo() {
  try {
    const res = await fetch('/ashok-leyland-logo.svg')
    if (!res.ok) return null
    const text = await res.text()
    // SVG viewBox is 188×40; render at 3× for crispness
    return await svgToPng(text, 564, 120)
  } catch {
    return null
  }
}

const TERMS = [
  'Above prices are current ex-showroom prices. Buyer will have to pay prices prevailing at the time of delivery.',
  'Optional accessories, Insurance, Registration, Taxes, Octroi, other levies etc. will be charged extra as applicable.',
  'Prices are for current specifications and are subject to change without notice.',
  'Prices and additional charges as above will have to be paid completely, to conclude the sales.',
  // Term 5 — payment line differs by entity (set dynamically below)
  'Delivery will be effected after two days of completion of finance documentation, submission of PDCs, approval & disbursement of loans etc.',
  'Acceptance of advance/deposit by seller is merely an indication of intention of sell and does not result into a contract of sale.',
  'All disputes arising between the parties hereto shall be referred to arbitration according to the arbitration laws of the country.',
  // Term 9 — jurisdiction differs by entity (set dynamically below)
  'The company shall not be liable due to any prevention, hindrance, or delay in manufacture or delivery of vehicles due to shortage of material, strike, riot, civil commotion, accident, machinery breakdown, government policies, act of God or nature, and all events beyond the control of the company.',
  'The seller shall have a general lien on goods for all moneys due to seller from buyer on account of this or other transaction.',
  'Taxes and duties will be applicable as per regulations on the date of supply.',
  'I/We hereby certify that my/our Registration certificate under the G.S.T. is in force on the date on which the sale of the goods specified in this bill/cash memorandum has been effected by me/us in the regular course of my/our business.',
]

export async function generateQuotationPDF(data) {
  const {
    quotationNumber, date, validUntil,
    customer, entity, entityCode,
    lineItems, tcsRate, tcsAmount, rtoTax, insurance, grandTotal,
    preparedBy,
  } = data

  if (!entity) throw new Error('Cannot generate PDF: entity is missing')
  if (!customer?.name) throw new Error('Cannot generate PDF: customer name is missing')
  if (!lineItems || lineItems.length === 0) throw new Error('Cannot generate PDF: at least one line item is required')

  const isPT = entityCode === 'PT'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = MARGIN

  // ── LOGOS ────────────────────────────────────────────────────
  const [parasLogo, alLogo] = await Promise.all([
    loadImageAsDataURI('/paras-logo.png'),
    getALLogo(),
  ])

  const LOGO_H = 14
  if (parasLogo) {
    doc.addImage(parasLogo, 'PNG', MARGIN, y, 42, LOGO_H)
  }
  if (alLogo) {
    // SVG is 188×40 aspect → at height LOGO_H mm → width = 188/40 * LOGO_H
    const alW = Math.round((188 / 40) * LOGO_H)   // ≈ 66 mm
    doc.addImage(alLogo, 'PNG', PAGE_W - MARGIN - alW, y, alW, LOGO_H)
  }

  y += LOGO_H + 2

  // Auth dealer + address below logos
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text('(Auth. Dealer :- Ashok Leyland India Ltd.)', MARGIN, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY_DARK)
  const addrLines = doc.splitTextToSize('Main Office : ' + safe(entity.address), CONTENT_W)
  doc.text(addrLines, MARGIN, y)
  y += addrLines.length * 4 + 2

  // ── FULL-WIDTH DIVIDER ────────────────────────────────────────
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  // ── QUOTATION TITLE ───────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GRAY_DARK)
  doc.text('QUOTATION', PAGE_W / 2, y, { align: 'center' })
  y += 7

  // S.No + Date on same line
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY_DARK)
  doc.text('S.No: ' + quotationNumber, MARGIN, y)
  doc.text('DATE : ' + fmtDate(date), PAGE_W - MARGIN, y, { align: 'right' })
  y += 6

  y += 1

  // ── CUSTOMER BLOCK ────────────────────────────────────────────
  doc.setDrawColor(...GRAY_LIGHT)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 4

  const custFields = [
    ['NAME',          customer.name],
    ['ADDRESS',       customer.address],
    ['MOBILE NO',     customer.mobile],
    ['GSTIN',         customer.gstin],
    ['Hypo',          customer.hypothecation],
  ]

  doc.setFontSize(8.5)
  custFields.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY_DARK)
    doc.text(label + ':', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value ? String(value) : '', MARGIN + 28, y)
    y += 5
  })

  y += 2
  doc.setDrawColor(...GRAY_LIGHT)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 4

  // ── VEHICLE TABLE ─────────────────────────────────────────────
  const totalQty = lineItems.reduce((s, i) => s + i.qty, 0)

  // Body rows — vehicle lines
  const bodyRows = lineItems.map(item => [
    item.description,
    { content: String(item.qty), styles: { halign: 'center' } },
    { content: fmt(item.mrp), styles: { halign: 'right' } },
    { content: fmt(item.total_cost), styles: { halign: 'right' } },
  ])

  // TCS row
  bodyRows.push([
    {
      content: 'TCS ' + tcsRate + '% ……………………………………',
      styles: { halign: 'right', fontStyle: 'normal', textColor: GRAY_DARK },
    },
    { content: '', styles: { halign: 'center' } },
    { content: totalQty > 0 ? fmt(Math.round(tcsAmount / totalQty)) : '', styles: { halign: 'right' } },
    { content: fmt(tcsAmount), styles: { halign: 'right' } },
  ])

  // RTO row (if applicable)
  if (rtoTax) {
    bodyRows.push([
      {
        content: 'RTO TAX (ADDITIONAL) ……………………….',
        styles: { halign: 'left', fontStyle: 'normal', textColor: GRAY_DARK },
      },
      { content: '', styles: { halign: 'center' } },
      { content: '', styles: { halign: 'right' } },
      { content: fmt(rtoTax), styles: { halign: 'right' } },
    ])
  }

  // Insurance row (if applicable)
  if (insurance) {
    bodyRows.push([
      {
        content: 'INSURANCE (ADDITIONAL) ……………….',
        styles: { halign: 'left', fontStyle: 'normal', textColor: GRAY_DARK },
      },
      { content: '', styles: { halign: 'center' } },
      { content: '', styles: { halign: 'right' } },
      { content: fmt(insurance), styles: { halign: 'right' } },
    ])
  }

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
    styles: {
      fontSize: 8,
      cellPadding: { top: 3, bottom: 3, left: 3, right: 3 },
      valign: 'top',
      overflow: 'linebreak',
      lineColor: GRAY_LIGHT,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: BLUE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: C_PARTICULARS },
      1: { cellWidth: C_QTY,      halign: 'center' },
      2: { cellWidth: C_UNITCOST, halign: 'right' },
      3: { cellWidth: C_AMOUNT,   halign: 'right' },
    },
    alternateRowStyles: { fillColor: [248, 252, 255] },
    footStyles: {
      fillColor: [235, 245, 252],
      textColor: GRAY_DARK,
      lineColor: GRAY_LIGHT,
      lineWidth: 0.2,
    },
    showFoot: 'lastPage',
  })

  y = doc.lastAutoTable.finalY + 5

  // ── NOTE & BANK DETAILS ───────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY_DARK)
  doc.text(
    'Note : Please issue DD / Cheque / RTGS in Favour of ' + safe(entity.full_name),
    MARGIN, y
  )
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('Account No. :- ' + safe(entity.bank_account), MARGIN, y); y += 4
  doc.text('Bank Name :- ' + safe(entity.bank_name), MARGIN, y);       y += 4
  doc.text('RTGS/NEFT/IFSC Code : ' + safe(entity.bank_ifsc), MARGIN, y); y += 7

  // ── TERMS & CONDITIONS ───────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Terms & Conditions', MARGIN, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(...GRAY)

  const validityDays = validUntil
    ? Math.ceil((new Date(validUntil) - new Date(date)) / (1000 * 60 * 60 * 24))
    : null

  // Build entity-specific terms
  const entityTerms = [...TERMS]
  // Term index 4 (5th term) — payment favouring name
  entityTerms[4] = isPT
    ? 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS.'
    : 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS AND BUSES.'
  // Term index 8 (9th term) — jurisdiction
  entityTerms[8] = isPT
    ? 'Only the court of Hisar shall have jurisdiction in any proceedings relating to this contract.'
    : 'Only the court of Ahmedabad shall have jurisdiction in any proceedings relating to this contract.'

  const allTerms = [
    validityDays != null
      ? `This quotation is valid for ${validityDays} day${validityDays !== 1 ? 's' : ''} from the date of issue (until ${fmtDate(validUntil)}).`
      : null,
    ...entityTerms,
  ].filter(Boolean)

  allTerms.forEach((term, i) => {
    const line = (i + 1) + '-  ' + term
    const lines = doc.splitTextToSize(line, CONTENT_W)
    doc.text(lines, MARGIN, y)
    y += lines.length * 3.3 + 0.5
  })

  y += 5

  // ── SIGNATURES ────────────────────────────────────────────────
  const sigY = y

  // Right block: "For [Entity]"
  const rx = PAGE_W - MARGIN
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRAY_DARK)
  doc.text('For ' + safe(entity.full_name), rx, sigY, { align: 'right' })

  // Stamp image — 33×22mm (entity-specific)
  const stamp = await loadImageAsDataURI(isPT ? '/pt-stamp.png' : '/al-stamp.png')
  if (stamp) {
    doc.addImage(stamp, 'PNG', rx - 33, sigY + 3, 33, 22)
  }

  const sigLineY = sigY + 26
  doc.setDrawColor(...GRAY_LIGHT)
  doc.setLineWidth(0.3)
  doc.line(rx - 55, sigLineY, rx, sigLineY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text('Authorised Signatory', rx - 55, sigLineY + 4)

  // Left block: Customer signature
  doc.line(MARGIN, sigLineY, MARGIN + 50, sigLineY)
  doc.text("Customer's Signature", MARGIN, sigLineY + 4)

  // GSTN bottom left
  doc.setFontSize(7)
  doc.text('GSTN:- ' + safe(entity.gstin), MARGIN, sigLineY + 12)

  doc.save('Quotation_' + quotationNumber.replace(/\//g, '-') + '.pdf')
}
