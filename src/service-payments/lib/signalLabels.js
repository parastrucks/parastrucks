// Turning a matcher signal into something a service executive reads at a
// counter, on a phone, with a customer waiting.
//
// The matcher's internal names ("amount_ambiguous", "reg_last4") are for the
// code and the audit log. Nobody standing at a workshop counter should ever see
// them. Every candidate has to say WHY it is on the list in words that let a
// person disagree with it — a reason you cannot read is a reason you cannot
// check, which turns a shortlist back into a guess.

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
      return 'Only bill at this exact amount'
    case 'amount_ambiguous':
      return d ? `Same amount as ${d.replace(' bills at this amount', ' other bills')}` : 'Amount matches'
    case 'note_bill_number':
      return `Bill number ${d} in the note`
    case 'payer_memory':
      return `This payer has paid for them before (${d.replace('paid for this customer ', '').replace('x', ' times')})`
    case 'payer_memory_weak':
      return 'This payer paid for them once before'
    case 'name_overlap_strong':
      return 'Payer name matches the customer'
    case 'name_overlap':
      return 'Payer name is similar'
    case 'date':
      return dayLabel(d)
    default:
      return s?.signal ?? ''
  }
}

function dayLabel(d) {
  const n = Number(String(d).replace('d', ''))
  if (!Number.isFinite(n)) return ''
  if (n === 0) return 'Billed the same day'
  if (n === 1) return 'Billed yesterday'
  if (n > 0) return `Billed ${n} days earlier`
  return `Billed ${Math.abs(n)} days later`
}

/**
 * The one line that goes under a candidate — the strongest reason it is here.
 * Date is never the headline: "billed the same day" is true of forty bills.
 */
export function primaryReason(candidate) {
  const order = [
    'reg_full', 'reg_last4', 'amount_unique', 'note_bill_number',
    'payer_memory', 'name_overlap_strong', 'amount_ambiguous',
    'payer_memory_weak', 'name_overlap',
  ]
  for (const want of order) {
    const hit = (candidate?.signals || []).find((s) => s.signal === want)
    if (hit) return signalLabel(hit)
  }
  const date = (candidate?.signals || []).find((s) => s.signal === 'date')
  return date ? signalLabel(date) : ''
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
