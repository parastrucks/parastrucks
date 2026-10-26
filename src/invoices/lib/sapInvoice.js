// Credit release step 1 — read an SAP tax-invoice PDF's text layer into values.
//
// Pure: takes the lines pdfLines.js extracted ({ creator, pages: [[{ y, items }]] }) and
// returns { ok: true, ... } or { ok: false, reason }. No pdfjs, no DOM — so the self-test
// runs it on the real PDFs in node and on generated DEMO PDFs, and the server can re-check it.
//
// Measured on three real invoices (2026-10-24, SAP NetWeaver 758; plan → "Measured — the
// SAP invoice PDFs"). Two layouts, each named by its SAP form in the PDF's Creator field:
//   counter sale  ZSF_RETAIL_INVOICE_GST_NEW — 1 page, labelled fields, PAYMENT TERMS
//   workshop job  ZDBMF_COVERING_LETTER_001  — page 1 "INVOICE SUMMARY" (every bill + a
//                 grand total), then each bill's own tax-invoice pages
// Any other form is REFUSED, never guessed: a wrong amount sent to a customer is worse
// than asking for the right file.
//
// Every value is read by its printed LABEL, never by position. Then the numbers are
// checked against each other — a reading that fails a check is refused with the reason:
//   workshop: the bills add up to the grand total; each bill's own pages exist, carry the
//             same customer, and print the same total (and the same in words)
//   counter:  the grand total equals the amount in words

export const FORMS = {
  ZSF_RETAIL_INVOICE_GST_NEW: 'counter_sale',
  ZDBMF_COVERING_LETTER_001: 'workshop',
}

const BILL_NO = /^[A-Z]{3}\d{10,16}$/          // LCS5756260000828, MCI5756260000394
const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const MOBILE = /Mob\.?\s*No\.?\s*:\s*(\d{10})\b/i
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/

const fail = (reason) => ({ ok: false, reason })

/** "39,633.00" → 3963300 paise; "0.43-" → -43. null when it is not an amount. */
export function toPaise(s) {
  const m = /^(-)?([\d,]+)\.(\d{2})(-)?$/.exec(String(s ?? '').trim())
  if (!m || (m[1] && m[4])) return null
  if (!/^\d{1,3}(,\d{2,3})*$|^\d+$/.test(m[2])) return null
  const v = Number(m[2].replace(/,/g, '')) * 100 + Number(m[3])
  return m[1] || m[4] ? -v : v
}

/** "24.10.2026" → "2026-10-24", or null when it is not a real date. */
export function toIsoDate(s) {
  const m = DATE.exec(String(s ?? '').trim())
  if (!m) return null
  const [, d, mo, y] = m
  const dt = new Date(Date.UTC(+y, +mo - 1, +d))
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null
  return `${y}-${mo}-${d}`
}

const UNITS = {
  ZERO: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9,
  TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16,
  SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50,
  SIXTY: 60, SEVENTY: 70, EIGHTY: 80, NINETY: 90,
}
const SCALES = { THOUSAND: 1e3, LAKH: 1e5, LAKHS: 1e5, CRORE: 1e7, CRORES: 1e7 }

function wordsToNumber(words) {
  let total = 0, chunk = 0, seen = false
  for (const w of words) {
    if (w in UNITS) { chunk += UNITS[w]; seen = true }
    else if (w === 'HUNDRED') { chunk = (chunk || 1) * 100; seen = true }
    else if (w in SCALES) { total += (chunk || 1) * SCALES[w]; chunk = 0; seen = true }
    else if (w === 'AND') continue
    else return null
  }
  return seen ? total + chunk : null
}

/** "THIRTY ONE THOUSAND FOUR HUNDRED RUPEES AND ZERO PAISE ONLY" → 3140000 paise. */
export function wordsToPaise(text) {
  const t = String(text ?? '').toUpperCase().replace(/^[\s:]+/, '').replace(/[^A-Z ]/g, ' ').trim()
  const m = /^(.*?)\s*RUPEES?\b(.*?)(?:\bPAISE\b)?\s*ONLY$/.exec(t)
  if (!m) return null
  const rupees = wordsToNumber(m[1].split(/\s+/).filter(Boolean))
  if (rupees == null) return null
  const rest = m[2].split(/\s+/).filter(Boolean)
  const paise = rest.length ? wordsToNumber(rest) : 0
  if (paise == null || paise > 99) return null
  return rupees * 100 + paise
}

// ── line helpers ──────────────────────────────────────────────────────
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
// Labels compare loosely — case, spacing and a trailing ":" or "." are cosmetic. A RENAMED
// label is not matched, and the file is refused with the reason (never guessed).
const norm = (s) => clean(s).toUpperCase().replace(/\s*[:.]+$/, '').replace(/\s*([()/])\s*/g, '$1')
const isLabel = (s, label) => norm(s) === norm(label)

/** Value printed after a label on the same line: skips ":" items, and strips a ":" the
 *  PDF glued to the value (": WTY5756…"). Returns null when the label is absent. */
function valueAfter(lines, label, { from = 0 } = {}) {
  for (let li = from; li < lines.length; li++) {
    const items = lines[li].items
    const i = items.findIndex((s) => isLabel(s, label))
    if (i < 0) continue
    for (let j = i + 1; j < items.length; j++) {
      const v = clean(items[j]).replace(/^:\s*/, '')
      if (v) return { value: v, line: li, index: j }
    }
    return { value: '', line: li, index: items.length }
  }
  return null
}

const lineIndex = (lines, pred) => lines.findIndex((l) => l.items.some((s) => pred(clean(s))))
const lastAmountOnLine = (line) => {
  for (let j = line.items.length - 1; j >= 0; j--) {
    const p = toPaise(line.items[j])
    if (p != null) return p
  }
  return null
}
const amountInWords = (lines) => {
  for (const l of lines) {
    const i = l.items.findIndex((s) => isLabel(s, 'AMOUNT IN WORDS'))
    if (i >= 0) return wordsToPaise(l.items.slice(i + 1).join(' '))
    const glued = l.items.map(clean).find((s) => /^AMOUNT IN WORDS\s*:/i.test(s))
    if (glued) return wordsToPaise(glued.replace(/^AMOUNT IN WORDS\s*:/i, ''))
  }
  return null
}
const firstMobileBelow = (lines, li) => {
  for (let k = li; k < lines.length; k++) {
    for (const s of lines[k].items) { const m = MOBILE.exec(s); if (m) return m[1] }
  }
  return null
}

export function formatRupees(paise) {
  const neg = paise < 0, p = Math.abs(paise)
  const r = String(Math.floor(p / 100))
  const last3 = r.slice(-3), rest = r.slice(0, -3)
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3
  return `${neg ? '-' : ''}₹${grouped}.${String(p % 100).padStart(2, '0')}`
}

// ── entry point ───────────────────────────────────────────────────────
export function readSapInvoice(doc) {
  if (!doc || !Array.isArray(doc.pages) || doc.pages.length === 0) return fail('The file has no readable pages.')
  const form = /^Form\s+(\S+)/.exec(clean(doc.creator))?.[1] ?? null
  const layout = form ? FORMS[form] : undefined
  if (!layout) {
    const text = doc.pages.flat().reduce((n, l) => n + l.items.join('').trim().length, 0)
    if (text === 0) return fail('This PDF has no text in it (a scan or a photo). Upload the PDF exported from SAP.')
    return fail(form
      ? `This is not an invoice layout the portal knows (SAP form ${form}). Only the workshop job summary and the counter-sale invoice are read.`
      : 'This PDF was not produced by SAP (no SAP form name in the file). Upload the PDF exported from SAP.')
  }
  const r = layout === 'workshop' ? readWorkshop(doc.pages) : readCounter(doc.pages)
  return r.ok ? { ...r, layout, sap_form: form } : r
}

function readCounter(pages) {
  if (pages.length !== 1) return fail(`A counter-sale invoice is one page; this file has ${pages.length}.`)
  const L = pages[0]
  const doc_no = valueAfter(L, 'DLR INVOICE NO')?.value
  if (!doc_no || !BILL_NO.test(doc_no)) return fail('Could not read the invoice number (DLR INVOICE NO).')
  const doc_date = toIsoDate(valueAfter(L, 'INVOICE DATE')?.value)
  if (!doc_date) return fail('Could not read the invoice date.')

  // Bill-to customer: the first "NAME(code)" on the page (delivery-to repeats it below).
  let custLine = -1, name = null, code = null
  for (let li = 0; li < L.length && custLine < 0; li++) {
    for (const s of L[li].items) {
      const m = /^(.+?)\s*\((\d{4,12})\)$/.exec(clean(s))
      if (m) { custLine = li; name = m[1]; code = m[2]; break }
    }
  }
  if (custLine < 0) return fail('Could not read the customer name and SAP customer code.')

  const pan = valueAfter(L, 'CUSTOMER PAN')?.value ?? null
  const gstin = valueAfter(L, 'GSTIN')?.value ?? null
  const seller = L.flatMap((l) => l.items.map(clean)).map((s) => /^GSTIN\s*\/\s*UIN\s*:\s*(\S+)$/i.exec(s)?.[1]).find(Boolean) ?? null

  const head = lineIndex(L, (s) => isLabel(s, 'Grand Total(INR)'))
  if (head < 0) return fail('Could not find the grand total.')
  // The figures sit on the first line below the heading row that carries an amount
  // (Grand Total is its last column) — a line of text squeezed in between is skipped.
  const below = L.slice(head + 1, head + 4).find((l) => lastAmountOnLine(l) != null)
  const total = below ? lastAmountOnLine(below) : null
  if (total == null || total <= 0) return fail('Could not read the grand total.')
  const words = amountInWords(L)
  if (words == null) return fail('Could not read the amount in words.')
  if (words !== total) return fail(`The grand total (${formatRupees(total)}) does not match the amount in words (${formatRupees(words)}).`)

  return {
    ok: true,
    doc_no, doc_date,
    order_no: valueAfter(L, 'DEALER REF NO')?.value ?? null,
    sap_invoice_no: valueAfter(L, 'SAP INVOICE NO')?.value ?? null,
    payment_terms: valueAfter(L, 'PAYMENT TERMS')?.value?.toLowerCase() ?? null,
    order_type: null,
    seller_gstin: seller,
    customer: {
      name, sap_code: code, mobile: firstMobileBelow(L, custLine),
      pan: pan && PAN.test(pan) ? pan : null, gstin: gstin && GSTIN.test(gstin) ? gstin : null,
    },
    vehicle: null,
    bills: [{ bill_no: doc_no, bill_date: doc_date, amount_paise: total, ex_tax_paise: null, terms: valueAfter(L, 'PAYMENT TERMS')?.value?.toLowerCase() ?? null }],
    total_paise: total,
    checks: ['Grand total matches the amount in words'],
  }
}

function readWorkshop(pages) {
  const S = pages[0]
  if (lineIndex(S, (s) => isLabel(s, 'INVOICE SUMMARY')) < 0) return fail('Page 1 is not the INVOICE SUMMARY. Upload the whole job PDF from SAP.')
  const doc_no = valueAfter(S, 'JOB CARD NO')?.value
  if (!doc_no || !/^[A-Z]{2,4}\d{10,16}$/.test(doc_no)) return fail('Could not read the job card number.')
  const doc_date = toIsoDate(valueAfter(S, 'INVOICE DATE')?.value)
  if (!doc_date) return fail('Could not read the invoice date on the summary.')

  const c = valueAfter(S, 'CUSTOMER')
  if (!c) return fail('Could not read the customer on the summary.')
  const custItems = S[c.line].items.slice(c.index).map(clean).filter(Boolean)
  const codeAt = custItems.findIndex((s) => /^\[\d{4,12}\]$/.test(s))
  const code = codeAt >= 0 ? custItems[codeAt].slice(1, -1) : null
  const name = custItems.slice(0, codeAt).join(' ')
  if (!name || !code) return fail('Could not read the customer name and SAP customer code.')

  const regn = valueAfter(S, 'REGN. NO')?.value ?? null
  const seller = S.flatMap((l) => l.items.map(clean)).map((s) => /^GSTIN Number\s*:\s*(\S+)$/i.exec(s)?.[1]).find(Boolean) ?? null

  // Bills: every line between the BILL NO header and GRAND TOTAL that starts with a bill number.
  const head = lineIndex(S, (s) => isLabel(s, 'BILL NO'))
  const totalAt = valueAfter(S, 'GRAND TOTAL (INR)')
  if (head < 0 || !totalAt) return fail('Could not find the list of bills and the grand total on the summary.')
  const total = toPaise(totalAt.value)
  if (total == null || total <= 0) return fail('Could not read the grand total on the summary.')
  const bills = []
  for (let li = head + 1; li < totalAt.line; li++) {
    const it = S[li].items.map(clean).filter(Boolean)
    if (!BILL_NO.test(it[0] ?? '')) continue
    const bill_date = toIsoDate(it[1]), ex = toPaise(it[2]), amt = toPaise(it[3])
    if (it.length !== 4 || !bill_date || ex == null || amt == null) return fail(`Could not read the summary line for bill ${it[0]}.`)
    bills.push({ bill_no: it[0], bill_date, ex_tax_paise: ex, amount_paise: amt, terms: null })
  }
  if (bills.length === 0) return fail('The summary lists no bills.')
  if (new Set(bills.map((b) => b.bill_no)).size !== bills.length) return fail('The summary lists the same bill twice.')
  const sum = bills.reduce((n, b) => n + b.amount_paise, 0)
  if (sum !== total) return fail(`The bills add up to ${formatRupees(sum)} but the summary's grand total is ${formatRupees(total)}.`)

  // Each bill's own tax-invoice pages, grouped by the INVOICE NO they print.
  const byBill = new Map()
  for (let p = 1; p < pages.length; p++) {
    const no = valueAfter(pages[p], 'INVOICE NO')?.value
    if (!no) return fail(`Page ${p + 1} has no invoice number.`)
    ;(byBill.get(no) || byBill.set(no, []).get(no)).push(pages[p])
  }
  let pan = null, gstin = null
  for (const b of bills) {
    const pg = byBill.get(b.bill_no)
    if (!pg) return fail(`The file is missing the pages of bill ${b.bill_no}. Upload the whole job PDF from SAP.`)
    // Every page of the bill repeats its header — each must name the summary's customer code.
    for (const pageLines of pg) {
      const bc = valueAfter(pageLines, 'CUSTOMER')
      const bcode = bc && pageLines[bc.line].items.slice(bc.index).map(clean).map((s) => /^\[(\d+)\]$/.exec(s)?.[1]).find(Boolean)
        || pageLines.flatMap((l) => l.items.map(clean)).map((s) => /^\[(\d+)\]$/.exec(s)?.[1]).find(Boolean)
      if (bcode !== code) return fail(`Bill ${b.bill_no} is for customer code ${bcode ?? '?'}, not ${code} as on the summary.`)
    }
    const lines = pg.flat()
    const gt = lines.find((l) => l.items.some((s) => isLabel(s, 'GRAND TOTAL (INR)')))
    const own = gt ? lastAmountOnLine(gt) : null
    if (own !== b.amount_paise) return fail(`Bill ${b.bill_no}'s own pages total ${own == null ? '?' : formatRupees(own)}, the summary says ${formatRupees(b.amount_paise)}.`)
    const words = amountInWords(lines)
    if (words !== b.amount_paise) return fail(`Bill ${b.bill_no}'s amount in words does not match its total.`)
    const kind = lines.flatMap((l) => l.items.map(clean)).find((s) => isLabel(s, 'CASH BILL') || isLabel(s, 'CREDIT BILL'))
    b.terms = kind ? norm(kind).split(' ')[0].toLowerCase() : null
    pan ??= valueAfter(lines, 'CUSTOMER PAN')?.value ?? null
    gstin ??= valueAfter(lines, 'GSTIN / UIN')?.value ?? null
  }
  const extra = [...byBill.keys()].filter((no) => !bills.some((b) => b.bill_no === no))
  if (extra.length) return fail(`The file has pages for bill ${extra[0]}, which the summary does not list.`)

  return {
    ok: true,
    doc_no, doc_date,
    order_no: valueAfter(S, 'ORDER NUMBER')?.value ?? null,
    sap_invoice_no: null,
    payment_terms: null,
    order_type: valueAfter(S, 'ORDER TYPE')?.value ?? null,
    seller_gstin: seller,
    customer: {
      name, sap_code: code, mobile: firstMobileBelow(S, c.line),
      pan: pan && PAN.test(pan) ? pan : null, gstin: gstin && GSTIN.test(gstin) ? gstin : null,
    },
    vehicle: {
      regn_no: regn && /^[A-Z0-9]{6,12}$/.test(regn) ? regn : null,
      model: valueAfter(S, 'VEHICLE MODEL')?.value ?? null,
      chassis_no: valueAfter(S, 'CHASSIS NO')?.value ?? null,
      engine_no: valueAfter(S, 'ENGINE NO')?.value ?? null,
    },
    bills,
    total_paise: total,
    checks: [
      `${bills.length} bill${bills.length === 1 ? '' : 's'} add up to the grand total`,
      "Each bill's own pages print the same total, in figures and in words",
      'Every bill is for the same customer code',
    ],
  }
}
