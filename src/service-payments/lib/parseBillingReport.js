// Parser for the SAP Billing Report — the invoice feed.
//
// This report REPLACED the R5 + R6 route the plan was originally built on. It
// is one row per invoice, it includes counter sales (the block R5/R6 could not
// see), and it carries a Cancelled column. Swapping to it moved "payment
// matches no invoice at all" from 59% down to 25%.
//
// Measured against the real file, 1 Aug - 29 Aug 2026, 1,085 rows.

import { rupeeStringToPaise } from './paise.js'
import { excelSerialToISODate } from './dates.js'

export const PARSER_VERSION = 'billing-report-2026-08-30'

/** Header is the FOURTH row. Rows 1-3 are a title, a count, and a blank. */
export const HEADER_ROW_INDEX = 3

export const REQUIRED_COLUMNS = [
  'Billing Date', 'Plant', 'Customer Name', 'Dealer invoice number',
  'Net value', 'Tax Value', 'Total', 'Billing Type', 'Customer Number',
  'Billing Document', 'Payment terms',
]

/**
 * Invoice prefix -> what it is. Measured across 1,085 real invoices.
 *
 * Character 1 says what was sold, characters 2-3 say on what terms:
 *   P = parts on a job card, L = labour on a job card, M = counter sale
 */
export const PREFIX_MAP = {
  PCS: { kind: 'service_parts',  terms: 'cash',   billing_type: 'ZMSI', payable: true  },
  PCR: { kind: 'service_parts',  terms: 'credit', billing_type: 'ZMSI', payable: true  },
  LCS: { kind: 'service_labour', terms: 'cash',   billing_type: 'ZMSI', payable: true  },
  LCR: { kind: 'service_labour', terms: 'credit', billing_type: 'ZMSI', payable: true  },
  MPI: { kind: 'counter_sale',   terms: 'cash',   billing_type: 'ZMPI', payable: true  },
  MCI: { kind: 'counter_sale',   terms: 'credit', billing_type: 'ZMCI', payable: true  },
  PEI: { kind: 'foc',            terms: null,     billing_type: 'ZFCI', payable: false },
  LEI: { kind: 'foc',            terms: null,     billing_type: 'ZFCI', payable: false },
  MPR: { kind: 'parts_return',   terms: null,     billing_type: 'ZMPR', payable: false },
}

/** invoice_kind -> the status it imports with. */
const STATUS_FOR_KIND = {
  service_parts: 'active',
  service_labour: 'active',
  counter_sale: 'active',
  foc: 'not_payable',    // free of cost: recorded so the file reconciles, never payable
  parts_return: 'parked',// pending accounts' answer: credit the account, or money back out?
}

/** SAP plant -> outlet city. Measured: only these two exist for PTB. */
export const PLANT_CITY = { 5756: 'Ahmedabad', 6370: 'Anand' }

const TERMS_MAP = { D001: 'cash', D002: 'credit' }

/**
 * @param {any[][]} rows  sheet as an array of arrays (SheetJS header:1, raw:true)
 * @param {object} opts
 * @param {string|null} opts.entityId
 * @param {Record<string,string>} opts.outletIdByPlant  e.g. {'5756': '<uuid>'}
 * @param {string|null} opts.openingBalanceAsOf  ISO date; invoices on/before it
 *                                               import as pre_opening
 */
export function parseBillingReport(rows, {
  entityId = null,
  outletIdByPlant = {},
  openingBalanceAsOf = null,
} = {}) {
  if (!Array.isArray(rows) || rows.length <= HEADER_ROW_INDEX) {
    throw new Error('Billing Report is empty or too short to contain a header')
  }

  // ── Gate 1: is this the report we think it is? ──────────────────────────
  const title = String(rows[0]?.[0] ?? '').trim()
  if (!/billing report/i.test(title)) {
    throw new Error(`row 1 should read "Billing Report", found ${JSON.stringify(title)}. Wrong export?`)
  }

  const header = (rows[HEADER_ROW_INDEX] || []).map((h) => (h === null || h === undefined ? '' : String(h).trim()))
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length) {
    throw new Error(
      `Billing Report is missing required column(s): ${missing.join(', ')}. ` +
      `The SAP layout is edited from a shared login, so this usually means the ` +
      `variant changed. Found: ${header.filter(Boolean).join(', ')}`
    )
  }
  const idx = {}
  header.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i })
  const cell = (row, name) => {
    const v = row[idx[name]]
    return v === null || v === undefined ? '' : v
  }

  const body = rows.slice(HEADER_ROW_INDEX + 1)
    .filter((r) => Array.isArray(r) && r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))

  // ── Gate 2: SAP counted the rows for us. Use it. ────────────────────────
  // Row 2 reads "No. of entries" / <count>. A short file means the export was
  // interrupted, which is invisible any other way.
  const declared = Number(String(rows[1]?.[1] ?? '').replace(/[^\d]/g, ''))
  if (Number.isFinite(declared) && declared > 0 && declared !== body.length) {
    throw new Error(
      `Billing Report says it holds ${declared} entries but ${body.length} rows were read. ` +
      `Refusing a partial export.`
    )
  }

  const invoices = []
  const refused = []
  const seenNumbers = new Map()
  let netTaxMismatches = 0
  let bijectionMismatches = 0

  body.forEach((row, i) => {
    const rowNo = HEADER_ROW_INDEX + 2 + i     // 1-based spreadsheet row
    try {
      const invoiceNumber = String(cell(row, 'Dealer invoice number')).trim()
      if (!invoiceNumber) throw new Error('blank Dealer invoice number')

      if (seenNumbers.has(invoiceNumber)) {
        throw new Error(`duplicate invoice number, first seen at row ${seenNumbers.get(invoiceNumber)}`)
      }

      const prefix = invoiceNumber.slice(0, 3).toUpperCase()
      const spec = PREFIX_MAP[prefix]
      if (!spec) {
        throw new Error(
          `unknown invoice prefix "${prefix}". Known: ${Object.keys(PREFIX_MAP).join(', ')}. ` +
          `A new prefix means SAP started issuing a document type this tool has never seen — ` +
          `it must be classified by a person before it can be payable.`
        )
      }

      // ── Gate 3: the bijection. ──────────────────────────────────────────
      // Prefix and SAP billing type are two INDEPENDENT statements of what a
      // document is, and across 1,085 real invoices they agree perfectly. So
      // disagreement is not a curiosity, it is a corrupt or misunderstood row,
      // and guessing which one to believe is exactly how a warranty claim ends
      // up billed to a customer.
      const billingType = String(cell(row, 'Billing Type')).trim().toUpperCase()
      if (billingType && billingType !== spec.billing_type) {
        bijectionMismatches++
        throw new Error(
          `prefix ${prefix} implies billing type ${spec.billing_type} but SAP says ${billingType}`
        )
      }

      const totalPaise = rupeeStringToPaise(cell(row, 'Total'))
      if (spec.payable && totalPaise <= 0) {
        throw new Error(`payable invoice with non-positive total: ${cell(row, 'Total')}`)
      }
      if (totalPaise < 0) throw new Error(`negative total: ${cell(row, 'Total')}`)

      // ── Gate 4: money cross-foot. ───────────────────────────────────────
      // Net + Tax = Total on every one of the 1,085 measured rows. A row that
      // fails this has been mangled between SAP and the spreadsheet.
      const netPaise = rupeeStringToPaise(cell(row, 'Net value') || '0')
      const taxPaise = rupeeStringToPaise(cell(row, 'Tax Value') || '0')
      if (netPaise + taxPaise !== totalPaise) {
        netTaxMismatches++
        throw new Error(
          `Net (${netPaise}p) + Tax (${taxPaise}p) does not equal Total (${totalPaise}p)`
        )
      }

      const rawDate = cell(row, 'Billing Date')
      const invoiceDate = typeof rawDate === 'number'
        ? excelSerialToISODate(rawDate)
        : normaliseTextDate(rawDate)

      const plant = String(cell(row, 'Plant')).trim()
      const customerCode = String(cell(row, 'Customer Number')).trim()
      if (!customerCode) throw new Error('blank Customer Number — nothing to attribute the money to')

      // SAP's own column name carries a typo ("dsecription"); match it verbatim
      // rather than tidying it, or the lookup silently returns nothing.
      const termsCode = String(cell(row, 'Payment terms')).trim().toUpperCase()
      const paymentTerms = TERMS_MAP[termsCode] ?? spec.terms ?? null

      const cancelledFlag = String(cell(row, 'Cancelled') ?? '').trim()
      let status = cancelledFlag ? 'cancelled' : STATUS_FOR_KIND[spec.kind]
      if (status === 'active' && openingBalanceAsOf && invoiceDate <= openingBalanceAsOf) {
        status = 'pre_opening'
      }

      seenNumbers.set(invoiceNumber, rowNo)
      invoices.push({
        entity_id: entityId,
        outlet_id: outletIdByPlant[plant] ?? null,
        sap_plant: plant || null,
        invoice_number: invoiceNumber,
        sap_billing_doc: String(cell(row, 'Billing Document')).trim() || null,
        invoice_kind: spec.kind,
        sap_billing_type: billingType || null,
        split_order_type: String(cell(row, 'Split Order Type description') ?? '').trim() || null,
        job_ref: String(cell(row, 'Order number') ?? '').trim() || null,
        dealer_order_no: String(cell(row, 'Dealer specific order number') ?? '').trim() || null,
        invoice_date: invoiceDate,
        sap_customer_code: customerCode,
        customer_name: String(cell(row, 'Customer Name') ?? '').trim() || null,
        customer_gstin: String(cell(row, 'Customer GSTN') ?? '').trim() || null,
        customer_pan: String(cell(row, 'Customer PAN') ?? '').trim() || null,
        vehicle_reg_no: normaliseReg(cell(row, 'Reg.No')),
        chassis_no: String(cell(row, 'Chassis') ?? '').trim() || null,
        payment_terms: paymentTerms,
        net_paise: netPaise,
        tax_paise: taxPaise,
        total_paise: totalPaise,
        cancelled_flag: cancelledFlag || null,
        irn_no: String(cell(row, 'IRN No') ?? '').trim() || null,
        status,
        _row: rowNo,
      })
    } catch (e) {
      refused.push({ row: rowNo, reason: e.message, invoice_number: String(cell(row, 'Dealer invoice number') || '').trim() || null })
    }
  })

  const payable = invoices.filter((v) => v.status === 'active')

  return {
    parser_version: PARSER_VERSION,
    header,
    invoices,
    refused,
    summary: {
      declared_entries: Number.isFinite(declared) ? declared : null,
      rows_read: body.length,
      parsed: invoices.length,
      refused: refused.length,
      payable: payable.length,
      payable_paise: payable.reduce((a, v) => a + v.total_paise, 0),
      by_kind: countBy(invoices, (v) => v.invoice_kind),
      by_status: countBy(invoices, (v) => v.status),
      by_plant: countBy(invoices, (v) => v.sap_plant),
      net_tax_mismatches: netTaxMismatches,
      bijection_mismatches: bijectionMismatches,
      distinct_customers: new Set(invoices.map((v) => v.sap_customer_code)).size,
      // Orders that bill as more than one invoice: measured at 245 of 836, so
      // the Match screen must offer a job total, not just single invoices.
      multi_invoice_orders: countMultiInvoiceOrders(invoices),
    },
  }
}

function countMultiInvoiceOrders(invoices) {
  const byJob = new Map()
  for (const v of invoices) {
    if (!v.job_ref) continue
    byJob.set(v.job_ref, (byJob.get(v.job_ref) || 0) + 1)
  }
  let n = 0
  for (const c of byJob.values()) if (c > 1) n++
  return n
}

function countBy(list, fn) {
  const out = {}
  for (const x of list) { const k = fn(x) ?? '(none)'; out[k] = (out[k] || 0) + 1 }
  return out
}

function normaliseReg(v) {
  const s = String(v ?? '').toUpperCase().replace(/[\s-]/g, '')
  return s || null
}

/**
 * A fallback for the day SAP's variant emits text dates instead of serials.
 * Accepts DD.MM.YYYY, DD/MM/YYYY and YYYY-MM-DD. Day-first is the SAP default
 * for this locale; an ambiguous value is refused rather than guessed, because
 * silently reading 03/08 as 8 March would mis-date a month of invoices.
 */
function normaliseTextDate(v) {
  const s = String(v ?? '').trim()
  if (!s) throw new Error('blank Billing Date')
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2])
    if (d > 31 || mo > 12) throw new Error(`unreadable Billing Date: ${JSON.stringify(s)}`)
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  throw new Error(`unreadable Billing Date: ${JSON.stringify(s)}`)
}
