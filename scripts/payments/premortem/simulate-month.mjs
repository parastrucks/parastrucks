// Pre-mortem Track B: live the first month.
//
//   node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs [--days 30] [--seed 7] [--json out.json]
//
// Thirty calendar days of the routine, driven through the REAL pure modules
// (parsers, importPlan, matcher, matchQueue) and the REAL RPCs on the Track A
// rehearsal database. Files are built in the demo generator's own shapes
// (make-demo-files.mjs: billingReportAoa, hdfcAoa, xlsxBytes).
//
// WHAT IS REAL: every parse, gate, preview, import, allocation, reversal and
// "bill not raised yet" goes through the shipped code. WHAT IS MODELLED (and
// printed as such): the shape of the workshop's days — bill counts and amounts,
// who pays when, how often a person skips or picks wrong. Those knobs sit in
// MODEL below with the plan's measured figures where the plan has one, and a
// stated assumption where it does not.
//
// The simulation knows the truth (which bill each payment really paid) and
// scores the month against it: misplaced money, double counts, lost payments,
// bank tie-out per day, queues that never fall, waiting payments that never
// return, and labels that were false when shown.

import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { openRehearsalDb } from './rehearse-db.mjs'
import { STUB_USERS } from './seed-load.mjs'
import { billingReportAoa, hdfcAoa, xlsxBytes, hdfcTxnId, hdfcRrn } from '../make-demo-files.mjs'
import { parseImportFile, importGates, diffInvoices, diffReceipts, billCoverage, rowsToCommit, existingInvoiceFromRow } from '../../../src/service-payments/lib/importPlan.js'
import { parseBillingReport } from '../../../src/service-payments/lib/parseBillingReport.js'
import { parseBharatPe, parseGpay } from '../../../src/service-payments/lib/parseUpi.js'
import { parseHdfcSmartHub } from '../../../src/service-payments/lib/parseHdfc.js'
import { buildCandidateIndex, matchCandidates, DEFAULT_WINDOW_DAYS } from '../../../src/service-payments/lib/matchCandidates.js'
import { toMatchReceipt, orderQueue, invoiceWindow, windowDaysFor, splitWaiting, allocationTargets, matchSignalOf, feedIsStaleFor, attachCustomerCodes, searchPickCandidates } from '../../../src/service-payments/lib/matchQueue.js'
import { istDateOf } from '../../../src/service-payments/lib/dates.js'

const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const DAYS = Number(arg('--days', 30))
const SEED = Number(arg('--seed', 7))
const JSON_OUT = arg('--json', null)
const START = '2026-10-13'          // the Tuesday after the planned go-live

// ── MODEL ────────────────────────────────────────────────────────────────
// [plan] = measured in docs/backlog/service-payments-plan.md; [assumed] = ours.
const MODEL = {
  billsPerDay: 37,                 // [plan] ~37 payable bills/day
  upiPerDay: 18,                   // [plan] ~18 UPI receipts/day
  jobSplitShare: 0.53,             // [plan] 53% of jobs bill as parts + labour
  defShare: 0.11,                  // [plan] 114 of 1,045 payable bills were ₹1,930 DEF
  counterShare: 0.36,              // [plan] MPI+MCI = 378 of 1,045
  focShare: 0.027, returnShare: 0.011,  // [plan] 28 FOC, 12 MPR of 1,085
  paidOutsideUpi: 0.50,            // [assumed] half the bills are settled by cash/cheque/bank, never a UPI row
  lag: { same: 0.60, next: 0.25, late: 0.10, advance: 0.05 },  // [assumed] when UPI arrives vs the bill
  lateDaysMax: 6, advanceDaysMax: 7,
  partPayShare: 0.05,              // [assumed]
  payerIsFirm: 0.65,               // [assumed] 65% of payer names are the customer's; the rest a driver/owner
  failedAttemptShare: 0.03,        // [plan] 3 of 18 rows on the first real report; retried same day
  wrongPickRate: 0.03,             // [assumed] the person confirms a wrong candidate 3% of the time
  reverseWrongAfterDays: 3,        // [assumed] half of wrong picks are caught and reversed (by RPC: the UI has no reverse)
  sundaysOff: true, holiday: 12,   // [assumed] one holiday (day index), no bills, no file next morning
}
// Amounts: a few hot prices (DEF ₹1,930, common counter items) plus bills that
// are sums of MRPs and land on odd rupees. Tuned so the share of a day's bills
// that share an amount with another bill that day is ~24% (the plan measured
// 76% amount-unique) — printed as world.sameDayAmountCollisionShare.
const HOT_COUNTER = [1930, 745, 845, 1250, 2150, 2990, 3400, 4800]
const counterAmount = () => chance(0.3) ? pick(HOT_COUNTER) : Math.round(200 + Math.pow(rnd(), 2) * 11800)
const jobAmount = () => Math.round(1500 + Math.pow(rnd(), 2.2) * 88500)
const LABOUR = [2400, 3200, 4800, 5500]
const FIRST = ['ASHA', 'BHAVIN', 'CHIRAG', 'DHRUVI', 'EKTA', 'FLEET', 'GANGA', 'HARSH', 'INDU', 'JAY', 'KAVYA', 'LALIT', 'MANAN', 'NEEL', 'OM', 'PRIYA', 'QUICK', 'RAMESH', 'SURESH', 'TANVI', 'UDAY', 'VIKAS', 'YASH', 'ZEEL', 'KISAN', 'MEHUL', 'NIRAV', 'JAYESH']
const KIND = ['ENTERPRISE', 'TRADING', 'AUTO', 'MOTORS', 'LOGISTICS', 'CARRIERS', 'TRADERS', 'TYRES', 'SPARES', 'BATTERIES', 'TRANSPORT', 'CARGO', 'ROADLINES', 'BUILDERS', 'FREIGHT', 'SHARMA', 'PATEL', 'SHAH', 'DESAI']

// ── deterministic randomness ─────────────────────────────────────────────
let s = SEED >>> 0
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const chance = (p) => rnd() < p
const poisson = (mean) => { let L = Math.exp(-mean), k = 0, p = 1; do { k++; p *= rnd() } while (p > L); return k - 1 }

// ── calendar ─────────────────────────────────────────────────────────────
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()   // 0 = Sunday
const istInstant = (iso, hhmm) => new Date(`${iso}T${hhmm}:00+05:30`).toISOString()

// ── the world ────────────────────────────────────────────────────────────
const customers = Array.from({ length: 300 }, (_, i) => ({
  code: `0099${String(100000 + i)}`,
  name: `DEMO ${pick(FIRST)} ${pick(KIND)}${chance(0.3) ? ' ' + pick(KIND) : ''}`,
  reg: `GJ${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}DM${String(1000 + Math.floor(rnd() * 9000))}`,
  payer: null,
}))
for (const c of customers) c.payer = chance(MODEL.payerIsFirm) ? c.name : `${pick(FIRST)} ${pick(['PATEL', 'SHAH', 'SHARMA', 'DESAI', 'YADAV', 'SINGH'])}`

let serial = 10000, jobSerial = 7009000100, txnN = 100
const bills = []       // truth: every bill ever issued, in order
const payments = []    // truth: every UPI row, with the bill(s) it really pays
const makeBill = (prefix, plant, day, rupees, cust, o = {}) => {
  const total = Math.round(rupees * 100), net = Math.round(total / 1.18)
  const b = { prefix, plant, day, total, net, tax: total - net, cust: cust.name, code: cust.code,
    number: `${prefix}${plant}26000${++serial}`, reg: o.reg ?? '', job: o.job ?? '', cancelled: '', customer: cust }
  bills.push(b); return b
}
function issueBills(day) {
  const n = poisson(MODEL.billsPerDay)
  const out = []
  for (let i = 0; i < n; i++) {
    const c = pick(customers), plant = chance(0.6) ? '5756' : '6370'
    const r = rnd()
    if (r < MODEL.focShare) { out.push(makeBill('PEI', plant, day, pick([1500, 2000, 3000]), c, { reg: c.reg, job: String(++jobSerial) })); continue }
    if (r < MODEL.focShare + MODEL.returnShare) { out.push(makeBill('MPR', plant, day, pick([600, 1200]), c)); continue }
    if (r < MODEL.focShare + MODEL.returnShare + MODEL.defShare) { out.push(makeBill('MPI', plant, day, 1930, c)); continue }
    if (r < MODEL.focShare + MODEL.returnShare + MODEL.counterShare) {
      out.push(makeBill(chance(0.85) ? 'MPI' : 'MCI', plant, day, counterAmount(), c)); continue
    }
    const job = String(++jobSerial), cash = chance(0.65)
    const parts = makeBill(cash ? 'PCS' : 'PCR', plant, day, jobAmount(), c, { reg: c.reg, job })
    out.push(parts)
    if (chance(MODEL.jobSplitShare)) out.push(makeBill(cash ? 'LCS' : 'LCR', plant, day, pick(LABOUR), c, { reg: c.reg, job }))
  }
  return out
}
// Decide, for each new payable bill/job, whether and when UPI pays it.
function schedulePayments(dayBills) {
  const jobs = new Map()
  for (const b of dayBills) { if (!['PEI', 'MPR'].includes(b.prefix)) { const k = b.job || b.number; if (!jobs.has(k)) jobs.set(k, []); jobs.get(k).push(b) } }
  for (const [, group] of jobs) {
    if (chance(MODEL.paidOutsideUpi)) continue
    const total = group.reduce((a, b) => a + b.total, 0)
    const r = rnd(); let offset
    if (r < MODEL.lag.same) offset = 0
    else if (r < MODEL.lag.same + MODEL.lag.next) offset = 1
    else if (r < MODEL.lag.same + MODEL.lag.next + MODEL.lag.late) offset = 2 + Math.floor(rnd() * (MODEL.lateDaysMax - 1))
    else offset = -(1 + Math.floor(rnd() * MODEL.advanceDaysMax))
    let payDay = addDays(group[0].day, offset)
    if (payDay < START) payDay = START   // the world starts at go-live; nothing was paid before it
    const payer = group[0].customer.payer
    const hhmm = `${String(9 + Math.floor(rnd() * 10)).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`
    if (chance(MODEL.partPayShare) && total > 500000) {
      const first = Math.round(total * (0.4 + rnd() * 0.2) / 100) * 100
      payments.push({ n: ++txnN, rupees: first / 100, payer, day: payDay, hhmm, state: 'SaleSuccess', pays: group, part: 'first' })
      payments.push({ n: ++txnN, rupees: (total - first) / 100, payer, day: addDays(payDay, 2 + Math.floor(rnd() * 5)), hhmm, state: 'SaleSuccess', pays: group, part: 'rest' })
    } else {
      if (chance(MODEL.failedAttemptShare)) payments.push({ n: ++txnN, rupees: total / 100, payer, day: payDay, hhmm, state: 'SaleFailed', pays: [] })
      payments.push({ n: ++txnN, rupees: total / 100, payer, day: payDay, hhmm, state: 'SaleSuccess', pays: group, advance: offset < 0 })
    }
  }
}

// ── the database side ────────────────────────────────────────────────────
const { db } = await openRehearsalDb({ quiet: true })
const ENTITY = (await db.query(`select id from public.entities where code='PTB'`)).rows[0].id
const ACCT = STUB_USERS.find((u) => u.username === 'zz.acct').id
const SVC = STUB_USERS.find((u) => u.username === 'zz.svc').id
const OUTLETS = (await db.query(`select id, city, label, is_active from public.outlets where entity_id = $1`, [ENTITY])).rows
const parsers = { parseBillingReport, parseBharatPe, parseGpay, parseHdfcSmartHub }
const rpc = async (fn, params) => (await db.query(`select public.${fn}(${params.map((_, i) => `$${i + 1}`).join(',')}) as r`, params)).rows[0].r
const asFile = (name, bytes) => ({ name, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

async function importBillingReport(rows, { name, mtimeIso, log }) {
  const { kind, hash, parsed } = await parseImportFile(asFile(name, xlsxBytes(billingReportAoa(rows))), { XLSX, parsers, entityId: ENTITY, outlets: OUTLETS })
  const prior = (await db.query(`select id, file_name, uploaded_at from public.payment_import_batches where entity_id=$1 and kind='invoices' and file_hash=$2 and status='committed' limit 1`, [ENTITY, hash])).rows[0] ?? null
  const existingRows = (await db.query(`select i.invoice_number, i.customer_name, i.total_paise, i.allocated_paise, i.status, i.cancelled_flag, json_build_object('sap_customer_code', c.sap_customer_code) as customer from public.service_invoices i left join public.customers c on c.id = i.customer_id where i.entity_id=$1 and i.invoice_number = any($2)`, [ENTITY, parsed.invoices.map((v) => v.invoice_number)])).rows
  const diff = diffInvoices(parsed.invoices, existingRows.map(existingInvoiceFromRow))
  const gates = importGates({ kind, parsed, diff, priorBatch: prior })
  if (!gates.ok) { log.push({ import: 'bills', blocked: gates.blocking }); return { blocked: gates.blocking, diff } }
  const coverage = billCoverage(parsed.invoices, Date.parse(mtimeIso))
  const res = await rpc('payments_import_invoices', [ENTITY, JSON.stringify(rowsToCommit(kind, parsed, diff)),
    JSON.stringify({ source: 'billing_report', file_name: name, file_hash: hash, parser_version: parsed.parser_version, source_pulled_at: coverage }), ACCT])
  log.push({ import: 'bills', file: name, preview: { new: diff.new.length, amended: diff.amended.length, conflict: diff.conflict.length }, server: { new: res.new, amended: res.amended, conflicts: res.conflicts?.length ?? 0 }, refused: parsed.refused.length })
  return { res, diff, coverage }
}
async function importHdfc(rows, { name, log }) {
  const { kind, hash, parsed } = await parseImportFile(asFile(name, xlsxBytes(hdfcAoa(rows))), { XLSX, parsers, entityId: ENTITY, outlets: OUTLETS })
  const prior = (await db.query(`select id from public.payment_import_batches where entity_id=$1 and kind='receipts' and file_hash=$2 and status='committed' limit 1`, [ENTITY, hash])).rows[0] ?? null
  const ids = parsed.receipts.map((r) => r.external_txn_id), utrs = parsed.receipts.map((r) => r.normalized_utr).filter(Boolean)
  const byTxn = (await db.query(`select source, external_txn_id, normalized_utr, amount_paise, import_batch_id, status, receipt_serial from public.payment_receipts where entity_id=$1 and external_txn_id = any($2)`, [ENTITY, [...ids, ...utrs]])).rows
  const byUtr = (await db.query(`select source, external_txn_id, normalized_utr, amount_paise, import_batch_id, status, receipt_serial from public.payment_receipts where entity_id=$1 and normalized_utr = any($2)`, [ENTITY, utrs])).rows
  const diff = diffReceipts(parsed.receipts, byTxn, byUtr)
  const gates = importGates({ kind, parsed, diff, priorBatch: prior })
  if (!gates.ok) { log.push({ import: 'hdfc', blocked: gates.blocking }); return { blocked: gates.blocking } }
  const res = await rpc('payments_import_receipts', [ENTITY, JSON.stringify(rowsToCommit(kind, parsed, diff)),
    JSON.stringify({ source: 'hdfc', file_name: name, file_hash: hash, parser_version: parsed.parser_version }), ACCT])
  log.push({ import: 'hdfc', file: name, preview: { new: diff.new.length, already: diff.already.length, held: diff.held.length }, server: { new: res.new, already: res.already_present, held: res.held?.length ?? 0 }, failedAttempts: parsed.summary.failed_attempts, dayTotals: parsed.summary.settles_by_day_paise })
  return { res, parsed }
}

// The Match screen's morning, as PaymentsPage.load() + the person's taps.
async function matchSession(today, who, log, stats) {
  // The page reads under RLS as the signed-in person. Session-level (not
  // transaction-local) because each read below is its own statement.
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
  try { return await matchSessionAs(today, who, log, stats) }
  finally { await db.query(`SELECT set_config('request.jwt.claims', '', false)`) }
}

async function matchSessionAs(today, who, log, stats) {
  // One load = what PaymentsPage.load() reads. The page reloads after every
  // Confirm / mark, so the loop below is: load, act on the first workable
  // payment not yet handled, reload. A skip moves on without a reload (the
  // page keeps its lists), exactly as the screen does.
  async function loadState() {
    const open = (await db.query(`select id, entity_id, mode, source, amount_paise, allocated_paise, open_paise, received_at, payer_name, payer_remark, classification, awaiting_invoice, qr_ref, awaiting_since from public.v_payments_open_receipts where entity_id=$1 order by received_at, id`, [ENTITY])).rows
      .map((r) => ({ ...r, received_at: new Date(r.received_at).toISOString(), awaiting_since: r.awaiting_since ? new Date(r.awaiting_since).toISOString() : null, amount_paise: Number(r.amount_paise), allocated_paise: Number(r.allocated_paise), open_paise: Number(r.open_paise) }))
    // Same read as PaymentsPage.load(): the definer view, invoices row only.
    const feed = (await db.query(`select kind, last_uploaded_at, covered_until from public.v_payments_feed_status where entity_id=$1 and kind='invoices'`, [ENTITY])).rows[0]
    const feedRow = feed ? { covered_until: new Date(feed.covered_until).toISOString() } : null
    const workable = open.map(toMatchReceipt)
    const win = invoiceWindow(workable, DEFAULT_WINDOW_DAYS, { today })
    const invoices = win ? (await db.query(`select i.id, i.entity_id, i.invoice_number, i.invoice_kind, i.job_ref, i.dealer_order_no, i.sap_billing_doc, i.invoice_date::text, i.customer_id, i.customer_name, i.vehicle_reg_no, i.payment_terms, i.total_paise, i.allocated_paise, i.open_paise, i.status, i.created_at, c.sap_customer_code from public.v_payments_open_invoices i left join public.customers c on c.id=i.customer_id where i.entity_id=$1 and i.invoice_date between $2 and $3 order by i.invoice_date, i.id`, [ENTITY, win.from, win.to])).rows
      .map((v) => ({ ...v, total_paise: Number(v.total_paise), allocated_paise: Number(v.allocated_paise), open_paise: Number(v.open_paise), created_at: new Date(v.created_at).toISOString() })) : []
    const index = buildCandidateIndex(invoices)
    const invoicesById = new Map(invoices.map((v) => [v.id, v]))
    const { queue, waiting } = splitWaiting(workable, (r) => matchCandidates(r, index, { windowDays: windowDaysFor(r, today, DEFAULT_WINDOW_DAYS) }).candidates, invoicesById)
    // scoring only (the page never sees this): receipt id -> HDFC txn id
    const txnOf = new Map((await db.query(`select id, external_txn_id from public.payment_receipts where entity_id=$1 and status='active'`, [ENTITY])).rows.map((x) => [x.id, x.external_txn_id]))
    return { feedRow, index, invoicesById, queue, waiting, txnOf }
  }
  const handled = new Set()
  let confirms = 0, skips = 0, marks = 0, searches = 0, staleBlocked = 0, reloads = 0
  let first = null
  for (;;) {
    const st = await loadState(); reloads++
    if (!first) { first = st; stats.waitingAtStart = st.waiting.length }
    const { feedRow, index, invoicesById, txnOf } = st
    const r = orderQueue(st.queue, []).find((x) => !handled.has(x.id))
    if (!r) break
    handled.add(r.id)
    // a bill already reversed OFF this payment, offered to it again (nothing remembers the rejection)
    const rejected = stats.reversedFrom.get(r.id)
    if (rejected) for (const c of (matchCandidates(r, index, { windowDays: windowDaysFor(r, today, DEFAULT_WINDOW_DAYS) }).candidates)) {
      if (c.invoice_ids.some((id) => rejected.has(id))) { stats.reofferedAfterReversal++; if (c.signals.some((x) => x.signal === 'amount_unique')) stats.reofferedConfident++; break }
    }
    const txn = txnOf.get(r.id)
    const truth = payments.find((p) => hdfcTxnId(p.n) === txn) ?? null
    const stale = feedIsStaleFor(r, feedRow)
    const result = matchCandidates(r, index, { feedIsStale: stale, windowDays: windowDaysFor(r, today, DEFAULT_WINDOW_DAYS) })
    if (stale) { staleBlocked++; continue }
    // the false-label check: "only bill at this exact amount" while another
    // OPEN bill anywhere has the same open amount
    for (const c of result.candidates) {
      if (c.signals.some((x) => x.signal === 'amount_unique')) {
        const others = (await db.query(`select count(*)::int as n from public.v_payments_open_invoices where entity_id=$1 and open_paise=$2`, [ENTITY, c.amount_paise])).rows[0].n
        if (others > 1) stats.falseUnique++
      }
    }
    let choice = null, deliberate = false
    if (result.candidates.length) {
      const top = result.candidates[0]
      const byName = result.candidates.find((c) => c.signals.some((x) => x.signal === 'name_overlap_strong' || /same$/.test(x.detail ?? '')))
      // A careful layman: confirm only when the money equals what the pick is
      // owed (red team 4 found nobody could say what a part payment does).
      const fits = (c) => c && c.amount_paise === r.amount_paise
      if (result.confident) choice = top
      else if (fits(byName)) choice = byName
      else if (fits(top) && !result.refuse_to_rank && chance(0.7)) choice = top
      if (choice && result.candidates.length > 1 && chance(MODEL.wrongPickRate)) { choice = result.candidates.find((c) => c !== choice) ?? choice; deliberate = true }
    } else {
      searches++
      // "Search all bills", as searchOpenInvoices() does it: first the amount
      // (owed now OR face value), then the payer's name; open bills, newest
      // first, 20 at most. A hit is offered through searchPickCandidates, so a
      // parts bill brings its labour partner.
      const norm = (rows) => rows.map((v) => ({ ...v, total_paise: Number(v.total_paise), allocated_paise: Number(v.allocated_paise), open_paise: Number(v.open_paise) }))
      let hits = norm((await db.query(`select i.*, i.invoice_date::text as invoice_date, c.sap_customer_code from public.v_payments_open_invoices i left join public.customers c on c.id=i.customer_id where i.entity_id=$1 and (i.open_paise=$2 or i.total_paise=$2) order by i.invoice_date desc, i.id limit 20`, [ENTITY, r.amount_paise])).rows)
      let how = 'amount'
      if (!hits.length) {
        const token = String(r.payer_name ?? '').split(/\s+/).filter((w) => w.length > 2 && w !== 'DEMO')[0] ?? ''
        hits = token ? norm((await db.query(`select i.*, i.invoice_date::text as invoice_date, c.sap_customer_code from public.v_payments_open_invoices i left join public.customers c on c.id=i.customer_id where i.entity_id=$1 and i.customer_name ilike $2 order by i.invoice_date desc, i.id limit 20`, [ENTITY, '%' + token + '%'])).rows) : []
        how = 'name'
      }
      if (hits.length) {
        // the person picks: an exact-amount hit, else (by name) the newest bill
        // whose order sums to the money, else the newest hit if it is the only customer
        let picked = hits.find((v) => v.open_paise === r.amount_paise || v.total_paise === r.amount_paise) ?? null
        if (!picked && how === 'name') {
          const customersHit = new Set(hits.map((v) => v.customer_id))
          if (customersHit.size === 1) picked = hits[0]
        }
        if (picked) {
          const orderBills = picked.job_ref ? norm((await db.query(`select i.*, i.invoice_date::text as invoice_date from public.v_payments_open_invoices i where i.entity_id=$1 and i.job_ref=$2`, [ENTITY, picked.job_ref])).rows) : []
          for (const v of [picked, ...orderBills]) invoicesById.set(v.id, v)
          const cands = searchPickCandidates(picked, orderBills, r.amount_paise)
          choice = cands[0]
          stats.foundBySearch++
          stats.searchHow[how] = (stats.searchHow[how] || 0) + 1
        }
      }
      if (!choice && !hits.length && !r.awaiting_invoice && chance(0.5)) {
        await rpc('payments_set_awaiting_invoice', [ENTITY, r.id, true, who]); marks++; continue
      }
    }
    if (!choice) { skips++; continue }
    let targets
    try { targets = allocationTargets(choice, invoicesById, r.amount_paise) } catch { skips++; continue }
    const res = await rpc('payments_allocate', [ENTITY, r.id, JSON.stringify(targets), who, crypto.randomUUID(), matchSignalOf(choice)])
    confirms++
    // score against truth
    const trueNumbers = new Set((truth?.pays ?? []).map((b) => b.number))
    for (const a of res.allocations) {
      const num = invoicesById.get(a.invoice_id)?.invoice_number
      if (!trueNumbers.has(num)) {
        // was the true bill in the database when the person confirmed?
        const inDb = trueNumbers.size ? (await db.query(`select invoice_number, invoice_date::text as d, status, open_paise from public.v_payments_open_invoices where entity_id=$1 and invoice_number = any($2)`, [ENTITY, [...trueNumbers]])).rows : []
        stats.misplaced.push({ day: today, txn, paise: Number(a.amount_paise), placedOn: num, trulyFor: [...trueNumbers], trueBillsOpenInDb: inDb.map((x) => x.d), trueBillDays: (truth?.pays ?? []).map((b) => b.day), receiptDay: truth?.day ?? null, signal: matchSignalOf(choice), deliberate, confident: !!result.confident, allocation_id: a.allocation_id })
      }
    }
  }
  log.push({ match: { who: who === SVC ? 'service' : 'accounts', queue: first.queue.length, waiting: first.waiting.length, confirms, skips, marks, searches, staleBlocked, reloads } })
}

// ── run the month ────────────────────────────────────────────────────────
const stats = { misplaced: [], falseUnique: 0, foundBySearch: 0, searchHow: {}, days: [], timings: [], reversedFrom: new Map(), reofferedAfterReversal: 0, reofferedConfident: 0 }
const sentTxns = new Set()            // every HDFC row that went into any file
const timeline = []
let pendingBills = []                 // bills issued on days not yet exported
const holidayDay = addDays(START, MODEL.holiday)
// --backlog N: N working days of bills BEFORE go-live, all paid outside UPI,
// arriving in the first Billing Report (the real first import is a month's
// report, ~1,085 rows). Times that import.
const BACKLOG = args.includes('--backlog') ? Number(args[args.indexOf('--backlog') + 1]) : 0
for (let k = BACKLOG; k >= 1; k--) { const day = addDays(START, -k); if (!(MODEL.sundaysOff && dow(day) === 0)) issueBills(day) }
// The whole month is generated BEFORE it is lived, so an advance payment made
// on the 16th for a bill raised on the 20th exists on the 16th (when it was
// generated on the 20th, the 17th's HDFC file had already been made without it).
const worldByDay = new Map()
for (let d = 0; d < DAYS; d++) {
  const day = addDays(START, d)
  if (!(MODEL.sundaysOff && dow(day) === 0) && day !== holidayDay) { const issued = issueBills(day); schedulePayments(issued); worldByDay.set(day, issued) }
}
// --export mtd | delta — what date range accounts exports from SAP each morning.
// 'delta' = only days not yet exported (a cancellation or amendment of an older
// bill then NEVER reaches the portal); 'mtd' = the last 31 days every time, so
// changes travel. [assumed — owner question; the plan does not say]
const EXPORT = args.includes('--export') ? args[args.indexOf('--export') + 1] : 'mtd'
let lastExportedThrough = null
let lastHdfcThrough = null
for (let d = 0; d < DAYS; d++) {
  const today = addDays(START, d)
  const yesterday = addDays(today, -1)
  const log = []
  const dayStats = { day: today, dow: dow(today) }

  // Morning: accounts exports yesterday's bills (if the workshop worked) and imports them,
  // then the HDFC report for yesterday + this morning so far.
  const workedYesterday = !(MODEL.sundaysOff && dow(yesterday) === 0) && yesterday !== holidayDay
  if (d > 0 && today !== holidayDay) {
    if (workedYesterday || pendingBills.length) {
      // SAP export = every bill not yet exported, re-exported with any later changes
      const since = EXPORT === 'mtd' ? addDays(yesterday, -31) : (lastExportedThrough ? addDays(lastExportedThrough, 1) : addDays(START, -BACKLOG))
      const exportRows = bills.filter((b) => b.day >= since && b.day <= yesterday && b.day >= addDays(START, -BACKLOG))
      // month-end shape: on day 20 SAP re-exports the last 10 days with changes (delta mode only)
      const reExport = (EXPORT === 'delta' && d === 20) ? bills.filter((b) => b.day >= addDays(yesterday, -10) && b.day <= yesterday) : exportRows
      if (reExport.length) {
        const t0 = Date.now()
        const r = await importBillingReport(reExport, { name: `Billing Report ${today}.xlsx`, mtimeIso: istInstant(today, '09:00'), log })
        stats.timings.push({ day: today, rows: reExport.length, ms: Date.now() - t0 })
        if (!r.blocked) lastExportedThrough = yesterday
      }
      pendingBills = []
    }
    // HDFC: the report is pulled for a date range — every day since the one
    // before the last pull (so files OVERLAP by a day, by design) up to this
    // morning's rows before 09:30. Covers Sundays and the day before a holiday.
    const hdfcFrom = lastHdfcThrough ? addDays(lastHdfcThrough, -1) : START
    const hdfcRows = payments.filter((p) => (p.day >= hdfcFrom && p.day <= yesterday) || (p.day === today && p.hhmm < '09:30'))
    if (hdfcRows.length) await importHdfc(hdfcRows, { name: `Transaction_report_${today}.xlsx`, log })
    for (const p of hdfcRows) sentTxns.add(hdfcTxnId(p.n))
    lastHdfcThrough = yesterday
    // The same file, sent again by mistake (day 9): must be blocked by hash.
    if (d === 9 && hdfcRows.length) await importHdfc(hdfcRows, { name: `Transaction_report_${today} (1).xlsx`, log })
    // Then the morning session: service first, then accounts clears the tail.
    await matchSession(today, SVC, log, stats)
    await matchSession(today, ACCT, log, stats)
    // Some wrong picks get noticed and reversed a few days later (by RPC —
    // there is no reverse in the UI, so this is optimistic by construction).
    for (const m of stats.misplaced.filter((m) => !m.reversed && !m.kept && addDays(m.day, MODEL.reverseWrongAfterDays) <= today)) {
      if (chance(0.5)) {
        await rpc('payments_reverse_allocation', [m.allocation_id, ACCT, 'premortem: wrong bill']); m.reversed = today
        const rid = (await db.query(`select receipt_id, invoice_id from public.payment_allocations where id=$1`, [m.allocation_id])).rows[0]
        if (rid) { if (!stats.reversedFrom.has(rid.receipt_id)) stats.reversedFrom.set(rid.receipt_id, new Set()); stats.reversedFrom.get(rid.receipt_id).add(rid.invoice_id) }
      } else m.kept = true
    }
  }

  // The day's business
  const works = !(MODEL.sundaysOff && dow(today) === 0) && today !== holidayDay
  if (works) {
    const issued = worldByDay.get(today) ?? []
    // month-end events on day 18: SAP cancels one paid bill and one unpaid, amends one paid bill upward
    if (d === 18) {
      const paid = bills.find((b) => b.prefix === 'MPI' && b.day < today && payments.some((p) => p.pays.includes(b) && p.day < today))
      if (paid) { paid.cancelled = 'X'; log.push({ event: 'SAP cancelled a bill that UPI already paid', bill: paid.number }) }
      const unpaid = bills.find((b) => b.prefix === 'MPI' && b.day < today && !payments.some((p) => p.pays.includes(b)))
      if (unpaid) { unpaid.cancelled = 'X'; log.push({ event: 'SAP cancelled an unpaid bill', bill: unpaid.number }) }
      const amend = bills.find((b) => b.prefix === 'MCI' && b.day < today && payments.some((p) => p.pays.includes(b) && p.day < today))
      if (amend) { amend.total += 10000; amend.net = Math.round(amend.total / 1.18); amend.tax = amend.total - amend.net; log.push({ event: 'SAP amended a paid bill +₹100', bill: amend.number }) }
    }
    pendingBills.push(...issued)
  }
  // odd payments: a ₹1 test on day 3; a 23:50 and a 00:10 pair on day 6; a Sunday payment
  if (d === 3) payments.push({ n: ++txnN, rupees: 1, payer: 'TEST PAYER', day: today, hhmm: '11:00', state: 'SaleSuccess', pays: [] })
  if (d === 6) {
    const late = bills.filter((b) => b.day === today && b.prefix === 'MPI' && !payments.some((p) => p.pays.includes(b)))
    if (late[0]) payments.push({ n: ++txnN, rupees: late[0].total / 100, payer: late[0].customer.payer, day: today, hhmm: '23:50', state: 'SaleSuccess', pays: [late[0]] })
    if (late[1]) payments.push({ n: ++txnN, rupees: late[1].total / 100, payer: late[1].customer.payer, day: addDays(today, 1), hhmm: '00:10', state: 'SaleSuccess', pays: [late[1]] })
  }

  // End of day: measure
  const q = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].n)
  dayStats.openReceipts = await q(`select count(*) as n from public.v_payments_open_receipts where entity_id=$1`, [ENTITY])
  dayStats.waitingReceipts = await q(`select count(*) as n from public.v_payments_open_receipts where entity_id=$1 and awaiting_invoice`, [ENTITY])
  dayStats.openInvoices = await q(`select count(*) as n from public.v_payments_open_invoices where entity_id=$1`, [ENTITY])
  dayStats.openInvoicePaise = await q(`select coalesce(sum(open_paise),0) as n from public.v_payments_open_invoices where entity_id=$1`, [ENTITY])
  dayStats.receipts = await q(`select count(*) as n from public.payment_receipts where entity_id=$1 and status='active'`, [ENTITY])
  dayStats.receiptPaise = await q(`select coalesce(sum(amount_paise),0) as n from public.payment_receipts where entity_id=$1 and status='active'`, [ENTITY])
  dayStats.drift = await q(`select count(*) as n from (select i.id from public.service_invoices i left join (select invoice_id, sum(amount_paise) s from public.payment_allocations where reversed_at is null and invoice_id is not null group by invoice_id) a on a.invoice_id=i.id where i.allocated_paise <> coalesce(a.s,0) union all select r.id from public.payment_receipts r left join (select receipt_id, sum(amount_paise) s from public.payment_allocations where reversed_at is null and receipt_id is not null group by receipt_id) a on a.receipt_id=r.id where r.allocated_paise <> coalesce(a.s,0)) d`)
  timeline.push({ ...dayStats, log })
  stats.days.push(dayStats)
}

// ── the month, scored ────────────────────────────────────────────────────
const successes = payments.filter((p) => p.state === 'SaleSuccess' && p.day <= addDays(START, DAYS - 1))
const importedIds = new Set((await db.query(`select external_txn_id from public.payment_receipts where entity_id=$1 and status='active'`, [ENTITY])).rows.map((r) => r.external_txn_id))
const lost = successes.filter((p) => p.day < addDays(START, DAYS - 1) && !importedIds.has(hdfcTxnId(p.n)))
const dupes = Number((await db.query(`select count(*)::int as n from (select external_txn_id from public.payment_receipts where entity_id=$1 and status='active' group by external_txn_id having count(*)>1) d`, [ENTITY])).rows[0].n)
const trulyPaidNumbers = new Set(successes.flatMap((p) => p.pays.map((b) => b.number)))
const openInv = (await db.query(`select invoice_number, open_paise, invoice_date::text from public.v_payments_open_invoices where entity_id=$1`, [ENTITY])).rows
const openButTrulyPaid = openInv.filter((v) => trulyPaidNumbers.has(v.invoice_number))
const openNeverUpi = openInv.filter((v) => !trulyPaidNumbers.has(v.invoice_number))
const waitingNow = (await db.query(`select p.external_txn_id, r.amount_paise, r.awaiting_since, r.received_at from public.v_payments_open_receipts r join public.payment_receipts p on p.id=r.id where r.entity_id=$1 and r.awaiting_invoice`, [ENTITY])).rows
const waitingWithBillPresent = waitingNow.filter((w) => { const t = payments.find((p) => hdfcTxnId(p.n) === w.external_txn_id); return t && t.pays.length && t.pays.every((b) => b.day <= addDays(START, DAYS - 2)) })
const perDayTie = []
for (const day of [...new Set(successes.map((p) => p.day))].sort().filter((d) => d < addDays(START, DAYS - 1))) {   // the last day's rows arrive in tomorrow's file
  const bank = successes.filter((p) => p.day === day).reduce((a, p) => a + Math.round(p.rupees * 100), 0)
  const stored = Number((await db.query(`select coalesce(sum(amount_paise),0) as n from public.payment_receipts where entity_id=$1 and status='active' and source='hdfc' and (received_at at time zone 'Asia/Kolkata')::date = $2::date`, [ENTITY, day])).rows[0].n)
  if (bank !== stored) perDayTie.push({ day, bank, stored, diff: bank - stored })
}
const conflictsNow = (await db.query(`select detail->'conflicts' as c from public.payment_events where entity_id=$1 and event_type='import' and detail->>'kind'='invoices' order by created_at desc limit 1`, [ENTITY])).rows[0]?.c ?? []

const summary = {
  model: MODEL, seed: SEED, days: DAYS,
  world: { bills: bills.length, payable: bills.filter((b) => !['PEI', 'MPR'].includes(b.prefix)).length, upiSuccess: successes.length, upiFailed: payments.filter((p) => p.state === 'SaleFailed').length,
    sameDayAmountCollisionShare: measureCollisions() },
  money: {
    misplacedDeliberate: stats.misplaced.filter((m) => m.deliberate).length,
    misplacedToolLed: stats.misplaced.filter((m) => !m.deliberate).length,
    misplacedToolLedConfident: stats.misplaced.filter((m) => !m.deliberate && m.confident).length,
    misplacedTrueBillAbsent: stats.misplaced.filter((m) => !m.deliberate && m.trueBillsOpenInDb.length === 0).length,
    perDayTieDetail: perDayTie.slice(0, 5),
    reofferedAfterReversal: stats.reofferedAfterReversal, reofferedConfident: stats.reofferedConfident,
    testPaymentStillOpen: (await db.query(`select count(*)::int as n from public.v_payments_open_receipts where entity_id=$1 and amount_paise=100`, [ENTITY])).rows[0].n,
    misplaced: stats.misplaced.length, misplacedKept: stats.misplaced.filter((m) => m.kept || (!m.reversed)).length,
    misplacedPaise: stats.misplaced.filter((m) => !m.reversed).reduce((a, m) => a + m.paise, 0),
    bySignal: countBy(stats.misplaced, (m) => m.signal),
    doubleCounted: dupes, lostPayments: lost.length, perDayTieBreaks: perDayTie.length, cacheDriftRows: stats.days.at(-1).drift,
  },
  drift: {
    openReceiptsByDay: stats.days.map((d) => d.openReceipts), waitingByDay: stats.days.map((d) => d.waitingReceipts),
    openInvoicesByDay: stats.days.map((d) => d.openInvoices), openInvoicePaiseEnd: stats.days.at(-1).openInvoicePaise,
    openInvoicesEnd: openInv.length, openButTrulyPaidByUpi: openButTrulyPaid.length, openNeverPaidByUpi: openNeverUpi.length,
    waitingNow: waitingNow.length, waitingWithBillAlreadyImported: waitingWithBillPresent.length,
    falseUniqueLabels: stats.falseUnique, foundBySearch: stats.foundBySearch, searchHow: stats.searchHow, lastImportConflicts: conflictsNow.length,
    backlogBills: BACKLOG ? bills.filter((b) => b.day < START).length : 0, exportShape: EXPORT,
    cancelledUnderMoney: (await db.query(`select count(*)::int as n from public.service_invoices i where i.entity_id=$1 and i.status='cancelled' and i.allocated_paise > 0`, [ENTITY])).rows[0].n,
    conflictsSeenInMonth: timeline.reduce((a, d) => a + d.log.filter((l) => l.import === 'bills' && l.server).reduce((x, l) => x + (l.server.conflicts || 0), 0), 0),
    amendedSeenInMonth: timeline.reduce((a, d) => a + d.log.filter((l) => l.import === 'bills' && l.server).reduce((x, l) => x + (l.server.amended || 0), 0), 0),
    importTimings: { largest: stats.timings.slice().sort((a, b) => b.rows - a.rows)[0], slowestMs: Math.max(...stats.timings.map((x) => x.ms)) },
  },
  misplacedDetail: stats.misplaced.slice(0, 40), lostDetail: await Promise.all(lost.slice(0, 10).map(async (p) => {
    const txn = hdfcTxnId(p.n), rrn = hdfcRrn(p.n)
    const anyStatus = (await db.query(`select status, source, external_txn_id, normalized_utr from public.payment_receipts where entity_id=$1 and (external_txn_id=$2 or normalized_utr=$3)`, [ENTITY, txn, rrn])).rows
    return { day: p.day, hhmm: p.hhmm, rupees: p.rupees, txn, rrn, inAnyFile: sentTxns.has(txn), rowsTouching: anyStatus }
  })),
  waitingDetail: waitingWithBillPresent.slice(0, 10), conflictsDetail: conflictsNow.slice(0, 5), timeline,
}
function countBy(a, f) { const o = {}; for (const x of a) { const k = f(x) ?? 'null'; o[k] = (o[k] || 0) + 1 } return o }
function measureCollisions() {
  let shared = 0, total = 0
  const byDay = new Map()
  for (const b of bills) { if (['PEI', 'MPR'].includes(b.prefix)) continue; if (!byDay.has(b.day)) byDay.set(b.day, []); byDay.get(b.day).push(b.total) }
  for (const [, amts] of byDay) { const c = new Map(); for (const a of amts) c.set(a, (c.get(a) || 0) + 1); for (const a of amts) { total++; if (c.get(a) > 1) shared++ } }
  return total ? +(shared / total).toFixed(3) : 0
}
if (JSON_OUT) fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(summary, null, 2))
const { timeline: _t, ...brief } = summary
console.log(JSON.stringify(brief, null, 2))
await db.close()
