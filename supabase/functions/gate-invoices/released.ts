// The invoices released on credit, each with its paid state — read with whatever client it is
// given: the Edge Function's service-role client (the approval card it records), or the browser's
// signed-in client (the Follow-up tab and the card on screen), where RLS decides what is seen.
// The rule itself is paid.ts; this file only fetches. No Deno APIs, so the browser imports it too.

import { paidState, type Paid, type SapBill, type UploadedBill } from "./paid.ts"

// The few supabase-js calls used here, typed loosely so the Deno and npm clients both fit.
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

export type ReleasedInvoice = {
  release_id: string
  document_id: string
  entity_id: string
  regn_no: string
  released_at: string          // the latest approval of this invoice
  promised_by: string | null   // …and its promise
  responsible_name: string | null
  approved_by_name: string | null
  doc_no: string
  customer_name: string
  sap_customer_code: string
  total_paise: number
  bills: UploadedBill[]
  paid: Paid
}

const PAGE = 1000      // PostgREST's row cap: read in pages, never trust one page to be all
const IN_CHUNK = 150   // bill numbers per request (they go in the URL)

const SELECT = `id, document_id, entity_id, regn_no, decided_at, promised_by,
  responsible:users!gate_releases_responsible_id_fkey(full_name),
  decider:users!gate_releases_decided_by_fkey(full_name),
  gate_documents!inner(doc_no, customer_name, sap_customer_code, total_paise, gate_bills(bill_no, amount_paise))`

/**
 * Every invoice ever approved for release (or one customer's), latest approval per invoice, with
 * its paid state from the matching tool's bills. `canSeePayments: false` (someone RLS keeps out of
 * the matching tables) skips that read, and every invoice is "cannot tell" — never a false "unpaid".
 */
export async function loadReleased(db: Db, opts: {
  entityId?: string | null; sapCode?: string; excludeDocumentId?: string; canSeePayments?: boolean
} = {}): Promise<ReleasedInvoice[]> {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    let q = db.from("gate_releases").select(SELECT).eq("status", "approved")
    if (opts.entityId) q = q.eq("entity_id", opts.entityId)
    if (opts.sapCode) q = q.eq("gate_documents.sap_customer_code", opts.sapCode)
    if (opts.excludeDocumentId) q = q.neq("document_id", opts.excludeDocumentId)
    const { data, error } = await q.order("decided_at", { ascending: true }).order("id").range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  // Latest approval per invoice.
  // deno-lint-ignore no-explicit-any
  const latest = new Map<string, any>()
  // deno-lint-ignore no-explicit-any
  for (const r of rows as any[]) {
    const cur = latest.get(r.document_id)
    if (!cur || r.decided_at > cur.decided_at) latest.set(r.document_id, r)
  }

  // The matching tool's bills, per company (a bill number is unique only within one).
  const sapByEntity = new Map<string, SapBill[]>()
  if (opts.canSeePayments !== false) {
    const wanted = new Map<string, Set<string>>()
    for (const r of latest.values()) {
      const set = wanted.get(r.entity_id) ?? new Set<string>()
      for (const b of r.gate_documents.gate_bills ?? []) set.add(b.bill_no)
      wanted.set(r.entity_id, set)
    }
    for (const [entityId, set] of wanted) {
      const nos = [...set]
      const got: SapBill[] = []
      for (let i = 0; i < nos.length; i += IN_CHUNK) {
        const { data, error } = await db.from("service_invoices")
          .select("invoice_number, status, total_paise, allocated_paise")
          .eq("entity_id", entityId).in("invoice_number", nos.slice(i, i + IN_CHUNK))
        if (error) throw new Error(error.message)
        got.push(...(data ?? []))
      }
      sapByEntity.set(entityId, got)
    }
  }

  return [...latest.values()].map((r) => {
    const bills: UploadedBill[] = (r.gate_documents.gate_bills ?? []).map((b: UploadedBill) => ({ bill_no: b.bill_no, amount_paise: Number(b.amount_paise) }))
    return {
      release_id: r.id,
      document_id: r.document_id,
      entity_id: r.entity_id,
      regn_no: r.regn_no,
      released_at: r.decided_at,
      promised_by: r.promised_by ?? null,
      responsible_name: r.responsible?.full_name ?? null,
      approved_by_name: r.decider?.full_name ?? null,
      doc_no: r.gate_documents.doc_no,
      customer_name: r.gate_documents.customer_name,
      sap_customer_code: r.gate_documents.sap_customer_code,
      total_paise: Number(r.gate_documents.total_paise),
      bills,
      paid: paidState(bills, sapByEntity.get(r.entity_id) ?? []),
    }
  })
}
