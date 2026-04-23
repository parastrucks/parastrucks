import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { stateNameFromCode, panFromGstin, stateCodeFromGstin } from './gstUtils'
import { inrInWords } from './amountInWords'

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
    const valStr   = value ? String(value) : ''
    const valLines = doc.splitTextToSize(valStr, CONTENT_W - 28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY_DARK)
    doc.text(label + ':', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valLines, MARGIN + 28, y)
    y += valLines.length * 5
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

export async function generateProformaPdf(data) {
  const {
    piNumber, date, validUntil,
    customer, entity, entityCode,
    lineItems, tcsRate, tcsAmount, rtoTax, insurance, grandTotal,
    chassisNo, engineNo,
    preparedBy,
  } = data

  if (!entity) throw new Error('Cannot generate PDF: entity is missing')
  if (!customer?.name) throw new Error('Cannot generate PDF: customer name is missing')
  if (!lineItems || lineItems.length === 0) throw new Error('Cannot generate PDF: at least one line item is required')

  const isPT = entityCode === 'PT'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = MARGIN

  const [parasLogo, alLogo] = await Promise.all([
    loadImageAsDataURI('/paras-logo.png'),
    getALLogo(),
  ])

  const LOGO_H = 14
  if (parasLogo) {
    doc.addImage(parasLogo, 'PNG', MARGIN, y, 42, LOGO_H)
  }
  if (alLogo) {
    const alW = Math.round((188 / 40) * LOGO_H)
    doc.addImage(alLogo, 'PNG', PAGE_W - MARGIN - alW, y, alW, LOGO_H)
  }

  y += LOGO_H + 2

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

  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GRAY_DARK)
  doc.text('PROFORMA INVOICE', PAGE_W / 2, y, { align: 'center' })
  y += 7

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY_DARK)
  doc.text('PI No: ' + piNumber, MARGIN, y)
  doc.text('DATE : ' + fmtDate(date), PAGE_W - MARGIN, y, { align: 'right' })
  y += 6

  y += 1

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
    const valStr   = value ? String(value) : ''
    const valLines = doc.splitTextToSize(valStr, CONTENT_W - 28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY_DARK)
    doc.text(label + ':', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valLines, MARGIN + 28, y)
    y += valLines.length * 5
  })

  y += 2
  doc.setDrawColor(...GRAY_LIGHT)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 4

  const totalQty = lineItems.reduce((s, i) => s + i.qty, 0)

  const bodyRows = []
  lineItems.forEach(item => {
    bodyRows.push([
      item.description,
      { content: String(item.qty), styles: { halign: 'center' } },
      { content: fmt(item.mrp), styles: { halign: 'right' } },
      { content: fmt(item.total_cost), styles: { halign: 'right' } },
    ])
    if (chassisNo) {
      bodyRows.push([
        { content: 'Chassis No: ' + chassisNo, styles: { fontStyle: 'bold', fontSize: 8, textColor: GRAY_DARK } },
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: '', styles: {} },
      ])
    }
    if (engineNo) {
      bodyRows.push([
        { content: 'Engine No: ' + engineNo, styles: { fontStyle: 'bold', fontSize: 8, textColor: GRAY_DARK } },
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: '', styles: {} },
      ])
    }
  })

  bodyRows.push([
    {
      content: 'TCS ' + tcsRate + '% ……………………………………',
      styles: { halign: 'right', fontStyle: 'normal', textColor: GRAY_DARK },
    },
    { content: '', styles: { halign: 'center' } },
    { content: totalQty > 0 ? fmt(Math.round(tcsAmount / totalQty)) : '', styles: { halign: 'right' } },
    { content: fmt(tcsAmount), styles: { halign: 'right' } },
  ])

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

  const entityTerms = [...TERMS]
  entityTerms[4] = isPT
    ? 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS.'
    : 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS AND BUSES.'
  entityTerms[8] = isPT
    ? 'Only the court of Hisar shall have jurisdiction in any proceedings relating to this contract.'
    : 'Only the court of Ahmedabad shall have jurisdiction in any proceedings relating to this contract.'

  const allTerms = [
    validityDays != null
      ? `This proforma invoice is valid for ${validityDays} day${validityDays !== 1 ? 's' : ''} from the date of issue (until ${fmtDate(validUntil)}).`
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

  const sigY = y
  const rx = PAGE_W - MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRAY_DARK)
  doc.text('For ' + safe(entity.full_name), rx, sigY, { align: 'right' })

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

  doc.line(MARGIN, sigLineY, MARGIN + 50, sigLineY)
  doc.text("Customer's Signature", MARGIN, sigLineY + 4)

  doc.setFontSize(7)
  doc.text('GSTN:- ' + safe(entity.gstin), MARGIN, sigLineY + 12)

  doc.save('ProformaInvoice_' + piNumber.replace(/[-/]/g, '_') + '.pdf')
}

// V1: pre-redesign 4-column layout. Kept unchanged for byte-identical re-download of
// pre-migration FCs (rows where financier_copies.pdf_format_version = 1).
export async function generateFinancierCopyPdfV1(data) {
  const {
    fcNumber, date,
    customer, entity, entityCode,
    lineItems, tcsRate, tcsAmount, rtoTax, insurance, grandTotal,
    chassisNo, engineNo,
    preparedBy,
  } = data

  if (!entity) throw new Error('Cannot generate PDF: entity is missing')
  if (!customer?.name) throw new Error('Cannot generate PDF: customer name is missing')
  if (!lineItems || lineItems.length === 0) throw new Error('Cannot generate PDF: at least one line item is required')

  const isPT = entityCode === 'PT'

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y = MARGIN

  const [parasLogo, alLogo] = await Promise.all([
    loadImageAsDataURI('/paras-logo.png'),
    getALLogo(),
  ])

  // Draw "(Financier's copy)" italic label right-aligned above the AL logo
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text("(Financier's copy)", PAGE_W - MARGIN, y, { align: 'right' })
  y += 4

  const LOGO_H = 14
  if (parasLogo) {
    doc.addImage(parasLogo, 'PNG', MARGIN, y, 42, LOGO_H)
  }
  if (alLogo) {
    const alW = Math.round((188 / 40) * LOGO_H)
    doc.addImage(alLogo, 'PNG', PAGE_W - MARGIN - alW, y, alW, LOGO_H)
  }

  y += LOGO_H + 2

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

  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GRAY_DARK)
  doc.text('TAX INVOICE', PAGE_W / 2, y, { align: 'center' })
  y += 7

  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...GRAY_DARK)
  doc.text('FC No: ' + fcNumber, MARGIN, y)
  doc.text('DATE : ' + fmtDate(date), PAGE_W - MARGIN, y, { align: 'right' })
  y += 6

  y += 1

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
    const valStr   = value ? String(value) : ''
    const valLines = doc.splitTextToSize(valStr, CONTENT_W - 28)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...GRAY_DARK)
    doc.text(label + ':', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    doc.text(valLines, MARGIN + 28, y)
    y += valLines.length * 5
  })

  y += 2
  doc.setDrawColor(...GRAY_LIGHT)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 4

  const totalQty = lineItems.reduce((s, i) => s + i.qty, 0)

  const bodyRows = []
  lineItems.forEach(item => {
    bodyRows.push([
      item.description,
      { content: String(item.qty), styles: { halign: 'center' } },
      { content: fmt(item.mrp), styles: { halign: 'right' } },
      { content: fmt(item.total_cost), styles: { halign: 'right' } },
    ])
    if (chassisNo) {
      bodyRows.push([
        { content: 'Chassis No: ' + chassisNo, styles: { fontStyle: 'bold', fontSize: 8, textColor: GRAY_DARK } },
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: '', styles: {} },
      ])
    }
    if (engineNo) {
      bodyRows.push([
        { content: 'Engine No: ' + engineNo, styles: { fontStyle: 'bold', fontSize: 8, textColor: GRAY_DARK } },
        { content: '', styles: {} },
        { content: '', styles: {} },
        { content: '', styles: {} },
      ])
    }
  })

  bodyRows.push([
    {
      content: 'TCS ' + tcsRate + '% ……………………………………',
      styles: { halign: 'right', fontStyle: 'normal', textColor: GRAY_DARK },
    },
    { content: '', styles: { halign: 'center' } },
    { content: totalQty > 0 ? fmt(Math.round(tcsAmount / totalQty)) : '', styles: { halign: 'right' } },
    { content: fmt(tcsAmount), styles: { halign: 'right' } },
  ])

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

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Terms & Conditions', MARGIN, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(...GRAY)

  const entityTerms = [...TERMS]
  entityTerms[4] = isPT
    ? 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS.'
    : 'Payments for all the above items will be by demand drafts, RTGS favouring to PARAS TRUCKS AND BUSES.'
  entityTerms[8] = isPT
    ? 'Only the court of Hisar shall have jurisdiction in any proceedings relating to this contract.'
    : 'Only the court of Ahmedabad shall have jurisdiction in any proceedings relating to this contract.'

  const allTerms = entityTerms

  allTerms.forEach((term, i) => {
    const line = (i + 1) + '-  ' + term
    const lines = doc.splitTextToSize(line, CONTENT_W)
    doc.text(lines, MARGIN, y)
    y += lines.length * 3.3 + 0.5
  })

  y += 5

  const sigY = y
  const rx = PAGE_W - MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRAY_DARK)
  doc.text('For ' + safe(entity.full_name), rx, sigY, { align: 'right' })

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

  doc.line(MARGIN, sigLineY, MARGIN + 50, sigLineY)
  doc.text("Customer's Signature", MARGIN, sigLineY + 4)

  doc.setFontSize(7)
  doc.text('GSTN:- ' + safe(entity.gstin), MARGIN, sigLineY + 12)

  doc.save('FinancierCopy_' + fcNumber.replace(/[-/]/g, '_') + '.pdf')
}

// ─────────────────────────────────────────────────────────────────────────────
// V2: Tax-invoice layout — HSN, CGST/SGST or IGST split, PAN, amount-in-words,
// optional ship-to block. Used for all FCs saved after 2026-04-21
// (pdf_format_version = 2).
//
// Expected data shape (assembled by FinancierCopy.jsx / re-download flow):
//   fcNumber, date
//   customer: { name, address, mobile, gstin, hypothecation }
//   shipTo:   { enabled, name, address, gstin, state } | null
//   entity:   { full_name, address, gstin, bank_name, bank_account, bank_ifsc }
//   entityCode
//   lineItems: [{
//     cbn, description, hsn, qty,
//     mrp_incl, taxable,
//     cgst_rate, cgst_amt, sgst_rate, sgst_amt, igst_rate, igst_amt,
//     total, chassis_no, engine_no, rto, insurance,
//   }]
//   taxType:            'intra' | 'inter'
//   sellerStateCode:    '24' etc.
//   buyerStateCode:     '24' etc.
//   tcsRate, tcsAmount
//   totals: { taxableTotal, cgstTotal, sgstTotal, igstTotal, rtoTotal, insTotal, afterTax, gTotal }
//   amountInWords:      pre-computed via inrInWords(gTotal)
// ─────────────────────────────────────────────────────────────────────────────
export async function generateFinancierCopyPdfV2(data) {
  const {
    fcNumber, date,
    customer, shipTo, entity, entityCode,
    lineItems,
    taxType,
    sellerStateCode, buyerStateCode,
    tcsRate, tcsAmount,
    totals,
    amountInWords,
  } = data

  if (!entity) throw new Error('Cannot generate PDF: entity is missing')
  if (!customer?.name) throw new Error('Cannot generate PDF: customer name is missing')
  if (!lineItems || lineItems.length === 0) throw new Error('Cannot generate PDF: at least one line item is required')

  const isPT    = entityCode === 'PT'
  const isIntra = taxType !== 'inter'    // default to intra if undefined (defensive)
  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  let y         = MARGIN

  // ── Pre-fetch all image assets in parallel ─────────────────────────────────
  const [parasLogo, alLogo, stamp] = await Promise.all([
    loadImageAsDataURI('/paras-logo.png'),
    getALLogo(),
    loadImageAsDataURI(isPT ? '/pt-stamp.png' : '/al-stamp.png'),
  ])

  // ── 1) Header: "(Finance copy)" label + logos + dealer line + address ──────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  doc.text('(Finance copy)', PAGE_W - MARGIN, y, { align: 'right' })
  y += 4

  const LOGO_H = 14
  if (parasLogo) doc.addImage(parasLogo, 'PNG', MARGIN, y, 42, LOGO_H)
  if (alLogo) {
    const alW = Math.round((188 / 40) * LOGO_H)
    doc.addImage(alLogo, 'PNG', PAGE_W - MARGIN - alW, y, alW, LOGO_H)
  }
  y += LOGO_H + 2

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
  y += addrLines.length * 4 + 1

  // Dealer GSTIN line (helps banks verify)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('GSTIN : ' + safe(entity.gstin), MARGIN, y)
  y += 4

  // Blue divider kept per user preference (sample has plain border; we prefer current)
  doc.setDrawColor(...BLUE)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  // ── 2) TAX INVOICE title ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...GRAY_DARK)
  doc.text('TAX INVOICE', PAGE_W / 2, y, { align: 'center' })
  y += 6

  // ── 3) Info grid: Invoice No | Date ; State (+Code) | Place of Supply (+Code)
  //    Drawn as a 2×2 bordered grid.
  const INFO_H  = 7
  const INFO_Y0 = y
  const halfW   = CONTENT_W / 2
  doc.setDrawColor(...GRAY_LIGHT)
  doc.setLineWidth(0.2)
  // outer rect + mid-horizontal + mid-vertical
  doc.rect(MARGIN, INFO_Y0, CONTENT_W, INFO_H * 2)
  doc.line(MARGIN, INFO_Y0 + INFO_H, PAGE_W - MARGIN, INFO_Y0 + INFO_H)
  doc.line(MARGIN + halfW, INFO_Y0, MARGIN + halfW, INFO_Y0 + INFO_H * 2)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Invoice No :', MARGIN + 2, INFO_Y0 + 4.5)
  doc.text('Date :', MARGIN + halfW + 2, INFO_Y0 + 4.5)
  doc.text('State :', MARGIN + 2, INFO_Y0 + INFO_H + 4.5)
  doc.text('Place of Supply :', MARGIN + halfW + 2, INFO_Y0 + INFO_H + 4.5)

  doc.setFont('helvetica', 'normal')
  doc.text(safe(fcNumber), MARGIN + 24, INFO_Y0 + 4.5)
  doc.text(fmtDate(date), MARGIN + halfW + 14, INFO_Y0 + 4.5)

  const sellerStateName = stateNameFromCode(sellerStateCode) || '—'
  const placeCode       = buyerStateCode || sellerStateCode || '—'
  const placeName       = stateNameFromCode(placeCode) || '—'
  doc.text(`${sellerStateName} (Code: ${sellerStateCode || '—'})`, MARGIN + 14, INFO_Y0 + INFO_H + 4.5)
  doc.text(`${placeName} (Code: ${placeCode})`,                    MARGIN + halfW + 32, INFO_Y0 + INFO_H + 4.5)

  y = INFO_Y0 + INFO_H * 2

  // ── 4) Bill To / Ship To — side-by-side bordered blocks ─────────────────────
  //  Each block: Name, Address, GST No (+ PAN), State (+Code). If shipTo
  //  disabled, ship block mirrors bill block.
  const billParty = {
    name:    customer.name,
    address: customer.address,
    gstin:   customer.gstin,
    state:   stateNameFromCode(stateCodeFromGstin(customer.gstin)),
    stateCode: stateCodeFromGstin(customer.gstin) || buyerStateCode || '—',
  }
  const shipParty = (shipTo && shipTo.enabled)
    ? {
        name:    shipTo.name || customer.name,
        address: shipTo.address || customer.address,
        gstin:   shipTo.gstin   || customer.gstin,
        state:   shipTo.state   || stateNameFromCode(stateCodeFromGstin(shipTo.gstin || customer.gstin)),
        stateCode: stateCodeFromGstin(shipTo.gstin) || buyerStateCode || '—',
      }
    : billParty

  // Render each block: fixed-height 28mm bordered rect with labelled lines
  const PARTY_H = 30
  const py      = y
  doc.setDrawColor(...GRAY_LIGHT)
  doc.rect(MARGIN, py, halfW, PARTY_H)
  doc.rect(MARGIN + halfW, py, halfW, PARTY_H)

  function drawParty(xLeft, title, p) {
    let cy = py + 4.5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY_DARK)
    doc.text(title, xLeft + 2, cy)
    cy += 4

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    const nameLines = doc.splitTextToSize('Name: ' + safe(p.name), halfW - 4)
    doc.text(nameLines, xLeft + 2, cy); cy += nameLines.length * 3.5

    const addrLns = doc.splitTextToSize('Address: ' + safe(p.address), halfW - 4)
    doc.text(addrLns, xLeft + 2, cy); cy += Math.min(addrLns.length, 2) * 3.5

    // Skip "GST:" and "State:" rows when we have no meaningful data. For a
    // walk-in / unregistered buyer we'd otherwise print "GST: —" and a state
    // code inherited from the seller — misleading. Only print rows that
    // correspond to information the user actually entered.
    const gstin     = (p.gstin || '').trim()
    const userState = (p.state || '').trim()        // user-typed (ship-to form only)
    if (gstin) {
      const pan = panFromGstin(gstin)
      const stateCode = stateCodeFromGstin(gstin)
      const stateName = stateNameFromCode(stateCode)
      const gstLine = 'GST: ' + gstin + (pan ? '   PAN: ' + pan : '')
      doc.text(gstLine, xLeft + 2, cy); cy += 3.5
      if (stateName) {
        doc.text(`State: ${stateName}  (Code: ${stateCode})`, xLeft + 2, cy)
      }
    } else if (userState) {
      // No GSTIN but user manually typed a state (ship-to case)
      doc.text(`State: ${userState}`, xLeft + 2, cy)
    }
    // else: no GSTIN, no state → suppress both rows entirely
  }
  drawParty(MARGIN,          'Bill To',  billParty)
  drawParty(MARGIN + halfW,  'Ship To',  shipParty)
  y = py + PARTY_H

  // ── 5) Hypothecation strip (full-width, 6mm) ────────────────────────────────
  doc.rect(MARGIN, y, CONTENT_W, 6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Hypothecation :', MARGIN + 2, y + 4)
  doc.setFont('helvetica', 'normal')
  doc.text(safe(customer.hypothecation), MARGIN + 30, y + 4)
  y += 6 + 3

  // ── 6) Item table — dynamic columns by taxType, fixed mm widths ─────────────
  //
  //  Intra (10 cols, sum 182):  9 | 40 | 17 | 9 | 22 | 14 | 22 | 14 | 22 | 13
  //  Inter (8 cols,  sum 182):  9 | 60 | 20 | 9 | 25 | 14 | 25 | 20
  //
  //  Column widths are hard-coded — never autosize — so two tax invoices of the
  //  same regime render with pixel-identical column positions.
  // Header cells — all center-aligned for visual rhythm (body alignment is
  // set separately via columnStyles).
  const headIntra = [
    'S.No', 'Product Description', 'HSN', 'Qty', 'Taxable Value',
    'CGST Rate', 'CGST Amt', 'SGST Rate', 'SGST Amt', 'Total Amt',
  ]
  const headInter = [
    'S.No', 'Product Description', 'HSN', 'Qty', 'Taxable Value',
    'IGST Rate', 'IGST Amt', 'Total Amt',
  ]
  // Fixed mm widths (sum = CONTENT_W = 182 mm). Never autosized — so two FCs
  // of the same regime render with pixel-identical column positions.
  // Total Amt column is sized for up to 1-crore values (~10 chars @ 7.5pt).
  const colsIntra = {
    0: { cellWidth: 9,  halign: 'center' },                       // S.No
    1: { cellWidth: 36, halign: 'left', overflow: 'linebreak' },  // Description
    2: { cellWidth: 16, halign: 'center' },                       // HSN
    3: { cellWidth: 8,  halign: 'center' },                       // Qty
    4: { cellWidth: 22, halign: 'right' },                        // Taxable
    5: { cellWidth: 14, halign: 'center' },                       // CGST Rate
    6: { cellWidth: 22, halign: 'right' },                        // CGST Amt
    7: { cellWidth: 14, halign: 'center' },                       // SGST Rate
    8: { cellWidth: 22, halign: 'right' },                        // SGST Amt
    9: { cellWidth: 19, halign: 'right' },                        // Total Amt
  }
  const colsInter = {
    0: { cellWidth: 9,  halign: 'center' },                       // S.No
    1: { cellWidth: 52, halign: 'left', overflow: 'linebreak' },  // Description
    2: { cellWidth: 20, halign: 'center' },                       // HSN
    3: { cellWidth: 8,  halign: 'center' },                       // Qty
    4: { cellWidth: 25, halign: 'right' },                        // Taxable
    5: { cellWidth: 14, halign: 'center' },                       // IGST Rate
    6: { cellWidth: 25, halign: 'right' },                        // IGST Amt
    7: { cellWidth: 29, halign: 'right' },                        // Total Amt
  }

  // Plain-number format for inside the table (no "Rs." prefix — keeps cells narrow)
  const fmtInt = n => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN'))
  // Total column count depends on regime — used for Chassis/Engine spanning rows
  const ncol = isIntra ? 10 : 8

  const bodyRows = []
  lineItems.forEach((item, i) => {
    const row = isIntra
      ? [
          String(i + 1),
          String(item.description || ''),
          String(item.hsn || ''),
          String(item.qty ?? 1),
          fmtInt(item.taxable),
          (item.cgst_rate ?? 9) + '%',
          fmtInt(item.cgst_amt),
          (item.sgst_rate ?? 9) + '%',
          fmtInt(item.sgst_amt),
          fmtInt(item.total ?? item.taxable),
        ]
      : [
          String(i + 1),
          String(item.description || ''),
          String(item.hsn || ''),
          String(item.qty ?? 1),
          fmtInt(item.taxable),
          (item.igst_rate ?? 18) + '%',
          fmtInt(item.igst_amt),
          fmtInt(item.total ?? item.taxable),
        ]
    bodyRows.push(row)

    // Chassis / Engine as bold full-width rows directly under each line item
    if (item.chassis_no) {
      bodyRows.push([{
        content: 'Chassis No. :- ' + item.chassis_no,
        colSpan: ncol,
        styles: { fontStyle: 'bold', halign: 'left', fontSize: 7.5, textColor: GRAY_DARK },
      }])
    }
    if (item.engine_no) {
      bodyRows.push([{
        content: 'Engine No. :- ' + item.engine_no,
        colSpan: ncol,
        styles: { fontStyle: 'bold', halign: 'left', fontSize: 7.5, textColor: GRAY_DARK },
      }])
    }
  })

  // Footer: Total row summing Qty / Taxable / tax heads / Total Amt.
  // The final "Total Amt" column sums per-line totals (= sum of GST-inclusive
  // line values, not taxable) — matches what the user expects for a tax invoice.
  const qtySum       = lineItems.reduce((s, i) => s + (i.qty   || 0), 0)
  const lineTotalSum = lineItems.reduce((s, i) => s + (i.total || 0), 0)
  const footIntra = [[
    { content: 'Total', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: String(qtySum),                   styles: { halign: 'center', fontStyle: 'bold' } },
    { content: fmtInt(totals.taxableTotal),      styles: { halign: 'right',  fontStyle: 'bold' } },
    { content: '', styles: {} },
    { content: fmtInt(totals.cgstTotal),         styles: { halign: 'right',  fontStyle: 'bold' } },
    { content: '', styles: {} },
    { content: fmtInt(totals.sgstTotal),         styles: { halign: 'right',  fontStyle: 'bold' } },
    { content: fmtInt(lineTotalSum),             styles: { halign: 'right',  fontStyle: 'bold' } },
  ]]
  const footInter = [[
    { content: 'Total', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
    { content: String(qtySum),                   styles: { halign: 'center', fontStyle: 'bold' } },
    { content: fmtInt(totals.taxableTotal),      styles: { halign: 'right',  fontStyle: 'bold' } },
    { content: '', styles: {} },
    { content: fmtInt(totals.igstTotal),         styles: { halign: 'right',  fontStyle: 'bold' } },
    { content: fmtInt(lineTotalSum),             styles: { halign: 'right',  fontStyle: 'bold' } },
  ]]

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [isIntra ? headIntra : headInter],
    body: bodyRows,
    foot: isIntra ? footIntra : footInter,
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2, bottom: 2, left: 1.5, right: 1.5 },
      valign: 'middle',
      overflow: 'visible',           // numeric cells never wrap; desc col overrides this
      lineColor: GRAY_LIGHT,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: BLUE,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',       // all header cells center-aligned
      valign: 'middle',
    },
    footStyles: {
      fillColor: [235, 245, 252],
      textColor: GRAY_DARK,
      fontStyle: 'bold',
      lineColor: GRAY_LIGHT,
      lineWidth: 0.2,
    },
    columnStyles: isIntra ? colsIntra : colsInter,
    tableWidth: CONTENT_W,            // enforce total — no autosize
    showFoot: 'lastPage',
  })

  y = doc.lastAutoTable.finalY + 4

  // ── 7) Right-summary panel (right half) + 8) amount-in-words (left half) ────
  //
  //  Summary order (intra):  Total Amount before Tax | Add: CGST | Add: SGST
  //                         | Total Tax Amount | Total Amount after Tax
  //                         | Add: RTO Tax | Add: Insurance | TCS X% | G Total
  //
  //  Summary order (inter):  Total Amount before Tax | Add: IGST
  //                         | Total Tax Amount | Total Amount after Tax
  //                         | Add: RTO Tax | Add: Insurance | TCS X% | G Total
  //
  //  No "GST on Reverse Charge" row (omitted per user decision).
  const summaryRows = []
  summaryRows.push(['Total Amount before Tax', totals.taxableTotal])
  if (isIntra) {
    summaryRows.push(['Add : CGST', totals.cgstTotal])
    summaryRows.push(['Add : SGST', totals.sgstTotal])
  } else {
    summaryRows.push(['Add : IGST', totals.igstTotal])
  }
  const totalTax = isIntra
    ? (totals.cgstTotal + totals.sgstTotal)
    : totals.igstTotal
  summaryRows.push(['Total Tax Amount', totalTax])
  summaryRows.push(['Total Amount after Tax', totals.afterTax])
  if (totals.rtoTotal) summaryRows.push(['Add : RTO Tax',   totals.rtoTotal])
  if (totals.insTotal) summaryRows.push(['Add : Insurance', totals.insTotal])
  if (tcsAmount)       summaryRows.push([`TCS ${tcsRate}%`,  tcsAmount])
  summaryRows.push(['Grand Total', totals.gTotal])

  // Right half: summary panel drawn as a 2-col autotable
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN + halfW, right: MARGIN },
    body: summaryRows.map(([label, val], idx) => {
      const isGTotal = idx === summaryRows.length - 1
      return [
        { content: label, styles: { halign: 'left',  fontStyle: isGTotal ? 'bold' : 'normal' } },
        { content: fmt(val), styles: { halign: 'right', fontStyle: isGTotal ? 'bold' : 'normal' } },
      ]
    }),
    styles: {
      fontSize: 8,
      cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
      lineColor: GRAY_LIGHT,
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: halfW - 32 },
      1: { cellWidth: 32, halign: 'right' },
    },
    tableWidth: halfW,
  })

  const summaryEndY = doc.lastAutoTable.finalY

  // Left half: bordered box with "Total Invoice Amount in Words" title + words
  const wordsBoxH = summaryEndY - y
  doc.setDrawColor(...GRAY_LIGHT)
  doc.rect(MARGIN, y, halfW, wordsBoxH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY_DARK)
  doc.text('Total Invoice Amount in Words :', MARGIN + 2, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const wordsLines = doc.splitTextToSize(safe(amountInWords), halfW - 6)
  doc.text(wordsLines, MARGIN + halfW / 2, y + 12, { align: 'center', maxWidth: halfW - 6 })

  y = summaryEndY + 5

  // ── 9) Bank details ─────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY_DARK)
  doc.text('Note : Please issue DD / Cheque / RTGS in Favour of ' + safe(entity.full_name), MARGIN, y)
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('Account No. :- ' + safe(entity.bank_account), MARGIN, y); y += 4
  doc.text('Bank Name :- '   + safe(entity.bank_name),    MARGIN, y); y += 4
  doc.text('RTGS/NEFT/IFSC Code : ' + safe(entity.bank_ifsc), MARGIN, y); y += 6

  // ── 10) T&C — 3 lines only, bordered box on left half ──────────────────────
  const tcLines = [
    isPT
      ? '1. All disputes subject to Hisar Jurisdiction only.'
      : '1. All disputes subject to Ahmedabad Jurisdiction only.',
    '2. 18% Interest will be charged on pending amount beyond 15 days.',
    '3. Chassis once Invoiced will not be taken back.',
  ]
  const TC_H = 4 + tcLines.length * 4 + 2
  doc.setDrawColor(...GRAY_LIGHT)
  doc.rect(MARGIN, y, halfW, TC_H)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY_DARK)
  doc.text('Terms & Conditions', MARGIN + 2, y + 4)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.8)
  doc.setTextColor(...GRAY)
  let tcY = y + 8
  tcLines.forEach(line => {
    const ls = doc.splitTextToSize(line, halfW - 4)
    doc.text(ls, MARGIN + 2, tcY)
    tcY += ls.length * 3.3 + 0.3
  })

  // ── 11) Signature block (right half, taller than T&C) ──────────────────────
  //  Layout top-to-bottom:
  //    "For <entity>"          ← bold title
  //    stamp image             ← 33 × 22 mm, below title
  //    ────────────────        ← signature line (below stamp)
  //    "Authorised Signatory"  ← caption under line
  //
  //  The signature block is independent of T&C height — it extends downward
  //  as needed, and the customer-sig block on the left is placed below the
  //  max of both.
  const sigY       = y
  const rx         = PAGE_W - MARGIN
  const STAMP_H    = 22
  const STAMP_W    = 33
  const titleY     = sigY + 4              // "For <entity>"
  const stampY     = sigY + 7              // stamp starts below the title text
  const sigLineY   = stampY + STAMP_H + 2  // line 2mm under stamp bottom
  const captionY   = sigLineY + 4          // caption 4mm under line

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...GRAY_DARK)
  doc.text('For ' + safe(entity.full_name), rx, titleY, { align: 'right' })

  if (stamp) {
    doc.addImage(stamp, 'PNG', rx - STAMP_W, stampY, STAMP_W, STAMP_H)
  }

  doc.setDrawColor(...GRAY_LIGHT)
  doc.setLineWidth(0.3)
  doc.line(rx - 55, sigLineY, rx, sigLineY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text('Authorised Signatory', rx - 55, captionY)

  // ── Customer signature (left half) — shares y-baseline with Authorised Signatory
  //  Both signature lines draw at the same `sigLineY`, so the two captions
  //  ("Customer Signature" | "Authorised Signatory") print on the same line.
  //  The T&C box sits ~13mm above this — leaves space for a physical signature.
  doc.setDrawColor(...GRAY_LIGHT)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, sigLineY, MARGIN + 55, sigLineY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text('Customer Signature', MARGIN, captionY)

  doc.save('FinancierCopy_' + String(fcNumber).replace(/[-/]/g, '_') + '.pdf')
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-download helper — reconstruct the generator's data shape from a saved
// `financier_copies` row. Handles both V1 and V2 rows transparently. Callers
// (MyFinancierCopies / FinancierCopyLog) just do:
//
//   await generateFinancierCopyPdf(buildFinancierCopyPdfArgs(row, entity, code, preparedBy))
//
// The returned object carries `pdf_format_version` so the dispatcher routes
// correctly.
// ─────────────────────────────────────────────────────────────────────────────
export function buildFinancierCopyPdfArgs(row, entity, entityCode, preparedBy) {
  const version = row.pdf_format_version ?? 1    // conservative default for legacy rows

  const customer = {
    name:          row.customer_name,
    address:       row.customer_address,
    mobile:        row.customer_mobile,
    gstin:         row.customer_gstin,
    hypothecation: row.hypothecation,
  }

  // V1 shape — unchanged from the pre-redesign re-download path
  if (version === 1) {
    return {
      pdf_format_version: 1,
      fcNumber:   row.fc_number,
      date:       row.created_at?.split('T')[0],
      validUntil: row.valid_until,
      customer,
      entity,
      entityCode,
      lineItems:  row.line_items,
      tcsRate:    row.tcs_rate,
      tcsAmount:  row.tcs_amount,
      rtoTax:     row.rto_tax,
      insurance:  row.insurance,
      grandTotal: row.grand_total,
      chassisNo:  row.chassis_no,
      engineNo:   row.engine_no,
      preparedBy,
    }
  }

  // V2 shape — reconstruct totals by summing persisted line_items JSONB.
  // All fields except `totals` are direct snapshots from the saved row,
  // guaranteeing byte-identical re-renders (no re-computation drift).
  const items = row.line_items || []
  const taxableTotal = items.reduce((s, i) => s + (i.taxable  || 0), 0)
  const cgstTotal    = items.reduce((s, i) => s + (i.cgst_amt || 0), 0)
  const sgstTotal    = items.reduce((s, i) => s + (i.sgst_amt || 0), 0)
  const igstTotal    = items.reduce((s, i) => s + (i.igst_amt || 0), 0)
  const afterTax     = taxableTotal + cgstTotal + sgstTotal + igstTotal

  return {
    pdf_format_version: 2,
    fcNumber:           row.fc_number,
    date:               row.created_at?.split('T')[0],
    customer,
    shipTo:             row.ship_to,                 // null when bill = ship
    entity,
    entityCode,
    lineItems:          items,
    taxType:            row.tax_type,
    sellerStateCode:    row.seller_state_code,
    buyerStateCode:     row.buyer_state_code,
    tcsRate:            row.tcs_rate,
    tcsAmount:          row.tcs_amount,
    totals: {
      taxableTotal, cgstTotal, sgstTotal, igstTotal,
      rtoTotal: row.rto_tax   || 0,
      insTotal: row.insurance || 0,
      afterTax,
      gTotal:   row.grand_total,
    },
    amountInWords:      row.amount_in_words,
    preparedBy,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — routes to V1 or V2 based on data.pdf_format_version.
//
// Defaults to V2 when unspecified. The only way to hit V1 is an explicit
// version=1 on a persisted row (which the migration backfilled for all
// pre-redesign rows). New saves must always pass pdf_format_version: 2.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateFinancierCopyPdf(data) {
  const version = data?.pdf_format_version ?? 2
  if (version === 1) return generateFinancierCopyPdfV1(data)
  return generateFinancierCopyPdfV2(data)
}
