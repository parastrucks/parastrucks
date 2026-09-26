// The matcher: given one UPI receipt, produce a SHORT LIST of bills it might
// pay, ranked, with the reason for each rank visible.
//
// The measured premise this is built on, and it is not flattering: across 440
// real August receipts against 1,085 real invoices, only 12% match exactly one
// bill by amount. 63% match several. So the honest goal is NOT "guess the
// answer" — it is "narrow 1,085 bills to two or three in one screen, and say
// why", and then let the person who was standing at the counter decide.
//
// A matcher that guesses confidently is worse than one that shortlists, because
// a wrong allocation is money on the wrong customer's ledger and it will be
// found — if at all — a month later by an accountant who does not know what
// happened that afternoon.

import { normalizePayerName } from './parseUpi.js'
import { istDateOf } from './dates.js'

/**
 * Signal weights. Deliberately separated so tiers cannot silently outrank.
 *
 * ⭐ REG_LAST4 exists because of a measurement that overturned the plan. The
 * plan assumed a number typed into a Google Pay note is a BILL number. It is
 * not: of 28 real August notes carrying a number, 17 are the last four digits
 * of the VEHICLE REGISTRATION and exactly one is an invoice number. Two of them
 * spell it out — "GJ15AV 9044", "Gj27td 7715". Drivers identify a truck by its
 * plate, and so does the workshop; nobody memorises "MPI6370260000724".
 */
export const WEIGHTS = {
  REG_FULL: 95,         // a whole registration in the note matches the bill's vehicle
  REG_LAST4: 85,        // the last four of the plate — how people actually refer to a truck
  AMOUNT_UNIQUE: 90,    // exactly one open bill has this amount in the window
  NOTE_BILL_NUMBER: 45, // a typed number matching a bill/job/document tail. Real but rare
                        // (1-3 of 28), and 4 digits collide easily, so it does not outrank
                        // a registration.
  AMOUNT_AMBIGUOUS: 55, // several bills share this amount — real, not decisive alone
  MEMORY_STRONG: 50,    // this payer has paid for this customer 2+ times
  MEMORY_WEAK: 20,      // ...once. One confirmation can be one mistake.
  NAME_MAX: 25,         // payer name overlaps the customer name
  DATE_MAX: 10,         // same day is worth a little; nothing more
}

/**
 * A candidate must earn its place with one of these. Date proximity and a faint
 * name echo are NOT among them.
 *
 * Without this rule every open bill within the date window scored something and
 * the shortlist was always exactly `limit` long — measured at a median of 8 out
 * of 8, with "nothing in range" never once firing across 450 real receipts. A
 * list that is always full is not a shortlist; it is the corpus with a spinner.
 */
const SUBSTANTIVE = new Set([
  'reg_full', 'reg_last4', 'amount_unique', 'amount_ambiguous',
  'note_bill_number', 'payer_memory', 'payer_memory_weak', 'name_overlap_strong',
])

/** Two candidates within this are not meaningfully ordered. */
export const TIE_EPSILON = 5

/** Receipt date vs invoice date, in days, either direction. */
export const DEFAULT_WINDOW_DAYS = 3

// Name tokens so common in this customer base that sharing one means nothing.
// Derived from the corpus at index time; this is only the floor.
const ALWAYS_NOISE = new Set([
  'TRANSPORT', 'TRANSPORTS', 'ROADWAYS', 'LOGISTICS', 'CARRIERS', 'CARRIER',
  'PRIVATE', 'LIMITED', 'PVT', 'LTD', 'AND', 'CO', 'COMPANY', 'THE', 'SO', 'S',
  'KUMAR', 'SINGH', 'BHAI', 'BEN', 'LAL', 'RAM', 'SHREE', 'SHRI', 'JI',
])

/**
 * Build the searchable index once per screen-load, not once per receipt.
 *
 * Produces both INVOICE candidates and JOB candidates. A quarter of orders
 * (245 of 836, measured) bill as two invoices — parts and labour — and the
 * customer pays the combined total, so an invoice-only index would show "no
 * match" for the single most ordinary case there is.
 */
export function buildCandidateIndex(invoices, { asOf = null } = {}) {
  const open = invoices.filter((v) =>
    v.status === 'active' && outstandingOf(v) > 0)

  const docs = []
  for (const v of open) {
    docs.push({
      kind: 'invoice',
      id: v.id ?? v.invoice_number,
      invoice_ids: [v.id ?? v.invoice_number],
      label: v.invoice_number,
      amount_paise: outstandingOf(v),
      date: v.invoice_date,
      sap_customer_code: v.sap_customer_code,
      customer_name: v.customer_name,
      vehicle_reg_no: v.vehicle_reg_no,
      job_ref: v.job_ref,
      invoice_number: v.invoice_number,
      sap_billing_doc: v.sap_billing_doc,
      dealer_order_no: v.dealer_order_no,
      payment_terms: v.payment_terms,
    })
  }

  // Job-level candidates: only where an order really did split.
  const byJob = new Map()
  for (const v of open) {
    if (!v.job_ref) continue
    if (!byJob.has(v.job_ref)) byJob.set(v.job_ref, [])
    byJob.get(v.job_ref).push(v)
  }
  for (const [jobRef, group] of byJob) {
    if (group.length < 2) continue
    docs.push({
      kind: 'job',
      id: `job:${jobRef}`,
      invoice_ids: group.map((v) => v.id ?? v.invoice_number),
      label: `${group.length} bills · order ${jobRef}`,
      amount_paise: group.reduce((a, v) => a + outstandingOf(v), 0),
      date: group.map((v) => v.invoice_date).sort()[0],
      sap_customer_code: group[0].sap_customer_code,
      customer_name: group[0].customer_name,
      vehicle_reg_no: group.find((v) => v.vehicle_reg_no)?.vehicle_reg_no ?? null,
      job_ref: jobRef,
      invoice_number: group.map((v) => v.invoice_number).join(' + '),
      sap_billing_doc: group[0].sap_billing_doc,
      dealer_order_no: group[0].dealer_order_no,
      payment_terms: group[0].payment_terms,
      member_count: group.length,
    })
  }

  // Amount index, and how often each amount occurs — this is what makes
  // "unique amount" a defensible signal rather than a hopeful one.
  const byAmount = new Map()
  for (const d of docs) {
    if (!byAmount.has(d.amount_paise)) byAmount.set(d.amount_paise, [])
    byAmount.get(d.amount_paise).push(d)
  }

  // Name-token rarity, learned from this dealership's own customers. "SHARMA"
  // is noise here even though it is a perfectly good discriminator elsewhere.
  const docFreq = new Map()
  for (const d of docs) {
    for (const t of new Set(nameTokens(d.customer_name))) {
      docFreq.set(t, (docFreq.get(t) || 0) + 1)
    }
  }

  return { docs, byAmount, docFreq, docCount: docs.length, asOf }
}

function outstandingOf(v) {
  const total = v.total_paise ?? 0
  const allocated = v.allocated_paise ?? 0
  return total - allocated
}

function nameTokens(name) {
  return normalizePayerName(name)
    .split(' ')
    .filter((t) => t.length > 1 && !ALWAYS_NOISE.has(t))
}

/**
 * Rank the bills one receipt might be paying.
 *
 * @returns {{
 *   candidates: Array<object>,
 *   refuse_to_rank: boolean,
 *   reason: string,
 *   searched: number,
 * }}
 */
export function matchCandidates(receipt, index, {
  payerMemory = [],
  windowDays = DEFAULT_WINDOW_DAYS,
  limit = 8,
  feedIsStale = false,
} = {}) {
  const receiptDate = receiptDayOf(receipt.received_at)
  const noteNumbers = receipt.note_numbers || []
  const regNos = receipt.reg_nos || []
  const payer = receipt.normalized_payer_name || normalizePayerName(receipt.payer_name)
  const payerToks = new Set(nameTokens(payer))

  // Which customers this payer name has actually paid for before.
  const memory = new Map()
  for (const m of payerMemory) {
    if (m.normalized_payer_name !== payer) continue
    memory.set(m.sap_customer_code ?? m.customer_id, m)
  }

  const scored = []
  for (const d of index.docs) {
    const days = dayGap(receiptDate, d.date)
    // The window is a filter, not a score: a bill from three weeks ago is not
    // a weak candidate, it is a different question (and lives under search).
    if (days === null || Math.abs(days) > windowDays) continue

    let score = 0
    const signals = []

    // ── the vehicle, which is how customers actually identify a job ─────
    if (d.vehicle_reg_no) {
      if (regNos.length && regNos.includes(d.vehicle_reg_no)) {
        score += WEIGHTS.REG_FULL
        signals.push({ signal: 'reg_full', detail: d.vehicle_reg_no })
      } else if (noteNumbers.length) {
        const last4 = d.vehicle_reg_no.slice(-4)
        if (last4.length === 4 && noteNumbers.includes(last4)) {
          score += WEIGHTS.REG_LAST4
          signals.push({ signal: 'reg_last4', detail: `…${last4} of ${d.vehicle_reg_no}` })
        }
      }
    }

    // ── a typed bill/job/document number ────────────────────────────────
    // Kept, but weighted for what it is: rare, and four digits collide.
    if (noteNumbers.length && !signals.some((s) => s.signal.startsWith('reg_'))) {
      const tails = [d.invoice_number, d.job_ref, d.sap_billing_doc, d.dealer_order_no]
        .filter(Boolean).map(String)
      const hit = noteNumbers.find((n) => tails.some((t) => t.endsWith(n)))
      if (hit) {
        score += WEIGHTS.NOTE_BILL_NUMBER
        signals.push({ signal: 'note_bill_number', detail: hit })
      }
    }

    // ── amount ─────────────────────────────────────────────────────────
    if (d.amount_paise === receipt.amount_paise) {
      const sameAmount = (index.byAmount.get(d.amount_paise) || [])
        .filter((o) => { const g = dayGap(receiptDate, o.date); return g !== null && Math.abs(g) <= windowDays })
      const unique = sameAmount.length === 1
      score += unique ? WEIGHTS.AMOUNT_UNIQUE : WEIGHTS.AMOUNT_AMBIGUOUS
      signals.push({
        signal: unique ? 'amount_unique' : 'amount_ambiguous',
        detail: unique ? 'only bill at this amount' : `${sameAmount.length} bills at this amount`,
      })
    }

    // ── learned payer -> customer ──────────────────────────────────────
    const mem = memory.get(d.sap_customer_code)
    if (mem) {
      const strong = (mem.confirm_count || 0) >= 2 && (mem.contradiction_count || 0) === 0
      score += strong ? WEIGHTS.MEMORY_STRONG : WEIGHTS.MEMORY_WEAK
      signals.push({
        signal: strong ? 'payer_memory' : 'payer_memory_weak',
        detail: `paid for this customer ${mem.confirm_count}x`,
      })
    }

    // ── name overlap, rarity-weighted, never negative ───────────────────
    // Never negative on purpose: drivers, sons and clerks pay for firms whose
    // names they do not share. A mismatched name is an absence of evidence,
    // not evidence of absence.
    if (payerToks.size && d.customer_name) {
      const nameScore = overlapScore(payerToks, nameTokens(d.customer_name), index)
      if (nameScore > 0) {
        score += nameScore
        // Only a STRONG overlap (a rare token, essentially the real name) can
        // put a bill on the list by itself. A faint echo rides along but never
        // qualifies, or every "SINGH" in the window becomes a candidate.
        signals.push({
          signal: nameScore >= WEIGHTS.NAME_MAX * 0.6 ? 'name_overlap_strong' : 'name_overlap',
          detail: `${Math.round(nameScore)}/${WEIGHTS.NAME_MAX}`,
        })
      }
    }

    // ── date proximity ─────────────────────────────────────────────────
    // SAP gives no billing TIME (owner, final), so this can never be finer
    // than a day and is weighted accordingly. It breaks ties; it never makes
    // a candidate.
    const dateScore = Math.max(0, WEIGHTS.DATE_MAX - Math.abs(days) * 3)
    if (dateScore > 0) { score += dateScore; signals.push({ signal: 'date', detail: `${days}d` }) }

    // A bill only reaches the screen if something real points at it.
    if (!signals.some((s) => SUBSTANTIVE.has(s.signal))) continue

    scored.push({ ...d, score, signals, day_gap: days })
  }

  scored.sort((a, b) => b.score - a.score || a.amount_paise - b.amount_paise)
  const top = scored.slice(0, limit)

  // ── refuse to rank ──────────────────────────────────────────────────
  // When the top two are within epsilon and nothing decisive separates them,
  // presenting an order is a lie about how much we know. Show the list
  // unordered and say so.
  const hasStrong = top[0]?.signals?.some((s) =>
    s.signal === 'reg_full' || s.signal === 'reg_last4' ||
    s.signal === 'amount_unique' || s.signal === 'payer_memory')
  const tied = top.length >= 2 && (top[0].score - top[1].score) < TIE_EPSILON
  const refuse = Boolean(tied && !hasStrong)

  let reason = ''
  if (feedIsStale) reason = 'The invoice feed is out of date — confirm is disabled until fresh bills land.'
  else if (!top.length) reason = 'No open bill within 3 days at this amount. Search by name or amount, or hold it as an advance.'
  else if (refuse) reason = `${top.length} bills look equally likely. Pick the one you recognise — they are not ranked.`

  return {
    candidates: refuse ? top.map((c) => ({ ...c, rank: null })) : top.map((c, i) => ({ ...c, rank: i + 1 })),
    refuse_to_rank: refuse,
    confident: Boolean(!refuse && !feedIsStale && top.length && hasStrong &&
                       (top.length === 1 || top[0].score - top[1].score >= 30)),
    reason,
    searched: index.docCount,
  }
}

function overlapScore(payerToks, custToks, index) {
  if (!custToks.length) return 0
  let sum = 0
  for (const t of new Set(custToks)) {
    if (!payerToks.has(t)) continue
    // Rarer tokens carry more. A token on 1 bill in 1,000 is near-proof; one
    // on 200 of them says almost nothing.
    const df = index.docFreq.get(t) || 1
    sum += Math.log((index.docCount + 1) / df)
  }
  if (sum <= 0) return 0
  // Squash into 0..NAME_MAX. log(1086/1) ≈ 7, so a single rare exact token
  // reaches roughly two-thirds of the ceiling.
  return Math.min(WEIGHTS.NAME_MAX, (sum / 10) * WEIGHTS.NAME_MAX)
}

/**
 * The IST calendar day a receipt belongs to. Bills are dated in IST, and the
 * database hands instants back in UTC — slicing the first ten characters dated
 * every payment made between midnight and 05:30 IST to the day before.
 */
function receiptDayOf(receivedAt) {
  const s = String(receivedAt || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try { return istDateOf(s) } catch { return '' }
}

/** Whole days between two ISO dates: positive when the receipt is later. */
function dayGap(receiptDate, invoiceDate) {
  if (!receiptDate || !invoiceDate) return null
  const a = Date.parse(`${receiptDate}T00:00:00Z`)
  const b = Date.parse(`${invoiceDate}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}
