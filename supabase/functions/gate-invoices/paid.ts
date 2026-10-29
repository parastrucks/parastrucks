// Is a released invoice paid? — the ONE rule, shared by the Edge Function (what the approver's
// card showed) and the screens (the Follow-up tab, the approval card). Pure: no Deno, no network
// (scripts/invoices/selftest-gate-paid.mjs checks it offline).
//
// Owner, 2026-10-29: paid status comes ONLY from matching payments to bills — no "mark paid".
// An uploaded invoice's bills (gate_bills, read from the PDF) are the SAP bills the matching tool
// loads from the Billing Report (service_invoices); both are unique per (company, bill number),
// so a bill links to at most one SAP bill. What the matching tool has placed on a bill is its
// allocated_paise.
//
// What a SAP bill's status means for "still owed" (payments schema 20260830):
//   active       counts toward outstanding          → owed = total − matched
//   not_payable  free of cost, never matched        → owes nothing
//   cancelled    SAP cancelled it                   → owes nothing
//   pre_opening  before matching began (Busy's opening balance holds it) → cannot tell
//   parked       held aside (parts returns)         → cannot tell
// A bill the Billing Report has not brought in yet → cannot tell. "Cannot tell" is never shown
// as paid or as unpaid: a wrong "unpaid" chases a customer who paid; a wrong "paid" lets one go.

export type UploadedBill = { bill_no: string; amount_paise: number }
export type SapBill = { invoice_number: string; status: string; total_paise: number; allocated_paise: number }

export type PaidState = "paid" | "part" | "unpaid" | "unknown"
export type Unknown = "not_loaded" | "before_matching" | "parked"

export type Paid = {
  state: PaidState
  due_paise: number          // still owed on the bills that can be judged
  paid_paise: number         // matched so far on those bills
  unknown: { bill_no: string; why: Unknown }[]
  amount_differs: string[]   // the PDF and the Billing Report disagree on a bill's total
}

const OWES_NOTHING = new Set(["not_payable", "cancelled"])

export function paidState(bills: UploadedBill[], sap: SapBill[]): Paid {
  const byNo = new Map(sap.map((s) => [s.invoice_number, s]))
  let due = 0, paid = 0
  const unknown: Paid["unknown"] = []
  const amountDiffers: string[] = []
  for (const b of bills) {
    const s = byNo.get(b.bill_no)
    if (!s) { unknown.push({ bill_no: b.bill_no, why: "not_loaded" }); continue }
    if (s.status === "pre_opening") { unknown.push({ bill_no: b.bill_no, why: "before_matching" }); continue }
    if (s.status === "parked") { unknown.push({ bill_no: b.bill_no, why: "parked" }); continue }
    if (OWES_NOTHING.has(s.status)) continue
    if (s.status !== "active") { unknown.push({ bill_no: b.bill_no, why: "not_loaded" }); continue }   // a status we do not know: never guess
    const total = Number(s.total_paise), matched = Math.min(Number(s.allocated_paise), total)
    if (total !== Number(b.amount_paise)) amountDiffers.push(b.bill_no)
    due += total - matched
    paid += matched
  }
  // Any bill that cannot be judged makes the whole invoice "cannot tell" — but what is already
  // known to be owed or paid on the others is still reported.
  const state: PaidState = unknown.length > 0 ? "unknown" : due === 0 ? "paid" : paid > 0 ? "part" : "unpaid"
  return { state, due_paise: due, paid_paise: paid, unknown, amount_differs: amountDiffers }
}

/** A promise is broken when its day has passed (in India) and the invoice is not paid. */
export function promiseBroken(promisedBy: string | null | undefined, state: PaidState, todayIst: string): boolean {
  return Boolean(promisedBy) && state !== "paid" && (promisedBy as string) < todayIst
}

/** Today's date in India as YYYY-MM-DD (a promise is a calendar day there, never UTC). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/** A promise is for today up to this many days ahead (the table holds the same rule —
 *  migration 20261029_gate_promises.sql). */
export const PROMISE_MAX_DAYS = 90

/** The last day a promise made today may name (the date picker's max; today is its min). */
export function lastPromiseDay(todayIst: string): string {
  const [y, m, d] = todayIst.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + PROMISE_MAX_DAYS)).toISOString().slice(0, 10)
}

/** A promise day as sent: "YYYY-MM-DD", a real date, today to PROMISE_MAX_DAYS ahead in India.
 *  null when empty (no promise date), false when it is anything else. */
export function cleanPromiseDay(s: unknown, todayIst: string): string | null | false {
  if (s === undefined || s === null || s === "") return null
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return false   // 31 Feb
  return s >= todayIst && s <= lastPromiseDay(todayIst) ? s : false
}

/**
 * One customer's released invoices, for the approval card: how many are not known to be paid,
 * what is known to be due on them, how many cannot be told yet, how many promises are broken,
 * and since when the oldest has been out. Each invoice is counted once (its latest approval
 * carries the promise), however many times it was released.
 */
export type Released = { document_id: string; released_at: string; promised_by: string | null; paid: Paid }
export type CustomerSummary = {
  invoices: number; unpaid: number; due_paise: number; unknown: number; broken: number; oldest_unpaid_at: string | null
}
export function customerSummary(released: Released[], todayIst: string): CustomerSummary {
  const latest = new Map<string, Released>()
  for (const r of released) {
    const cur = latest.get(r.document_id)
    if (!cur || r.released_at > cur.released_at) latest.set(r.document_id, r)
  }
  const s: CustomerSummary = { invoices: latest.size, unpaid: 0, due_paise: 0, unknown: 0, broken: 0, oldest_unpaid_at: null }
  for (const r of latest.values()) {
    s.due_paise += r.paid.due_paise
    if (r.paid.state === "unpaid" || r.paid.state === "part") s.unpaid++
    if (r.paid.state === "unknown") s.unknown++
    if (promiseBroken(r.promised_by, r.paid.state, todayIst)) s.broken++
    if (r.paid.state !== "paid" && (!s.oldest_unpaid_at || r.released_at < s.oldest_unpaid_at)) s.oldest_unpaid_at = r.released_at
  }
  return s
}

/**
 * The Follow-up list: released invoices not yet paid. Broken promises first (the oldest promise
 * first), then promises still to come (the soonest first), then those with no promise (the
 * oldest release first). Paid invoices are not on it.
 */
export type FollowUp = { document_id: string; promised_by: string | null; released_at: string; paid: Paid }
export function followUpOrder<T extends FollowUp>(rows: T[], todayIst: string): T[] {
  const rank = (r: T) => promiseBroken(r.promised_by, r.paid.state, todayIst) ? 0 : r.promised_by ? 1 : 2
  return rows.filter((r) => r.paid.state !== "paid").sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) < 2 ? (a.promised_by as string).localeCompare(b.promised_by as string) : 0) ||
    a.released_at.localeCompare(b.released_at))
}
