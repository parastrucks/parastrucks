// Reads for the Match screen. Plain supabase-js under RLS — every row a person
// sees is one the database decided they may see. Writes never happen here;
// they go through the service-payments Edge Function (callEdge).
//
// Every list read pages through fetchAllRows: PostgREST caps a response at
// 1,000 rows and says nothing when it truncates, and a receipt that silently
// fails to load is a receipt nobody ever matches.

import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAll'

const RECEIPT_COLS = 'id, entity_id, mode, source, amount_paise, allocated_paise, open_paise, ' +
  'received_at, payer_name, payer_remark, classification, awaiting_invoice'
const INVOICE_COLS = 'id, entity_id, invoice_number, invoice_kind, job_ref, dealer_order_no, ' +
  'sap_billing_doc, invoice_date, customer_id, customer_name, vehicle_reg_no, payment_terms, ' +
  'total_paise, allocated_paise, open_paise, status'

/** Receipts with money still to place. */
export function fetchOpenReceipts(entityId) {
  return fetchAllRows(() => supabase
    .from('v_payments_open_receipts').select(RECEIPT_COLS)
    .eq('entity_id', entityId)
    .order('received_at', { ascending: true }).order('id'))
}

/** Open bills dated inside [from, to]. */
export function fetchOpenInvoices(entityId, { from, to }) {
  return fetchAllRows(() => supabase
    .from('v_payments_open_invoices').select(INVOICE_COLS)
    .eq('entity_id', entityId)
    .gte('invoice_date', from).lte('invoice_date', to)
    .order('invoice_date').order('id'))
}

/**
 * SAP customer codes for a set of customer ids, from the lite view (no GSTIN,
 * no PAN — service staff read this). Chunked: a week of bills can name a few
 * hundred customers, and a few hundred uuids in one URL is past what proxies
 * reliably accept.
 */
export async function fetchCustomerCodes(ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from('v_payments_customers_lite').select('id, sap_customer_code, display_name')
      .in('id', unique.slice(i, i + 100))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * What this payer has paid for before. Back-office RLS: a service executive
 * gets an empty list, not an error, and the matcher simply ranks without it.
 */
export async function fetchPayerMemory(entityId, names) {
  const unique = [...new Set(names.filter(Boolean))]
  if (!unique.length) return []
  const out = []
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from('payer_memory')
      .select('source, normalized_payer_name, customer_id, confirm_count, contradiction_count, last_confirmed_at')
      .eq('entity_id', entityId)
      .in('normalized_payer_name', unique.slice(i, i + 100))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/** When the bill feed last landed. Null when nothing has ever been imported. */
export async function fetchInvoiceFeed(entityId) {
  const { data, error } = await supabase
    .from('v_payments_feed_status').select('kind, last_uploaded_at, covered_until')
    .eq('entity_id', entityId).eq('kind', 'invoices').maybeSingle()
  if (error) throw error
  return data ?? null
}

/**
 * "Search all bills" — for the quarter of payments no shortlist catches.
 * Open bills only, newest first, capped: a search that returns 200 rows on a
 * phone has not helped anyone.
 */
export async function searchOpenInvoices(entityId, query, { limit = 20 } = {}) {
  let q = supabase.from('v_payments_open_invoices').select(INVOICE_COLS).eq('entity_id', entityId)
  if (query.kind === 'number') {
    // An amount may be what is owed now OR the bill's face value — and a bare
    // number may equally be a plate, bill or order fragment (parseSearch).
    const parts = [`open_paise.eq.${query.paise}`, `total_paise.eq.${query.paise}`]
    if (query.text) {
      parts.push(`invoice_number.ilike.*${query.text}*`, `vehicle_reg_no.ilike.*${query.text}*`,
        `job_ref.ilike.*${query.text}*`)
    }
    q = q.or(parts.join(','))
  } else {
    // Values double-quoted: names carry dots, slashes and spaces ("M/S. SHARMA"),
    // and inside or() those are syntax. parseSearch has already removed the
    // characters that could close a quote or widen a pattern.
    const t = query.text
    const plate = t.replace(/\s/g, '')
    q = q.or([
      `customer_name.ilike."*${t}*"`,
      `invoice_number.ilike."*${t}*"`,
      `vehicle_reg_no.ilike."*${plate}*"`,
      `job_ref.ilike."*${t}*"`,
    ].join(','))
  }
  const { data, error } = await q
    .order('invoice_date', { ascending: false }).order('id').limit(limit)
  if (error) throw error
  return data || []
}

/** The caller's department code — the payments ladder is department first. */
export async function fetchDepartmentCode(departmentId) {
  if (!departmentId) return null
  const { data, error } = await supabase
    .from('departments').select('code').eq('id', departmentId).maybeSingle()
  if (error) throw error
  return data?.code ?? null
}

/**
 * The entity this screen works in. v1 is PTB only (owner). Everyone with page
 * access is PTB staff; the admin has no entity of their own (prod) or may be
 * filed elsewhere (staging), so the entity is named, never inferred.
 */
export async function fetchPaymentsEntityId() {
  const { data, error } = await supabase
    .from('entities').select('id').eq('code', 'PTB').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('PTB entity not found')
  return data.id
}
