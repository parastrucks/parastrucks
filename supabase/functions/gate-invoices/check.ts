// Server-side check of what the browser read from the PDF (src/invoices/lib/sapInvoice.js).
//
// The browser reads the PDF; the server does NOT re-read it (pdfjs inside an Edge Function
// is heavy and untested here). So the server re-checks everything it CAN without the PDF:
// every field's shape, the dates, and that the bills add up to the total. A reading that
// fails is refused. What this does not catch: a browser that sends a self-consistent
// reading of a different file — the stored PDF is the record, and accounts see both.

export type Reading = {
  layout: "workshop" | "counter_sale"
  sap_form: string
  doc_no: string
  doc_date: string
  order_no: string | null
  order_type: string | null
  payment_terms: string | null
  seller_gstin: string | null
  customer: { name: string; sap_code: string; mobile: string | null; pan: string | null; gstin: string | null }
  vehicle: { regn_no: string | null; model: string | null; chassis_no: string | null; engine_no: string | null } | null
  bills: { bill_no: string; bill_date: string; amount_paise: number; ex_tax_paise: number | null; terms: string | null }[]
  total_paise: number
}

// Who may upload and send now lives with every other rule in authority.ts (step 2).
export { GATE_DEPARTMENTS, mayUse } from "./authority.ts"

const FORMS: Record<string, Reading["layout"]> = {
  ZSF_RETAIL_INVOICE_GST_NEW: "counter_sale",
  ZDBMF_COVERING_LETTER_001: "workshop",
}
const isDate = (s: unknown) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const short = (s: unknown, max: number) => s === null || s === undefined || (typeof s === "string" && s.length <= max)
const paise = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) < 1e12

export function checkReading(r: unknown): string | null {
  const x = r as Reading
  if (!x || typeof x !== "object") return "No reading sent."
  if (FORMS[x.sap_form] !== x.layout) return "Unknown invoice layout."
  if (typeof x.doc_no !== "string" || !/^[A-Z]{2,4}\d{10,16}$/.test(x.doc_no)) return "Bad invoice / job card number."
  if (!isDate(x.doc_date)) return "Bad invoice date."
  if (typeof x.seller_gstin !== "string" || !/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(x.seller_gstin)) return "The seller GSTIN was not read."
  const c = x.customer
  if (!c || typeof c.name !== "string" || c.name.trim().length < 2 || c.name.length > 200) return "Bad customer name."
  if (typeof c.sap_code !== "string" || !/^\d{4,12}$/.test(c.sap_code)) return "Bad SAP customer code."
  if (!(c.mobile === null || (typeof c.mobile === "string" && /^\d{10}$/.test(c.mobile)))) return "Bad mobile number."
  if (!(c.pan === null || (typeof c.pan === "string" && /^[A-Z]{5}\d{4}[A-Z]$/.test(c.pan)))) return "Bad PAN."
  if (!(c.gstin === null || (typeof c.gstin === "string" && /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(c.gstin)))) return "Bad customer GSTIN."
  for (const k of ["order_no", "order_type", "payment_terms"] as const) if (!short(x[k], 60)) return `Bad ${k}.`
  if (x.layout === "workshop") {
    const v = x.vehicle
    if (!v) return "A workshop invoice must carry the vehicle."
    if (!(v.regn_no === null || (typeof v.regn_no === "string" && /^[A-Z0-9]{6,12}$/.test(v.regn_no)))) return "Bad registration number."
    for (const k of ["model", "chassis_no", "engine_no"] as const) if (!short(v[k], 60)) return `Bad ${k}.`
  } else if (x.vehicle !== null) return "A counter sale has no vehicle."
  if (!Array.isArray(x.bills) || x.bills.length === 0 || x.bills.length > 20) return "Bad list of bills."
  const seen = new Set<string>()
  let sum = 0
  for (const b of x.bills) {
    if (typeof b.bill_no !== "string" || !/^[A-Z]{3}\d{10,16}$/.test(b.bill_no)) return "Bad bill number."
    if (seen.has(b.bill_no)) return "A bill is listed twice."
    seen.add(b.bill_no)
    if (!isDate(b.bill_date)) return `Bad date on bill ${b.bill_no}.`
    if (!paise(b.amount_paise)) return `Bad amount on bill ${b.bill_no}.`
    if (!(b.ex_tax_paise === null || (Number.isSafeInteger(b.ex_tax_paise) && b.ex_tax_paise >= 0))) return `Bad amount on bill ${b.bill_no}.`
    if (!(b.terms === null || b.terms === "cash" || b.terms === "credit")) return `Bad cash/credit on bill ${b.bill_no}.`
    sum += b.amount_paise
  }
  if (!paise(x.total_paise)) return "Bad total."
  if (sum !== x.total_paise) return "The bills do not add up to the total."
  if (x.layout === "counter_sale" && (x.bills.length !== 1 || x.bills[0].bill_no !== x.doc_no)) return "A counter sale is one bill: the invoice itself."
  return null
}

/** One address, lower case; refuses anything that could add a header or a second recipient. */
export function cleanEmail(s: unknown): string | null {
  if (typeof s !== "string") return null
  const e = s.trim().toLowerCase()
  if (e.length > 254 || !/^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) || e.includes("..")) return null
  return e
}

/** Staging guard: GATE_EMAIL_ONLY_TO="a@x.com,@parastrucks.in" limits who can receive mail. */
export function recipientAllowed(email: string, onlyTo: string | undefined): boolean {
  const rules = (onlyTo ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (rules.length === 0) return true
  return rules.some((r) => (r.startsWith("@") ? email.endsWith(r) : email === r))
}
