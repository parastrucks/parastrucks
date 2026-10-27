// Who may do what in the gate-invoices Edge Function — the ONE place it is decided.
// index.ts asks ACTION_GATES before it reads any payload; the screens import these same
// functions, so they never offer a button the server would refuse. Pure: no Deno, no network
// (scripts/invoices/selftest-gate-authority.mjs checks every person × action offline).
//
// Owner decisions:
//   2026-10-24  upload / send: service, accounts and spares staff of the invoice's company.
//   2026-10-26  approve or hold a credit release: ONLY the Service GM of that company, or the
//               admin (the owner). No other GM — Sales, Back Office … — may approve.
//   2026-10-26  the gate check: Security guards (one login each), and the admin for testing.
//   2026-10-27  the guard sees a LIST of released vehicles with a search, not only a check
//               box — the same people as the gate check.

export type Who = {
  permission_level: string | null
  department_code: string | null
  entity_id?: string | null
}

// Upload, send and ask for a release — the same departments as the /invoices access rules
// and the gate_* read policies (migrations 20261024 + 20261026).
export const GATE_DEPARTMENTS = ["service", "accounts", "spares"]

export const isAdmin = (c: Who) => c.permission_level === "admin"
export const mayUse = (c: Who) => isAdmin(c) || GATE_DEPARTMENTS.includes(c.department_code ?? "")

/** May approve or hold SOME release — the admin, or a Service GM. */
export const isApprover = (c: Who) =>
  isAdmin(c) || (c.department_code === "service" && c.permission_level === "gm")

/** May approve or hold a release of THIS company. A Service GM decides only for their own. */
export const mayDecideFor = (c: Who, entityId: string | null) =>
  isAdmin(c) || (isApprover(c) && !!entityId && c.entity_id === entityId)

export const mayCheckGate = (c: Who) => isAdmin(c) || c.department_code === "security"

/** The first gate every action passes, before its payload is read. Entity checks follow
 *  inside the action, once the document is loaded. An action missing here is refused. */
export const ACTION_GATES: Record<string, (c: Who) => boolean> = {
  saveDocument: mayUse,
  sendEmail: mayUse,
  pdfUrl: mayUse,
  requestRelease: mayUse,
  withdrawRelease: mayUse,
  decideRelease: isApprover,
  pushKey: isApprover,
  pushSubscribe: isApprover,
  pushUnsubscribe: isApprover,
  gateCheck: mayCheckGate,
  gateList: mayCheckGate,
}

export const mayDo = (action: unknown, c: Who) =>
  typeof action === "string" && Object.hasOwn(ACTION_GATES, action) && ACTION_GATES[action](c)

// How long an approval lets the vehicle out (owner, 2026-10-26: 48 hours).
export const RELEASE_HOURS = 48
