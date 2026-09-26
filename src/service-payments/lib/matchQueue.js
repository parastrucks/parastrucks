// The Match screen's logic, kept out of React so it can be tested without a
// browser, a database or a network (scripts/payments/selftest-match-queue.mjs).
//
// Everything here answers one of four questions:
//   · which receipts does THIS person work, in what order
//   · which bills could they be paying (the window to fetch)
//   · how does one confirm split across a parts + labour pair
//   · may confirm be trusted right now (the stale-bills brake)

import { extractNoteNumbers, extractRegNos, normalizePayerName } from './parseUpi.js'
import { istDateOf } from './dates.js'
// The SAME rules the Edge Function enforces — imported, not restated, so the
// screen can never offer a button the server will refuse (or hide one it
// would allow). Checked for every department × rank by selftest-authority.
import {
  ROLE_GATES, allocateModeAllowed,
} from '../../../supabase/functions/service-payments/authority.ts'

/** What this person may do on the Match screen. */
export function capabilitiesFor(profile, departmentCode) {
  const caller = {
    id: profile?.id ?? null,
    full_name: profile?.full_name ?? '',
    permission_level: profile?.permission_level ?? null,
    entity_id: profile?.entity_id ?? null,
    department_code: departmentCode ?? null,
    is_active: profile?.is_active !== false,
  }
  return {
    caller,
    canMatch: ROLE_GATES.allocate(caller),
    canClassify: ROLE_GATES.classify_receipt(caller),
    canMatchMode: (mode) => allocateModeAllowed(caller, mode),
  }
}

/**
 * A database row from v_payments_open_receipts, shaped for the matcher.
 *
 * The amount being matched is what is still OPEN on the receipt, not its face
 * value: a ₹10,000 transfer that already settled a ₹6,000 bill has ₹4,000 left
 * to place, and offering bills against ₹10,000 would propose an overpayment.
 */
export function toMatchReceipt(row) {
  const open = row.open_paise ?? (row.amount_paise - (row.allocated_paise ?? 0))
  return {
    ...row,
    face_paise: row.amount_paise,
    amount_paise: open,
    partly_matched: (row.allocated_paise ?? 0) > 0,
    note_numbers: extractNoteNumbers(row.payer_remark),
    reg_nos: extractRegNos(row.payer_remark),
    normalized_payer_name: normalizePayerName(row.payer_name),
  }
}

/**
 * Oldest first — the next-morning session works yesterday in order — with
 * anything skipped this session moved to the back in the order it was skipped.
 */
export function orderQueue(receipts, skipped = []) {
  const skipPos = new Map(skipped.map((id, i) => [id, i]))
  return [...receipts].sort((a, b) => {
    const sa = skipPos.has(a.id), sb = skipPos.has(b.id)
    if (sa !== sb) return sa ? 1 : -1
    if (sa && sb) return skipPos.get(a.id) - skipPos.get(b.id)
    return String(a.received_at).localeCompare(String(b.received_at)) ||
           String(a.id).localeCompare(String(b.id))
  })
}

/** Shift an ISO date by whole days, in the calendar, not the clock. */
function addDays(isoDate, n) {
  const t = Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * The invoice dates worth fetching for this queue: every receipt's IST day,
 * widened by the matcher's window on both sides. Null when there is nothing to
 * match — the screen then fetches no bills at all.
 */
export function invoiceWindow(receipts, windowDays) {
  const days = receipts
    .map((r) => { try { return istDateOf(r.received_at) } catch { return null } })
    .filter(Boolean)
    .sort()
  if (!days.length) return null
  return { from: addDays(days[0], -windowDays), to: addDays(days[days.length - 1], windowDays) }
}

/** Put the SAP customer code beside every bill — it is shown beside every name. */
export function attachCustomerCodes(invoices, customers) {
  const byId = new Map(customers.map((c) => [c.id, c]))
  return invoices.map((v) => ({
    ...v,
    sap_customer_code: byId.get(v.customer_id)?.sap_customer_code ?? null,
  }))
}

/** payer_memory rows keyed the way the matcher looks them up (by SAP code). */
export function memoryForMatcher(memoryRows, customers) {
  const byId = new Map(customers.map((c) => [c.id, c]))
  return memoryRows
    .map((m) => ({ ...m, sap_customer_code: byId.get(m.customer_id)?.sap_customer_code ?? null }))
    .filter((m) => m.sap_customer_code)
}

/**
 * Turn a picked candidate into the RPC's targets.
 *
 * A job candidate is two or more bills. The customer paid one sum, so the
 * money is spread bill by bill at each bill's exact open amount, CASH-TERMS
 * FIRST (plan: a cash bill left open is the skimming signature the unpaid-cash
 * feed watches for), then oldest, then by number so the split is the same
 * every time. If the receipt is short, the last bill is part-paid; if it is
 * long, the surplus stays on the receipt for the next match. Never more than
 * the receipt holds, never more than a bill owes.
 */
export function allocationTargets(candidate, invoicesById, receiptOpenPaise) {
  const bills = candidate.invoice_ids
    .map((id) => invoicesById.get(id))
    .filter(Boolean)
    .sort((a, b) =>
      (a.payment_terms === 'cash' ? 0 : 1) - (b.payment_terms === 'cash' ? 0 : 1) ||
      String(a.invoice_date).localeCompare(String(b.invoice_date)) ||
      String(a.invoice_number).localeCompare(String(b.invoice_number)))
  if (bills.length !== candidate.invoice_ids.length) {
    throw new Error('A bill on this match is no longer open. Reload and pick again.')
  }
  let left = receiptOpenPaise
  const targets = []
  for (const b of bills) {
    if (left <= 0) break
    const open = b.total_paise - (b.allocated_paise ?? 0)
    const take = Math.min(open, left)
    if (take > 0) { targets.push({ invoice_id: b.id, amount_paise: take }); left -= take }
  }
  if (!targets.length) throw new Error('Nothing left to place on this bill.')
  return targets
}

/** The strongest reason a match was offered, for the audit trail. */
export function matchSignalOf(candidate) {
  const order = ['reg_full', 'reg_last4', 'amount_unique', 'note_bill_number',
    'payer_memory', 'name_overlap_strong', 'amount_ambiguous',
    'payer_memory_weak', 'name_overlap', 'search']
  const names = (candidate?.signals || []).map((s) => s.signal)
  return order.find((s) => names.includes(s)) ?? null
}

/**
 * The stale-bills brake. A confident confirm against a bill feed that has not
 * caught up is an error amplifier: the right bill may simply not be imported
 * yet, and the wrong one is sitting there looking plausible.
 *
 * Stale when no bill import exists at all, or when the payment arrived after
 * the last import's coverage. Fails CLOSED: an unreadable feed status is stale.
 */
export function feedIsStaleFor(receipt, invoiceFeed) {
  const covered = Date.parse(invoiceFeed?.covered_until ?? '')
  const paid = Date.parse(receipt?.received_at ?? '')
  if (Number.isNaN(covered) || Number.isNaN(paid)) return true
  return paid > covered
}

/**
 * Candidates from a free search, in the shape MatchScreen renders. They carry
 * a 'search' signal so the screen and the audit trail both say where they came
 * from — a bill a person found themselves is not a bill the tool suggested.
 */
export function searchCandidates(invoices) {
  return invoices.map((v) => ({
    kind: 'invoice',
    id: v.id,
    invoice_ids: [v.id],
    label: v.invoice_number,
    amount_paise: v.total_paise - (v.allocated_paise ?? 0),
    date: v.invoice_date,
    sap_customer_code: v.sap_customer_code ?? null,
    customer_name: v.customer_name,
    vehicle_reg_no: v.vehicle_reg_no,
    invoice_number: v.invoice_number,
    payment_terms: v.payment_terms,
    signals: [{ signal: 'search', detail: v.invoice_date }],
    rank: null,
  }))
}

/**
 * What the search box means.
 *
 * A bare number is AMBIGUOUS and is searched both ways: "9044" is as likely
 * the last four of a plate (measured: 17 of 28 numbers typed into August's
 * payment notes were exactly that) as it is ₹9,044. So a number matches the
 * amount OR a bill / order / plate containing those digits. A number with
 * paise (1930.50) or a ₹ sign can only be money.
 */
export function parseSearch(input) {
  const s = String(input ?? '').trim()
  if (s.length < 2) return null
  const plain = s.replace(/[₹,\s]/g, '')
  if (/^\d+(\.\d{1,2})?$/.test(plain) && plain.split('.')[0].length <= 8) {
    const [r, p = ''] = plain.split('.')
    const paise = Number(r) * 100 + Number((p + '00').slice(0, 2))
    const moneyOnly = plain.includes('.') || s.includes('₹')
    return { kind: 'number', paise, text: moneyOnly ? null : r }
  }
  // PostgREST .or() treats , ( ) " as syntax and * % _ as pattern; strip
  // them rather than escape. Nobody searches a bill by punctuation.
  const text = s.replace(/[,()*%_"\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length >= 2 ? { kind: 'text', text } : null
}
