// Phase 10 import, step 2 — MERGE: the rows read from every file → ONE record per truck.
//
// The same truck sits in several files and they disagree (CTC on ~25% of trucks between the purchase
// file and the rest — plan §2.6). Last-file-wins would corrupt about one money cell in four, so every
// column has a HOME: its sources in order, the first filled one wins. Nothing is thrown away: every
// other file's DIFFERENT value goes into a note on that cell ("other files say …"), so the team sees the
// disagreement where it matters — the pilot-first plan's point (§2.5: "dirty data in the sandbox makes
// the conflicts self-evident").
//
// The homes are MEASURED (scripts/phase10/e_sources.cjs, 2026-10-23): the purchase file disagrees with
// every other file on the customer while those agree with each other → retail is home for it; CTC is TWO
// columns (owner, 2026-10-24): PTB CTC from the sales side, AL CTC from the AL side (see RULES);
// CTD agrees best between purchase and retention → purchase is home; the year file's mixed layouts
// shift its invoice-date and AD-BLU columns on ~190 rows → the monthly list is home for those two.
//
// Pure: no files, no database. Tested by scripts/phase10/selftest-import-merge.cjs.

// the DSE incentive the grid works out today (src/tracker/lib/screenColumns.js — the same code, so the
// import and the screen can never disagree on what "today's rule" gives)
const { withScreenColumns } = require('../../../src/tracker/lib/screenColumns.js')

// family labels as a person reads them in a note
const LABEL = {
  IT: 'Invoice Tracker', IT_OD: 'Invoice Tracker (other dealer)', FY: 'Sales book', LIST: 'Invoice List',
  RET_INT: 'Retention (internal)', RET_AL: 'Retention (AL)', DEALERS: 'Dealers', REBILL: 'Cancel/rebill',
}

// column → { kind, from: [[family, header], …] home first, history?: true (a worked-out column: the
// workbook's figure is kept as history, never compared across files) }
const IT = (h) => [['IT', h], ['IT_OD', h]]
const RULES = {
  // A · identity
  engine_no: { kind: 'text', from: [...IT('ENGINE NO'), ['FY', 'ENGINE NO'], ['LIST', 'ENGINE NO'], ['LIST_OD', 'ENGINE NO'], ['RET_INT', 'ENGINE NO'], ['RET_AL', 'ENGINE NO']] },
  model: { kind: 'text', from: [...IT('MODEL'), ['FY', 'MODEL'], ['LIST', 'MODEL'], ['LIST_OD', 'MODEL'], ['RET_INT', 'MODEL'], ['RET_AL', 'MODEL']] },
  vpart_no: { kind: 'text', from: [...IT('VPART NUMBER'), ['FY', 'V PART NUMBER'], ['LIST', 'V PART NUMBER'], ['LIST_OD', 'V PART NUMBER'], ['RET_INT', 'CBN NO.'], ['RET_AL', 'CBN NO.'], ['DEALERS', 'V PART NUMBER']] },
  hsn_code: { kind: 'text', from: IT('HSN CODE') },
  mfrs_year: { kind: 'int', from: [['LIST', 'MFRS YEAR'], ['LIST_OD', 'MFRS YEAR']] },
  // retention names the bus kind (MDV BUS / ICV BUS) where retail says BUS — the finer word is home
  segment: { kind: 'text', from: [['RET_INT', 'SEGMENT'], ['RET_AL', 'SEGMENT'], ['FY', 'SEGMENT'], ['LIST', 'SEGMENT'], ['LIST_OD', 'SEGMENT']], refines: true },
  customer_name: { kind: 'text', names: true, from: [['FY', 'NAME OF THE CUSTOMER'], ['LIST', 'NAME OF THE CUSTOMER'], ['LIST_OD', 'NAME OF THE CUSTOMER'], ['RET_INT', 'NAME'], ['RET_AL', 'NAME'], ...IT('CUSTOMER NAME')] },
  qty: { kind: 'int', from: [...IT('QTY'), ['FY', 'QUANTITY'], ['LIST', 'QUANTITY'], ['LIST_OD', 'QUANTITY']] },
  // B · purchase from AL
  oem_gatepass_no: { kind: 'text', from: IT('OEM GATEPASS NUMBER') },
  oem_gatepass_date: { kind: 'date', from: IT('OEM GATEPASS DATE') },
  odn_no: { kind: 'text', from: IT('ODN NUMBER') },
  // two CTCs (owner, 2026-10-24): PTB CTC = the internal figure (the sales lists + internal retention agree
  // on it), AL CTC = the figure told to AL (the AL retention file + the purchase file agree on it). A truck
  // not sold yet has only the purchase file's figure: it fills PTB CTC as a fallback, never compared.
  ctc: { kind: 'num', from: [['FY', 'CTC'], ['LIST', 'CTC'], ['LIST_OD', 'CTC'], ['RET_INT', 'CTC']], fallback: IT('CTC') },
  al_ctc: { kind: 'num', from: [['RET_AL', 'CTC'], ...IT('CTC')] },
  ctd: { kind: 'num', from: [...IT('CTD'), ['RET_INT', 'CTD'], ['RET_AL', 'CTD'], ['FY', 'CTD'], ['LIST', 'CTD'], ['LIST_OD', 'CTD'], ['DEALERS', 'CTD']] },
  amc_to_al: { kind: 'num', from: [['IT', 'AMC/SERVICE'], ['IT_OD', 'AMC']] },
  dsa: { kind: 'num', from: IT('DSA') },
  ad_blue: { kind: 'num', from: IT('AD BLUE') },
  al_payment_status: { kind: 'text', from: IT('AL PAYMENT STATUS') },
  al_payment_date: { kind: 'date', from: IT('AL PAYMENT DATE') },
  ptb_invoice_date: { kind: 'date', from: [...IT('PTB INVOICE DATE'), ['LIST', 'PTB INVOICE DATE'], ['LIST_OD', 'PTB INVOICE DATE'], ['FY', 'PTB INVOICE DATE']] },
  supplier_invoice_no: { kind: 'text', from: IT('SUPPLIER INVOICE NO.') },
  supplier_invoice_date: { kind: 'date', from: IT('SUPPLIER INVOICE DATE') },
  supplier_invoice_amount: { kind: 'num', from: IT('SUPPLIER INVOICE AMOUNT') },
  parts_pkg: { kind: 'text', from: IT('PARTS PKG') },
  // C · retail sale, finance, delivery, refund
  dse: { kind: 'text', from: [['RET_INT', 'DSE'], ['FY', 'DSE'], ['LIST', 'DSE'], ['LIST_OD', 'DSE']] },
  delivery_location: { kind: 'text', from: [['FY', 'DELIVERY LOCATION'], ['LIST', 'DELIVERY LOCATION'], ['LIST_OD', 'DELIVERY LOCATION']] },
  finance_bank: { kind: 'text', from: [['FY', 'FINANCE'], ['LIST', 'FINANCE'], ['LIST_OD', 'FINANCE']] },
  do_date: { kind: 'date', from: [['FY', 'DO DATE'], ['LIST', 'DO DATE'], ['LIST_OD', 'DO DATE']] },
  do_amount: { kind: 'num', from: [['FY', 'DO AMOUNT'], ['LIST', 'DO AMOUNT'], ['LIST_OD', 'DO AMOUNT']] },
  mrp: { kind: 'num', from: [['FY', 'MRP'], ['LIST', 'MRP'], ['LIST_OD', 'MRP']] },
  tally_bill: { kind: 'num', from: [['FY', 'CUSTOMER BILL'], ['LIST', 'TALLY BILL'], ['LIST', 'CUSTOMER BILL'], ['LIST_OD', 'TALLY BILL'], ['LIST_OD', 'CUSTOMER BILL']] },
  amc_charged_to_customer: { kind: 'text', from: [['FY', 'AMC'], ['LIST', 'AMC'], ['LIST_OD', 'AMC']] },
  margin_money: { kind: 'num', from: [['FY', 'MARGIN MONEY'], ['LIST', 'MARGIN MONEY'], ['LIST_OD', 'MARGIN MONEY']] },
  finance_recd: { kind: 'num', from: [['FY', 'FINANCE RECD'], ['LIST', 'FINANCE RECD'], ['LIST_OD', 'FINANCE RECD']] },
  finance_paymt_recd_date: { kind: 'date', from: [['FY', 'FINANCE PAYMT. RECD DATE'], ['LIST', 'FINANCE PAYMT. RECD DATE'], ['LIST_OD', 'FINANCE PAYMT. RECD DATE']] },
  subvention: { kind: 'num', from: [['FY', 'SUBVENTION'], ['LIST', 'SUBVENTION'], ['LIST_OD', 'SUBVENTION']] },
  insurance: { kind: 'num', from: [['FY', 'INSURANCE'], ['LIST', 'INSURANCE'], ['LIST_OD', 'INSURANCE']] },
  cretem: { kind: 'num', from: [['FY', 'CRETEM'], ['LIST', 'CRETEM'], ['LIST_OD', 'CRETEM']] },
  refund_status: { kind: 'refund', from: [['FY', 'REFUND STATUS'], ['LIST', 'REFUND STATUS'], ['LIST_OD', 'REFUND STATUS']] },
  delivery_status: { kind: 'text', from: [['FY', 'DELIVERY STATUS'], ['LIST', 'DELIVERY STATUS'], ['LIST_OD', 'DELIVERY STATUS']] },
  ad_blu_given: { kind: 'text', from: [['LIST', 'AD-BLU'], ['LIST_OD', 'AD-BLU'], ['FY', 'AD-BLU']] },
  endhan: { kind: 'text', from: [['FY', 'ENDHAN'], ['LIST', 'ENDHAN'], ['LIST_OD', 'ENDHAN']] },
  // the unlabelled dates beside ENDHAN in the year file (owner 2026-10-23: the day the Endhan was given)
  endhan_date: { kind: 'date', from: [['FY', '#AL']] },
  // D · retention
  dsm: { kind: 'text', from: [['RET_INT', 'DSM']] },
  date_of_retail: { kind: 'date', from: [['RET_INT', 'DATE OF RETAIL']] },
  al_retail_date: { kind: 'date', from: [['RET_AL', 'DATE OF RETAIL']] },  // AL's own date: 961 differ (owner, 2026-10-24)
  // DEALERS column J holds a few delivery dates under a "DATE OF DELY" label (column map Q5)
  date_of_delivery: { kind: 'date', from: [['RET_INT', 'DATE OF DELIVERY'], ['RET_AL', 'DATE OF DELIVERY'], ['DEALERS', '#J']] },
  other_deductions: { kind: 'num', from: [['RET_INT', 'OTHER DEDUCTIONS'], ['RET_AL', 'OTHER DEDUCTIONS']] },
  retention_al_claim: { kind: 'num', from: [['RET_AL', 'RETENTION']] },
  retention_remarks: { kind: 'text', from: [['RET_INT', 'REMARKS'], ['RET_AL', 'REMARKS']] },
  sale_category: { kind: 'text', from: [['RET_AL', 'SALE CATEGORY']] },
  al_invoice_no: { kind: 'text', from: [['RET_AL', 'AL INVOICE NO.']] },
  dealer_invoice_no: { kind: 'text', from: [['RET_AL', 'DEALER INVOICE NO.']] },
  // age and interest grow month by month on a claim still open: the latest month is the record
  al_claim_age: { kind: 'int', latestOnly: true, from: [['RET_AL', 'AGE']] },
  al_claim_interest: { kind: 'num', latestOnly: true, from: [['RET_AL', 'INTEREST']] },
  // E · inter-dealer, cancel/rebill
  sold_to_dealer: { kind: 'text', from: [['DEALERS', 'NAME OF DEALER']] },
  vehicle_location: { kind: 'text', from: [['REBILL', 'VEHICLE LOCATION']] },
  actual_delivery: { kind: 'text', from: [['REBILL', 'ACUAL DELIVERY']] },
  rebill_delivery_date: { kind: 'date', from: [['REBILL', 'DELY DATE']] },

  // worked out by the database; the workbook's figure is imported as HISTORY (recompute = false), then
  // the recompute-and-diff compares it with what the database works out
  retention_dealer: { kind: 'num', history: true, from: IT('RETENTION') },
  payment_amount: { kind: 'num', history: true, from: IT('PAYMENT AMOUNT') },
  tds: { kind: 'num', history: true, from: IT('TDS') },
  total_payment_to_al: { kind: 'num', history: true, from: IT('TOTAL PAYMENT TO AL') },
  diff_amount: { kind: 'num', history: true, from: IT('DIFFERENCE - AMOUNT') },
  diff_base: { kind: 'num', history: true, from: IT('DIFFERENCE - BASE VALUE') },
  diff_gst: { kind: 'num', history: true, from: IT('DIFFERENCE - GST') },
  diff_tds: { kind: 'num', history: true, from: IT('DIFFERENCE - TDS') },
  total_difference: { kind: 'num', history: true, from: IT('TOTAL DIFFERENCE') },
  tcs: { kind: 'num', history: true, from: [['FY', 'TCS'], ['LIST', 'TCS'], ['LIST_OD', 'TCS']] },
  total: { kind: 'num', history: true, from: [['FY', 'TOTAL'], ['LIST', 'TOTAL'], ['LIST_OD', 'TOTAL']] },
  total_recd: { kind: 'num', history: true, from: [['FY', 'TOTAL RECD'], ['LIST', 'TOTAL RECD'], ['LIST_OD', 'TOTAL RECD']] },
  full_tax: { kind: 'num', history: true, from: [['FY', 'FULL TAX'], ['LIST', 'FULL TAX'], ['LIST_OD', 'FULL TAX']] },
  total_receivable: { kind: 'num', history: true, from: [['FY', 'TOTAL RECEIVABLE'], ['LIST', 'TOTAL RECEIVABLE'], ['LIST_OD', 'TOTAL RECEIVABLE']] },
  net_refund: { kind: 'num', history: true, from: [['FY', 'NET REFUND'], ['LIST', 'NET REFUND'], ['LIST_OD', 'NET REFUND']] },
  payment_status: { kind: 'text', history: true, from: [['FY', 'PAYMENT STATUS'], ['LIST', 'PAYMENT STATUS'], ['LIST_OD', 'PAYMENT STATUS']] },
  retention_internal: { kind: 'num', history: true, from: [['RET_INT', 'RETENTION']] },
  app_amt: { kind: 'num', history: true, from: [['RET_AL', 'APP AMT']] },
  dealer_basic_value: { kind: 'num', history: true, from: [['DEALERS', 'BASIC VALUE']] },
  dealer_tds: { kind: 'num', history: true, from: [['DEALERS', 'TDS( 0.1%)']] },
  dealer_net_payable: { kind: 'num', history: true, from: [['DEALERS', 'NET PAYABLE']] },
}
const INCENTIVES = { dsm_incentive: [['RET_INT', 'DSM INCENTIVE']], gm_incentive: [['RET_INT', 'GM INCENTIVE']] }

// where each family keeps the chassis number. On DEALERS it sits under "Model", and "Chassis No"
// holds engine numbers (R2-5) — so a value counts as a chassis only if it is long enough to be one.
const CHASSIS_AT = {
  IT: ['CHASSIS NO'], IT_OD: ['CHASSIS NO'], FY: ['CHASSIS NUMBER'], LIST: ['CHASSIS NUMBER'], LIST_OD: ['CHASSIS NO'],
  RET_INT: ['CHASSIS NO'], RET_AL: ['CHASSIS NO'], DEALERS: ['MODEL', 'CHASSIS NO'], REBILL: ['CHASSIS NUMBER'],
}
const chassisKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '')
const looksLikeChassis = (s) => /^[A-Z0-9]{14,}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s)

// ── values ────────────────────────────────────────────────────────────────────────────────────────
// Excel serial (1900 system) → 'YYYY-MM-DD'
const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10)
const DMY = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/
function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return { ok: serialToIso(v) }
  const m = DMY.exec(String(v ?? '').trim())
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    const d = new Date(`${iso}T00:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) return { ok: iso }
  }
  return { bad: true }
}
function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: v } : { bad: true }
  const t = String(v ?? '').replace(/[,₹\s]/g, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? { ok: Number(t) } : { bad: true }
}
// FY's refund status has 11 spellings (R2-26); the four real ones are normalised, anything else kept
const REFUND = { PENDING: 'PENDING', REFUNDED: 'REFUNDED', NA: 'NA', 'TO COLLECT': 'TO COLLECT' }
function parse(kind, v) {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { empty: true }
  switch (kind) {
    case 'date': return parseDate(v)
    case 'num': return parseNum(v)
    case 'int': { const n = parseNum(v); return n.ok !== undefined && Number.isInteger(n.ok) ? n : { bad: true } }
    case 'refund': { const t = String(v).trim().toUpperCase().replace(/\s+/g, ' '); return { ok: REFUND[t] ?? String(v).trim() } }
    default: return { ok: typeof v === 'number' ? String(v) : String(v).trim() }
  }
}
// two values the same? numbers to the rupee; text ignoring case, spaces and punctuation
const same = (kind, a, b) => (kind === 'num' || kind === 'int') ? Math.abs(a - b) < 1
  : String(a).toUpperCase().replace(/[^A-Z0-9]/g, '') === String(b).toUpperCase().replace(/[^A-Z0-9]/g, '')
// a customer's name written two ways (M/S, PVT LTD / PRIVATE LIMITED, a word left off the end) is no
// disagreement: compared on its words, the shorter's words all in the longer
const NAME_NOISE = new Set(['M', 'S', 'MS', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'THE', 'AND', 'CO', 'COMPANY', 'LLP'])
const nameWords = (v) => String(v).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !NAME_NOISE.has(w))
const sameName = (a, b) => { const x = nameWords(a), y = nameWords(b); const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.length > 0 && s.every((w) => l.includes(w)) }
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const show = (kind, v) => kind === 'date' ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(2, 4)}` : (kind === 'num' ? inr.format(v) : String(v))
const where = (src) => `${LABEL[src.fam]} (${src.file}${src.fam === 'FY' || src.fam === 'IT' || src.fam === 'IT_OD' ? `, row ${src.row}` : ''})`

// GST in force for a truck (the database's rule, 20261023_phase10_tracker_rmc_gst.sql) — the importer
// needs it because history is written with recompute = false
const gstRule = (model, ptbDate) => /\bRMC\b/i.test(model ?? '') ? 18 : (ptbDate && ptbDate < '2025-09-22' ? 28 : 18)
// road tax was worked out on the bill until 31 Jul 2025, on the MRP from 1 Aug 2025 (column map 54)
const roadTaxOnMrp = (ptbDate) => !ptbDate || ptbDate >= '2025-08-01'

// families: { [family]: [{ file, sheet, row, cells: { HEADER: { v, f, note, bg, col } } }] }, each family's
// rows in file order (a later file wins inside one family — the DEALERS sheet repeats month to month)
function merge(families) {
  const report = { trucks: 0, rowsWithoutChassis: {}, repeatedInFamily: {}, unreadable: {}, conflicts: {}, refundKept: {} }
  const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n }

  // 1. group every row by its truck
  const trucks = new Map() // chassis → { [family]: [row, …] }
  for (const [fam, rows] of Object.entries(families)) {
    for (const r of rows) {
      let ch = ''
      for (const h of CHASSIS_AT[fam] ?? []) { const c = chassisKey(r.cells[h]?.v); if (looksLikeChassis(c)) { ch = c; break } }
      if (!ch) { bump(report.rowsWithoutChassis, fam); continue }
      const t = trucks.get(ch) ?? {}
      if (t[fam]) bump(report.repeatedInFamily, fam)
      ;(t[fam] ??= []).push(r)
      trucks.set(ch, t)
    }
  }

  const units = [], notes = [], formats = [], incentives = [], links = []
  for (const [chassis, rowsOf] of trucks) {
    // a truck seen only on the cancel/rebill or dealers sheet is not a truck of this book
    if (!['IT', 'IT_OD', 'FY', 'LIST', 'LIST_OD', 'RET_INT', 'RET_AL'].some((f) => rowsOf[f])) continue
    report.trucks++
    const latest = (fam) => rowsOf[fam]?.[rowsOf[fam].length - 1]
    const u = { chassis_no: chassis }
    const noteOn = (key, body, source) => notes.push({ chassis, column_key: key, body, source })

    for (const [key, rule] of Object.entries(RULES)) {
      const found = []
      for (const [fam, head] of rule.from) {
        const r = latest(fam)
        const cell = r?.cells[head]
        if (!cell) continue
        const p = parse(rule.kind, cell.v)
        if (p.empty) continue
        const src = { fam, file: r.file, row: r.row, cell }
        if (p.bad) { bump(report.unreadable, `${key} (${fam})`); found.push({ src, bad: true }); continue }
        found.push({ src, value: p.ok })
        if (rule.kind === 'refund' && !Object.values(REFUND).includes(p.ok)) bump(report.refundKept, p.ok)
      }
      // the same family in an EARLIER file (last year's tracker, an older copy): it fills the cell only when
      // no later file has it, and a different figure is kept as a note — never silently dropped. The DEALERS
      // sheet is left out: it is copied month to month and the latest copy is the record (R2-5).
      for (const [fam, head] of rule.latestOnly ? [] : rule.from) {
        if (fam === 'DEALERS') continue
        const rows = rowsOf[fam] ?? []
        const last = rows[rows.length - 1]
        for (let i = rows.length - 2; i >= 0; i--) {
          const r = rows[i]
          if (r.file === last.file) continue
          const cell = r.cells[head]
          if (!cell) continue
          const p = parse(rule.kind, cell.v)
          if (p.empty) continue
          const src = { fam, file: r.file, row: r.row, cell }
          if (p.bad) { found.push({ src, bad: true }); continue }
          found.push({ src, value: p.ok })
        }
      }
      const good = found.filter((x) => !x.bad)
      const home = good[0]
      if (home) u[key] = home.value
      // a fallback source fills an empty column and is never compared (its figure belongs to another column)
      if (!home && rule.fallback) {
        for (const [fam, head] of rule.fallback) {
          const r = latest(fam); const p = r?.cells[head] ? parse(rule.kind, r.cells[head].v) : { empty: true }
          if (p.ok !== undefined) { u[key] = p.ok; break }
        }
      }
      if (rule.history) continue
      // other files' different values, and unreadable ones, kept on the cell
      const others = []
      for (const x of found) {
        if (x === home) continue
        if (x.bad) { others.push(`${where(x.src)}: “${String(x.src.cell.v).trim()}” (not readable as a ${rule.kind === 'date' ? 'date' : 'number'})`); continue }
        if (same(rule.kind, x.value, home.value)) continue
        if (rule.names && sameName(x.value, home.value)) continue
        if (rule.refines) { const a = String(home.value).toUpperCase(), b = String(x.value).toUpperCase(); if (a.includes(b) || b.includes(a)) continue }
        if (others.some((o) => o.endsWith(`: ${show(rule.kind, x.value)}`))) continue
        others.push(`${where(x.src)}: ${show(rule.kind, x.value)}`)
      }
      if (others.length) {
        bump(report.conflicts, key)
        noteOn(key, `${home ? `Shown: ${where(home.src)}. ` : ''}Other files say — ${others.join(' · ')}`, 'import')
      }
      // a hand-typed formula in the cell the value came from (CTD =2055000/1.28*1.18, AD BLUE =1310*8)
      // (only a formula of typed figures: one that refers to other cells is the sheet's arithmetic, not an input)
      if (home?.src.cell.f && !rule.history && !/\$?[A-Z]{1,3}\$?\d+/.test(home.src.cell.f)) noteOn(key, `Excel formula: =${home.src.cell.f}`, 'excel_formula')
    }

    // Excel comments and flag colours, on whichever file's cell they were, at that column
    for (const [fam, rows] of Object.entries(rowsOf)) {
      for (const r of rows) for (const [head, cell] of Object.entries(r.cells)) {
        const key = keyOf(fam, head)
        if (cell.note) noteOn(key ?? 'chassis_no', key ? cell.note : `(${LABEL[fam]}, column ${cell.col}) ${cell.note}`, 'excel_comment')
        // the paid green is a rule in the tracker, and a header colour is not a flag
        if (cell.bg && key && cell.bg !== '#C6EFCE' && !formats.some((x) => x.chassis === chassis && x.column_key === key)) {
          formats.push({ chassis, column_key: key, format: { bg: { rgb: cell.bg } } })
        }
        // the unlabelled stray cells (column map Q5) that no column takes: kept as notes, nothing lost
        if (head.startsWith('#') && !key && cell.v !== null && !DROPPED.has(`${fam}|${head}`)) {
          const v = typeof cell.v === 'number' && cell.v > 20000 && cell.v < 80000 && /[dmy]/i.test(cell.z ?? '') ? show('date', serialToIso(cell.v)) : cell.v
          noteOn('chassis_no', `(${LABEL[fam]} ${r.file}, column ${cell.col}, unlabelled) ${v}`, 'import')
        }
      }
    }

    const dealor = latest('LIST_OD')?.cells['DEALOR']?.v
    if (dealor !== null && dealor !== undefined && String(dealor).trim()) noteOn('purchase_source', `Bought from: ${String(dealor).trim()} (${LABEL.LIST_OD})`, 'import')
    // where the truck was bought, and the CTC basis (N1: exclusive when any add-on is filled)
    u.purchase_source = rowsOf.IT ? 'al' : rowsOf.IT_OD ? 'other_dealer' : 'al'
    if (rowsOf.IT || rowsOf.IT_OD) u.ctc_basis = ['amc_to_al', 'dsa', 'ad_blue'].some((k) => u[k]) ? 'exclusive' : 'inclusive'

    // GST, road tax and full-tax overrides, read from the retail FULL TAX cell (its formula says which
    // GST and which base the team used; a typed figure is kept as it is)
    const gst = gstRule(u.model, u.ptb_invoice_date)
    const ft = (latest('FY') ?? latest('LIST') ?? latest('LIST_OD'))?.cells['FULL TAX']
    const m = ft?.f && /^\$?([A-Z]{1,2})\$?\d+\/(1\.\d+|\d{3})\*(\d+(?:\.\d+)?)%$/i.exec(ft.f.replace(/\s+/g, ''))
    if (m) {
      const div = Number(m[2]); const usedGst = Math.round((div > 10 ? div / 100 - 1 : div - 1) * 100)
      u.road_tax_pct = Number(m[3])
      if (usedGst !== gst) u.gst_rate_override = usedGst
      const fyRow = latest('FY') ?? latest('LIST') ?? latest('LIST_OD')
      const baseHead = Object.entries(fyRow.cells).find(([, c]) => c.col === m[1].toUpperCase())?.[0]
      const onMrp = baseHead === 'MRP'
      if (baseHead && onMrp !== roadTaxOnMrp(u.ptb_invoice_date) && typeof ft.v === 'number') u.full_tax_override = ft.v
    } else if (ft && typeof ft.v === 'number') {
      if (ft.v === 0) u.road_tax_pct = 0
      else u.full_tax_override = ft.v
    }
    u.gst_rate = u.gst_rate_override ?? gst

    // incentives (admin + HR only): DSM and GM as typed. The DSE figure the month's sheet worked out is what
    // was PAID; it is compared with today's rule after every truck is known (below)
    const inc = {}
    for (const [key, from] of Object.entries(INCENTIVES)) {
      for (const [fam, head] of from) { const p = parseNum(latest(fam)?.cells[head]?.v); if (p.ok !== undefined) { inc[key] = p.ok; break } }
    }
    const dseCell = latest('RET_INT')?.cells['DSE INCENTIVE']
    if (dseCell && typeof dseCell.v === 'number') inc.dse_paid = { value: dseCell.v, typed: !dseCell.f }
    if (Object.keys(inc).length) incentives.push({ chassis, ...inc })

    // cancel/rebill: this truck was re-billed as a new chassis
    // the latest row that names a new chassis (the sheet repeats month to month, and later copies of a
    // row sometimes lose it)
    const nc = (rowsOf.REBILL ?? []).map((r) => chassisKey(r.cells['NEW CHASSIS NO']?.v)).filter((c) => looksLikeChassis(c) && c !== chassis).pop()
    if (nc) links.push({ chassis, new_chassis: nc })
    // words typed into the new-chassis column (a remark, not a chassis) are kept as a note
    for (const t of new Set((rowsOf.REBILL ?? []).map((r) => r.cells['NEW CHASSIS NO']?.v).filter((v) => v !== null && v !== undefined && !looksLikeChassis(chassisKey(v)))
      .map((v) => (typeof v === 'number' && v > 20000 && v < 80000 ? show('date', serialToIso(v)) : String(v).trim())))) {
      noteOn('vehicle_location', `(${LABEL.REBILL}, NEW CHASSIS NO) ${t}`, 'import')
    }

    // provenance: the file and row the home of the truck came from
    const home = latest('IT') ?? latest('IT_OD') ?? latest('FY') ?? latest('LIST') ?? latest('LIST_OD') ?? latest('RET_INT') ?? latest('RET_AL')
    u.source_file = home.file
    u.source_row = home.row
    units.push(u)
  }

  // DSE incentive history (owner, 2026-10-24): the sheets' rule changed over time — a ₹1,000 retention bonus
  // until Dec 2025, and slab steps that swap between 4/7/11 and 5/9/13 from one month's sheet to the next — so
  // no date rule can rebuild what was paid. Today's rule (the screen's slab, 5/9/13, no bonus) stays the
  // default; where the month's sheet paid a DIFFERENT figure, that figure is kept as the override, so the
  // grid shows what was paid. A hand-typed figure is always kept (the SRS zeroes, R2-19).
  const superseded = new Set(links.map((l) => l.chassis))
  const today = new Map(withScreenColumns(units.map((u) => ({ ...u, superseded_at: superseded.has(u.chassis_no) ? 'x' : null })), '2026-01-01')
    .map((x) => [x.chassis_no, x.dse_incentive]))
  report.dsePaidDiffers = 0
  for (const inc of incentives) {
    const paid = inc.dse_paid; delete inc.dse_paid
    if (!paid) continue
    if (paid.typed || paid.value !== (today.get(inc.chassis) ?? null)) {
      inc.dse_incentive_override = paid.value
      if (!paid.typed) report.dsePaidDiffers++
    }
  }
  return { units, notes, formats, incentives: incentives.filter((i) => Object.keys(i).length > 1), links, report }
}

// a family's header → the tracker column it feeds (for comments and colours)
const KEY_OF = new Map()
for (const [key, rule] of Object.entries(RULES)) for (const [fam, head] of rule.from) if (!KEY_OF.has(`${fam}|${head}`)) KEY_OF.set(`${fam}|${head}`, key)
for (const [key, from] of Object.entries(INCENTIVES)) for (const [fam, head] of from) KEY_OF.set(`${fam}|${head}`, key)
for (const fam of Object.keys(CHASSIS_AT)) KEY_OF.set(`${fam}|${CHASSIS_AT[fam][0]}`, 'chassis_no')
KEY_OF.set('RET_INT|DSE INCENTIVE', 'dse_incentive_override')
// RET-INT's three unlabelled lookup columns: dropped by the owner (2026-10-21, column map D)
const DROPPED = new Set(['RET_INT|#T', 'RET_INT|#U', 'RET_INT|#V'])
const keyOf = (fam, head) => KEY_OF.get(`${fam}|${head}`) ?? null

module.exports = { merge, RULES, INCENTIVES, LABEL, parse, gstRule, serialToIso, looksLikeChassis }
