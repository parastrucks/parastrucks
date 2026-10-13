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
  'received_at, payer_name, payer_remark, classification, awaiting_invoice, qr_ref, awaiting_since'
const INVOICE_COLS = 'id, entity_id, invoice_number, invoice_kind, job_ref, dealer_order_no, ' +
  'sap_billing_doc, invoice_date, customer_id, customer_name, vehicle_reg_no, payment_terms, ' +
  'total_paise, allocated_paise, open_paise, status, created_at'

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

/**
 * Matches that were undone for these payments — the bills a person already
 * said "not this one" about. Same read gate as the payments themselves
 * (payment_allocations_select), so service staff see their own UPI history.
 */
export async function fetchUndoneMatches(entityId, receiptIds) {
  const unique = [...new Set(receiptIds.filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await supabase
      .from('payment_allocations')
      .select('receipt_id, invoice_id, reversed_at, reverse_reason')
      .eq('entity_id', entityId)
      .eq('alloc_type', 'payment')
      .not('reversed_at', 'is', null)
      .in('receipt_id', unique.slice(i, i + 100))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * Matches made since `sinceIso` that still stand — the "Matched today" list.
 * `makerId` narrows it to one person's own (service staff); the screen groups
 * the rows per confirm (groupMatches). Paged: a busy week can pass 1,000.
 */
export function fetchMatchesSince(entityId, sinceIso, { makerId = null } = {}) {
  return fetchAllRows(() => {
    let q = supabase
      .from('payment_allocations')
      .select('id, client_request_id, receipt_id, invoice_id, amount_paise, allocated_at, allocated_by, ' +
        'export_batch_id, reversed_at, receipt:payment_receipts(payer_name, mode), ' +
        'invoice:service_invoices(invoice_number, customer_name), ' +
        'maker:users!payment_allocations_allocated_by_fkey(full_name)')
      .eq('entity_id', entityId)
      .eq('alloc_type', 'payment')
      .is('reversed_at', null)
      .gte('allocated_at', sinceIso)
    if (makerId) q = q.eq('allocated_by', makerId)
    return q.order('allocated_at', { ascending: false }).order('id')
  })
}

/**
 * A payer's other CASH already entered for one India day, in paise — for the
 * ₹2 lakh-a-day warning (section 269ST). The name is matched whole, ignoring
 * case; `%` and `_` are escaped so a name cannot act as a wildcard. Hand-typed
 * names drift ("Ramesh" / "Ramesh Patel"), which is why this warns, never
 * blocks.
 */
export async function fetchPayerCashOnDay(entityId, payerName, day) {
  const name = String(payerName ?? '').trim()
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return 0
  const from = new Date(`${day}T00:00:00+05:30`).toISOString()
  const to = new Date(Date.parse(from) + 86400000).toISOString()
  const { data, error } = await supabase
    .from('payment_receipts')
    .select('amount_paise')
    .eq('entity_id', entityId)
    .eq('mode', 'cash')
    .eq('status', 'active')
    .ilike('payer_name', name.replace(/[\\%_]/g, (c) => `\\${c}`))
    .gte('received_at', from)
    .lt('received_at', to)
  if (error) throw error
  return (data || []).reduce((a, r) => a + (r.amount_paise ?? 0), 0)
}

/** The standing allocations on one bill — what "Undo this match" on an Import clash reverses. */
export async function fetchAllocationsOnInvoice(entityId, invoiceId) {
  const { data, error } = await supabase
    .from('payment_allocations')
    .select('id, amount_paise, export_batch_id, allocated_by, reversed_at')
    .eq('entity_id', entityId)
    .eq('invoice_id', invoiceId)
    .is('reversed_at', null)
  if (error) throw error
  return data || []
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

/**
 * Every open bill of one job order — parts and labour are billed separately and
 * paid together, so a bill found by search may have a partner the payment
 * also covers. Capped: an order never has more than a handful of bills.
 */
export async function fetchOpenJobBills(entityId, jobRef) {
  if (!entityId || !jobRef) return []
  const { data, error } = await supabase
    .from('v_payments_open_invoices').select(INVOICE_COLS)
    .eq('entity_id', entityId).eq('job_ref', jobRef)
    .order('invoice_number').limit(25)
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

// ── Import ────────────────────────────────────────────────────────────────
// Back-office reads: the importer is accounts or the admin (authority.ts),
// and these tables are theirs to read under RLS.

export async function fetchOutlets(entityId) {
  const { data, error } = await supabase
    .from('outlets').select('id, city, label, is_active').eq('entity_id', entityId)
  if (error) throw error
  return data || []
}

/** A committed batch of the same kind with this exact file hash, if any. */
export async function findPriorBatch(entityId, kind, fileHash) {
  const { data, error } = await supabase
    .from('payment_import_batches').select('id, file_name, uploaded_at')
    .eq('entity_id', entityId).eq('kind', kind).eq('file_hash', fileHash)
    .eq('status', 'committed').limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * The stored bills this file's invoice numbers would land on, with each one's
 * customer code (embedded; unpacked by existingInvoiceFromRow, which is
 * tested). Chunked to keep URLs short.
 */
export async function fetchExistingInvoices(entityId, invoiceNumbers) {
  const unique = [...new Set(invoiceNumbers.filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase
      .from('service_invoices')
      .select('id, invoice_number, customer_name, total_paise, allocated_paise, status, cancelled_flag, customer:customers(sap_customer_code)')
      .eq('entity_id', entityId)
      .in('invoice_number', unique.slice(i, i + 150))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * Stored receipts sharing this file's transaction ids — from ANY source, so a
 * hand-keyed (source 'manual') copy of the same payment is seen.
 */
export async function fetchExistingReceiptsByTxn(entityId, txnIds) {
  const unique = [...new Set(txnIds.filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase
      .from('payment_receipts')
      .select('source, external_txn_id, normalized_utr, amount_paise, import_batch_id, status, receipt_serial')
      .eq('entity_id', entityId)
      .in('external_txn_id', unique.slice(i, i + 150))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/** Stored receipts holding any of these UTRs, whatever their source. */
export async function fetchExistingReceiptsByUtr(entityId, utrs) {
  const unique = [...new Set(utrs.filter(Boolean))]
  const out = []
  for (let i = 0; i < unique.length; i += 150) {
    const { data, error } = await supabase
      .from('payment_receipts')
      .select('source, external_txn_id, normalized_utr, amount_paise, import_batch_id, receipt_serial, status')
      .eq('entity_id', entityId)
      .in('normalized_utr', unique.slice(i, i + 150))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}
