// supabase/functions/service-payments/authority.ts
// WHO may do WHAT in service payments — the plan's authority ladder, as data.
//
// Pure: no Deno, no network, no database. That is the point. The first draft
// had these rules inline in index.ts and got them wrong in a way nobody could
// see (every manager in the company was admitted — see the note on inScope).
// Here they are a function of (department, rank) that the Node self-test
// `scripts/payments/selftest-authority.mjs` checks against EVERY department and
// rank the portal has, including departments that must be refused.
//
// Source of truth: docs/backlog/service-payments-plan.md, "Authority ladder".
// Data-dependent rules (the receipt's mode, who made an allocation, whether it
// has been exported) take those facts as arguments, so they are tested here too.

export type Caller = {
  id: string
  full_name: string
  permission_level: string | null
  entity_id: string | null
  department_code: string | null
  is_active: boolean
}

export const PAYMENTS_DEPTS = ["service", "accounts"]

export const isAdmin = (c: Caller) => c.permission_level === "admin"

// Department first, then rank. The first draft admitted every manager and GM in
// the company — Sales, HR, Back Office — and then let "any manager" void
// receipts, key cash, close TDS and declassify money: the four verbs the plan
// gives to accounts alone. On prod that was 4 Sales managers, 2 GMs outside
// service and accounts, and an HR manager (found 2026-09-19, before first use).
export const inScope = (c: Caller) =>
  isAdmin(c) || PAYMENTS_DEPTS.includes(c.department_code ?? "")

export const isAccounts = (c: Caller) => isAdmin(c) || c.department_code === "accounts"

// Safe ONLY behind inScope(): past that gate "gm" can only mean the service or
// accounts GM. Never call this on a caller who has not been through inScope().
export const isGmPlus = (c: Caller) => inScope(c) && ["gm", "admin"].includes(c.permission_level ?? "")

// Actions whose permission depends on the caller alone. Service executives match
// UPI — that IS their job, and why this feature is phone-first — but nothing that
// moves money out of the ordinary path: no TDS, no voids, no classifying.
export const ROLE_GATES: Record<string, (c: Caller) => boolean> = {
  allocate:              (c) => inScope(c),                       // UPI; non-UPI adds allocateModeAllowed
  on_account:            (c) => isAccounts(c),
  reverse_allocation:    (c) => inScope(c),                       // then reverseAllowed()
  classify_receipt:      (c) => isAccounts(c),
  close_tds:             (c) => isAccounts(c) || isGmPlus(c),     // over 5%: tdsOverCapAllowed
  manual_receipt:        (c) => isAccounts(c),
  void_receipt:          (c) => isAccounts(c),
  import_invoices:       (c) => isAccounts(c),
  import_receipts:       (c) => isAccounts(c),
  create_group:          (c) => isGmPlus(c),
  assign_customer_group: (c) => isGmPlus(c),
  set_credit_limit:      (c) => isGmPlus(c),
}

export const DENIED_MESSAGE: Record<string, string> = {
  allocate:              "Service payments is for the service and accounts teams.",
  on_account:            "Accounts places money on a customer's account.",
  reverse_allocation:    "Service payments is for the service and accounts teams.",
  classify_receipt:      "Accounts decides what is not a service payment.",
  close_tds:             "Accounts closes bills against TDS.",
  manual_receipt:        "Accounts enters cash and cheque receipts.",
  void_receipt:          "Accounts voids receipts.",
  import_invoices:       "Only accounts or an admin can import bills.",
  import_receipts:       "Only accounts or an admin can import payments.",
  create_group:          "A GM or admin creates customer groups.",
  assign_customer_group: "A GM or admin assigns customers to groups.",
  set_credit_limit:      "A GM or admin sets credit limits.",
}

/** Anything not UPI — cash, cheque, bank — is keyed and matched by accounts. */
export const allocateModeAllowed = (c: Caller, mode: string | null | undefined) =>
  mode === "upi" ? inScope(c) : isAccounts(c)

/** Only a GM may ask to close TDS above the 5% cap (the RPC enforces the cap). */
export const tdsOverCapAllowed = (c: Caller) => isGmPlus(c)

/**
 * Undoing an allocation. The maker may undo their own un-exported work, as may
 * accounts; anything already sent to Busy needs a GM, because it cannot be
 * un-sent and must travel as a contra entry in the next file.
 * Returns null when allowed, else the message to show.
 */
export function reverseAllowed(
  c: Caller,
  a: { isMaker: boolean; exported: boolean },
): string | null {
  if (!inScope(c)) return DENIED_MESSAGE.reverse_allocation
  if (a.exported) {
    return isGmPlus(c)
      ? null
      : "This entry has already gone to Busy. A GM can reverse it; it will travel as a correcting entry."
  }
  if (a.isMaker || isAccounts(c) || isGmPlus(c)) return null
  return "Only the person who matched this, or accounts, can undo it."
}
