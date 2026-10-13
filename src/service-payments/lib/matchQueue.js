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
import { REOFFER_REASONS } from './signalLabels.js'
// The SAME rules the Edge Function enforces — imported, not restated, so the
// screen can never offer a button the server will refuse (or hide one it
// would allow). Checked for every department × rank by selftest-authority.
import {
  ROLE_GATES, allocateModeAllowed, reverseAllowed, isAccounts, isGmPlus,
} from '../../../supabase/functions/service-payments/authority.ts'

/** What this person may do on the Match screen. */
/**
 * The pending marker while the queue reloads after a write. The next payment is
 * already on screen but its bills are not fresh yet, so it stays locked — and
 * says so, rather than "Saving…" over a payment nobody has touched.
 */
export const REFRESHING = 'refreshing'

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
    // Bills and payments are imported by accounts (admin during the pilot).
    canImport: ROLE_GATES.import_invoices(caller) && ROLE_GATES.import_receipts(caller),
    canMatchMode: (mode) => allocateModeAllowed(caller, mode),
    // "Bill not raised yet" follows matching: the server checks the same pair.
    canMarkWaiting: (mode) => ROLE_GATES.set_awaiting_invoice(caller) && allocateModeAllowed(caller, mode),
    // The "Matched today" list: service staff see their own matches, accounts
    // and GMs everyone's (owner, 2026-10-13). A screen choice — RLS already
    // lets service read every match in the company.
    seesAllMatches: isAccounts(caller) || isGmPlus(caller),
    // The server's own undo rule, so the list never offers a refused Undo.
    undoRefusal: (m) => reverseAllowed(caller, { isMaker: m.maker_id === caller.id, exported: m.exported }),
  }
}

/**
 * "Bill not raised yet" payments wait OUTSIDE the daily queue, and come back
 * only when a bill that could be theirs has been imported SINCE they were
 * marked (the plan: "the matcher re-offers it when invoices import").
 *
 * Not "since it has any candidate": a ₹1,930 payment marked while four ₹1,930
 * bills were open — the person looked at them and said none was it — would
 * otherwise bounce straight back every morning.
 *
 * @param receipts        open receipts (toMatchReceipt shape)
 * @param candidatesFor   (receipt) => the matcher's candidates for it
 * @param invoicesById    Map id -> open invoice (carries created_at)
 * @returns {{queue: object[], waiting: object[]}}  queue rows that came back
 *          carry `back_for_new_bill: true` so the screen can say why.
 */
export function splitWaiting(receipts, candidatesFor, invoicesById) {
  const queue = []
  const waiting = []
  for (const r of receipts) {
    if (!r.awaiting_invoice) { queue.push(r); continue }
    const since = Date.parse(r.awaiting_since ?? '')
    const newer = (c) => (c.invoice_ids ?? []).some((id) => {
      const made = Date.parse(invoicesById.get(id)?.created_at ?? '')
      // An unknown time on either side counts as newer: better one extra look
      // than a payment that never comes back.
      return Number.isNaN(since) || Number.isNaN(made) || made > since
    })
    if (candidatesFor(r).some(newer)) queue.push({ ...r, back_for_new_bill: true })
    else waiting.push(r)
  }
  return { queue, waiting }
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
export function invoiceWindow(receipts, windowDays, { today = null } = {}) {
  const days = receipts
    .map((r) => { try { return istDateOf(r.received_at) } catch { return null } })
    .filter(Boolean)
    .sort()
  if (!days.length) return null
  let to = addDays(days[days.length - 1], windowDays)
  // A payment waiting for its bill was paid BEFORE the bill: its bill may be
  // dated any day up to today, not just within the usual few days.
  if (today && receipts.some((r) => r.awaiting_invoice) && today > to) to = today
  return { from: addDays(days[0], -windowDays), to }
}

/** How far back a waiting payment may be from its bill — about a quarter. */
export const WAITING_MAX_DAYS = 90

/**
 * The matcher's date window for one receipt. Ordinary payments: the usual few
 * days either side. A payment waiting for its bill ("Bill not raised yet"):
 * from its own day up to today, so an advance paid on the 1st is found by a
 * bill raised on the 10th — the 3-day window would never show it, and the
 * payment would never come back. Bills that were already there when it was
 * marked are kept out by splitWaiting, not by the window.
 */
export function windowDaysFor(receipt, today, defaultDays) {
  if (!receipt?.awaiting_invoice || !today) return defaultDays
  let day
  try { day = istDateOf(receipt.received_at) } catch { return defaultDays }
  const gap = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000)
  return Math.min(WAITING_MAX_DAYS, Math.max(defaultDays, gap))
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
 * Undone matches, by payment: receipt id -> [{invoice_id, reversed_at,
 * reverse_reason}], newest first, one entry per bill. The matcher takes the
 * bill ids (`undone`) and never offers them to that payment again; a search
 * pick reads the date and reason to say so (pre-mortem F1).
 */
export function undoneByReceipt(rows) {
  const out = new Map()
  const sorted = [...(rows ?? [])]
    .filter((r) => r.receipt_id && r.invoice_id && r.reversed_at)
    .sort((a, b) => String(b.reversed_at).localeCompare(String(a.reversed_at)))
  const seen = new Set()
  for (const r of sorted) {
    // The NEWEST undo of a (payment, bill) pair decides. Undone "by mistake"
    // or "to match again with a different amount" means the bill was not
    // wrong, so it stays on offer (owner, 2026-10-13) — and no warning.
    const pair = `${r.receipt_id}|${r.invoice_id}`
    if (seen.has(pair)) continue
    seen.add(pair)
    if (REOFFER_REASONS.has(r.reverse_reason)) continue
    if (!out.has(r.receipt_id)) out.set(r.receipt_id, [])
    out.get(r.receipt_id).push({ invoice_id: r.invoice_id, reversed_at: r.reversed_at, reverse_reason: r.reverse_reason ?? '' })
  }
  return out
}

/** The instant the IST day began, `daysBack` days ago — the "Matched today" span. */
export function istDayStart(now, daysBack = 0) {
  const day = istDateOf(now)
  const t = Date.parse(`${day}T00:00:00+05:30`) - daysBack * 86400000
  return new Date(t).toISOString()
}

/**
 * Matches for the "Matched today" list, one entry per CONFIRM.
 *
 * A parts + labour order paid by one transfer is one confirm and two
 * allocation rows sharing a client_request_id; it is shown, and undone, as one
 * thing — undoing half of it would leave the order half paid by accident.
 *
 * @param rows   payment_allocations rows (not reversed) with embedded
 *               receipt {payer_name, mode}, invoice {invoice_number,
 *               customer_name}, maker {full_name}
 * @param caps   capabilitiesFor() — who is looking, and the server's undo rule
 * @returns newest first: {key, allocation_ids, amount_paise, payer_name,
 *          customer_name, invoice_numbers, bill_count, at, maker_id,
 *          maker_name, mine, exported, receipt_id, mode, refusal}
 */
export function groupMatches(rows, caps) {
  const byKey = new Map()
  for (const r of rows ?? []) {
    if (r.reversed_at) continue
    const key = r.client_request_id ?? r.id
    if (!byKey.has(key)) {
      byKey.set(key, {
        key, allocation_ids: [], amount_paise: 0, invoice_numbers: [], customer_names: [],
        payer_name: r.receipt?.payer_name ?? '', mode: r.receipt?.mode ?? null, receipt_id: r.receipt_id,
        at: r.allocated_at, maker_id: r.allocated_by ?? null, maker_name: r.maker?.full_name ?? '',
        exported: false,
      })
    }
    const g = byKey.get(key)
    g.allocation_ids.push(r.id)
    g.amount_paise += r.amount_paise ?? 0
    if (r.invoice?.invoice_number) g.invoice_numbers.push(r.invoice.invoice_number)
    if (r.invoice?.customer_name && !g.customer_names.includes(r.invoice.customer_name)) {
      g.customer_names.push(r.invoice.customer_name)
    }
    if (r.export_batch_id) g.exported = true
    if (String(r.allocated_at) > String(g.at)) g.at = r.allocated_at
  }
  const viewer = caps?.caller?.id ?? null
  return [...byKey.values()]
    .map(({ customer_names, ...g }) => ({
      ...g,
      customer_name: customer_names.join(' + '),
      bill_count: g.allocation_ids.length,
      mine: Boolean(viewer) && g.maker_id === viewer,
      refusal: caps?.undoRefusal ? caps.undoRefusal(g) : 'Not allowed',
    }))
    .filter((g) => caps?.seesAllMatches || g.mine)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/**
 * What a search pick says when the payment was taken off that bill (or one
 * of its order's bills) before. Empty when it never was.
 */
export function undoneNote(undoneForReceipt, invoiceIds) {
  const hit = (undoneForReceipt ?? []).find((u) => invoiceIds.includes(u.invoice_id))
  if (!hit) return ''
  let when = ''
  try {
    const day = istDateOf(hit.reversed_at)
    when = ` on ${new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })
      .format(new Date(`${day}T00:00:00Z`))}`
  } catch { /* an unreadable time drops the date, never the warning */ }
  const why = hit.reverse_reason ? ` ("${hit.reverse_reason}")` : ''
  return `This payment was taken off this bill before${when}${why}. Check it is really the one before you confirm again.`
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
 * What to offer once a bill is picked from search. Alone, the picked bill; if
 * its job order has other open bills (parts + labour, billed apart, paid as one
 * transfer — 245 of 836 measured orders), the whole order as ONE choice too, so
 * the person need not find and confirm the partner separately.
 *
 * Whichever is closer to the money paid comes first; nothing is ranked as a
 * match — the person found it by searching and decides.
 *
 * @param picked        the bill chosen in search
 * @param orderBills    open bills sharing its job_ref (may include picked)
 * @param receiptPaise  what is left of the payment to place
 */
export function searchPickCandidates(picked, orderBills, receiptPaise) {
  const [single] = searchCandidates([picked])
  const members = [picked, ...(orderBills ?? []).filter((v) => v.id !== picked.id)]
  if (!picked.job_ref || members.length < 2) return [single]
  const open = (v) => v.total_paise - (v.allocated_paise ?? 0)
  const order = {
    ...single,
    kind: 'job',
    id: `job:${picked.job_ref}`,
    invoice_ids: members.map((v) => v.id),
    label: `${members.length} bills · order ${picked.job_ref}`,
    invoice_number: members.map((v) => v.invoice_number).join(' + '),
    amount_paise: members.reduce((a, v) => a + open(v), 0),
    member_count: members.length,
  }
  const gap = (c) => Math.abs(c.amount_paise - receiptPaise)
  return gap(order) < gap(single) ? [order, single] : [single, order]
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
    // Under three digits a bill/plate fragment matches nearly everything and
    // churns the list mid-typing (red team 4, R4-20): amount only.
    const moneyOnly = plain.includes('.') || s.includes('₹') || r.length < 3
    return { kind: 'number', paise, text: moneyOnly ? null : r }
  }
  // PostgREST .or() treats , ( ) " as syntax and * % _ as pattern; strip
  // them rather than escape. Nobody searches a bill by punctuation.
  const text = s.replace(/[,()*%_"\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length >= 2 ? { kind: 'text', text } : null
}
