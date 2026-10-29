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
