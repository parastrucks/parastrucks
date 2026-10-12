// Turning a matcher signal into something a service executive reads at a
// counter, on a phone, with a customer waiting.
//
// The matcher's internal names ("amount_ambiguous", "reg_last4") are for the
// code and the audit log. Nobody standing at a workshop counter should ever see
// them. Every candidate has to say WHY it is on the list in words that let a
// person disagree with it — a reason you cannot read is a reason you cannot
// check, which turns a shortlist back into a guess.

/** A name overlap scoring below this (out of 25) shares only common words. */
export const NAME_SIMILAR_FLOOR = 5

/**
 * @param {{signal: string, detail?: string}} s
 * @returns {string} plain English, sentence-case, no jargon
 */
export function signalLabel(s) {
  const d = s?.detail ?? ''
  switch (s?.signal) {
    case 'reg_full':
      return `Truck ${d} named in the note`
    case 'reg_last4':
      // detail arrives as "…9044 of GJ15AV9044"
      return `Truck ${d.split(' of ').pop()} — the note says ${d.split(' of ')[0].replace(/^…/, '')}`
    case 'amount_unique':
      // "other" when the bill this payment was taken off shares the amount.
      return /other/.test(d) ? 'Only other bill at this amount in 3 days' : 'Only bill at this exact amount'
    case 'amount_ambiguous': {
      // detail arrives as "5 bills at this amount" — a count that INCLUDES this
      // bill, so the others are one fewer (the first browser run read "same
      // amount as 2 other bills" on a pair).
      const n = parseInt(d, 10)
      if (!Number.isFinite(n) || n < 2) return 'Amount matches'
      return `Same amount as ${n - 1} other bill${n - 1 === 1 ? '' : 's'}`
    }
    case 'note_bill_number':
      return `Bill number ${d} in the note`
    case 'payer_memory':
      return `This payer has paid for them before (${d.replace('paid for this customer ', '').replace('x', ' times')})`
    case 'payer_memory_weak':
      return 'This payer paid for them once before'
    case 'name_overlap_strong':
      return 'Payer name matches the customer'
    case 'name_overlap': {
      // detail arrives as "score/25", plus " same" when the names are the same
      // words — identical names are said to match whatever their rarity.
      if (/\bsame$/.test(d)) return 'Payer name matches the customer'
      // A faint echo — only a common word shared,
      // like "MOTORS", or "DEMO" on every demo customer — is not "similar"; it
      // put that label on all five ₹1,930 cards and explained nothing. Below
      // the floor it says nothing (one rare word scores ~17 on real data).
      const score = parseFloat(d)
      return Number.isFinite(score) && score < NAME_SIMILAR_FLOOR ? '' : 'Payer name is similar'
    }
    case 'date':
      return dayLabel(d)
    case 'search':
      // Said plainly: the tool did NOT suggest this bill, a person found it.
      return d ? `Found by search · billed ${shortDay(d)}` : 'Found by search'
    default:
      return s?.signal ?? ''
  }
}

/** "2026-10-10" -> "10 Oct", the one date style on these screens (R4-20). */
function shortDay(isoDay) {
  const t = new Date(`${isoDay}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return String(isoDay)
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(t)
}

// Counted from the PAYMENT, and said so: "billed yesterday" read as
// yesterday-from-today (red team 4, R4-30).
function dayLabel(d) {
  const n = Number(String(d).replace('d', ''))
  if (!Number.isFinite(n)) return ''
  if (n === 0) return 'Billed the same day'
  if (n === 1) return 'Billed the day before the payment'
  if (n > 0) return `Billed ${n} days before the payment`
  if (n === -1) return 'Billed the day after the payment'
  return `Billed ${Math.abs(n)} days after the payment`
}

/**
 * The one line that goes under a candidate — the strongest reason it is here.
 * Date is never the headline: "billed the same day" is true of forty bills.
 */
export function primaryReason(candidate) {
  return reasonsOf(candidate)[0] ?? ''
}

const REASON_ORDER = [
  'reg_full', 'reg_last4', 'amount_unique', 'note_bill_number',
  'payer_memory', 'name_overlap_strong', 'amount_ambiguous',
  'payer_memory_weak', 'name_overlap', 'search', 'date',
]

/**
 * Every reason a candidate is on the list, strongest first, each said once.
 * The card shows the first two, so when five bills share an amount the one
 * ranked first also says WHY (its payer name) without a tap; the rest appear
 * when it is selected. Date stays last — it is never the headline.
 */
export function reasonsOf(candidate) {
  const sigs = candidate?.signals || []
  const out = []
  for (const want of REASON_ORDER) {
    for (const s of sigs.filter((x) => x.signal === want)) {
      const label = signalLabel(s)
      if (label && !out.includes(label)) out.push(label)
    }
  }
  return out
}

/**
 * What a card shows: up to two pieces of real evidence on its face (never the
 * date, unless the date is all there is), and the rest only once selected.
 */
export function cardReasons(candidate) {
  const all = reasonsOf(candidate)
  const dates = new Set((candidate?.signals || []).filter((s) => s.signal === 'date').map(signalLabel))
  const evidence = all.filter((l) => !dates.has(l))
  const face = evidence.length ? evidence.slice(0, 2) : all.slice(0, 1)
  return { face, more: all.filter((l) => !face.includes(l)) }
}

/** Canned tap-reasons. Typing on a phone at a counter is the enemy. */
export const BOUNCE_REASONS = [
  'Amount differs',
  'Wrong customer',
  'Need job card number',
  'Already matched elsewhere',
]

export const NOT_SERVICE_KINDS = [
  { value: 'vehicle_booking', label: 'Vehicle booking advance' },
  { value: 'sister_unit', label: 'Sister business' },
  { value: 'refund_return', label: 'Refund coming back' },
  { value: 'personal', label: 'Not a customer payment' },
  { value: 'other', label: 'Something else' },
]
