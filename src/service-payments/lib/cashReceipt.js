// The "Cash & cheque" form's decisions, kept out of React so they are tested
// without a browser (scripts/payments/selftest-cash-receipt.mjs).
//
// Money that does not come through the HDFC report — cash at the counter, a
// cheque, a bank transfer — is keyed in by accounts. Until this form existed,
// every bill paid that way stayed "open" for ever (pre-mortem F5: 1,800 open
// bills after a month, 95% never paid by UPI).
//
// UPI is deliberately NOT offered here: a hand-keyed UPI payment without its
// bank reference is exactly the double count the import rules were built to
// stop. UPI comes from the HDFC report.

import { rupeeStringToPaise, formatINR } from './paise.js'
import { splitAcross } from './confirmPlan.js'

export const CASH_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'netbanking', label: 'Bank transfer' },
]

/**
 * Section 269ST: ₹2,00,000 or more in cash from one person — in one receipt,
 * in a day, or for one event — is penalised at the whole amount, on the
 * dealership. Owner, 2026-10-15 (revising "refuse"): cash already in the
 * drawer must still reach the books, so one receipt at or over this needs a
 * REASON and is marked as a 269ST case for the GM; the server refuses it
 * without one. The form also WARNS when the same payer's cash for the day
 * would reach it (names are typed by hand, so a daily block would be both
 * dodgeable and wrongly triggered).
 */
export const CASH_LIMIT_PAISE = 2_00_000 * 100

export const CASH_LIMIT_MESSAGE =
  'Cash of ₹2,00,000 or more from one person breaks section 269ST of the Income Tax Act (the penalty is the whole amount). Ask for a cheque or a bank transfer. Record it here only if the cash has already been taken — say why, and it is flagged for the GM.'

/** One cash receipt at or over the 269ST line. */
export function overCashLimit(mode, amountPaise) {
  return mode === 'cash' && Number.isFinite(amountPaise) && amountPaise >= CASH_LIMIT_PAISE
}

/** What the second reference box is called, by payment type. */
export function refLabel(mode) {
  if (mode === 'cheque') return 'Cheque number'
  if (mode === 'netbanking') return 'Bank reference (optional)'
  return null
}

/**
 * The instant a receipt is stamped with. Today: now. An earlier day: noon on
 * that day in India — the hour is unknown and noon cannot slip into the day
 * before or after in any time zone the database might print it in.
 */
export function receivedAtFor(day, now = new Date()) {
  const today = istDay(now)
  if (!day || day === today) return now.toISOString()
  return new Date(`${day}T12:00:00+05:30`).toISOString()
}

/** The India calendar day of an instant, "YYYY-MM-DD". */
export function istDay(instant) {
  const t = new Date(new Date(instant).getTime() + 330 * 60000)
  return t.toISOString().slice(0, 10)
}

/**
 * Check the form. Returns the errors to show, by field, and — when there are
 * none — the row the server takes.
 *
 * @param form  {mode, amount, day, payer, ref, outletId, note, limitReason}
 * @param opts  {now, outletRequired}
 * @returns {{errors: Record<string,string>, row: object|null}}
 */
export function checkCashForm(form, { now = new Date(), outletRequired = false } = {}) {
  const errors = {}
  const mode = form?.mode
  if (!CASH_MODES.some((m) => m.value === mode)) errors.mode = 'Pick cash, cheque or bank transfer.'

  let amount = null
  const raw = String(form?.amount ?? '').trim()
  if (!raw) errors.amount = 'Enter the amount.'
  else {
    try { amount = rupeeStringToPaise(raw) } catch { errors.amount = 'Enter the amount in rupees, like 1930 or 1930.50.' }
    if (amount !== null && amount <= 0) errors.amount = 'The amount must be more than zero.'
  }
  const limitReason = String(form?.limitReason ?? '').trim()
  if (amount !== null && amount > 0 && overCashLimit(mode, amount) && !limitReason) {
    errors.limitReason = 'Say why the cash was taken — it goes to the GM.'
  }

  const today = istDay(now)
  const day = form?.day || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) errors.day = 'Pick the day it was received.'
  else if (day > today) errors.day = 'The day cannot be in the future.'

  const payer = String(form?.payer ?? '').trim()
  if (!payer) errors.payer = 'Who paid? The name on the cheque, or the person at the counter.'

  const ref = String(form?.ref ?? '').trim()
  if (mode === 'cheque' && !ref) errors.ref = 'Enter the cheque number — it is how a bounced cheque is traced.'

  if (outletRequired && !form?.outletId) errors.outlet = 'Pick the outlet that took the money.'

  if (Object.keys(errors).length) return { errors, row: null }
  return {
    errors,
    row: {
      mode,
      amount_paise: amount,
      received_at: receivedAtFor(day, now),
      payer_name: payer,
      instrument_ref: mode === 'cash' ? null : (ref || null),
      outlet_id: form?.outletId || null,
      notes: String(form?.note ?? '').trim() || null,
      cash_limit_reason: overCashLimit(mode, amount) ? limitReason : null,
    },
  }
}

/**
 * The warning for a payer whose CASH that day would reach ₹2 lakh with this
 * receipt. Empty when it would not, or when this is not cash.
 *
 * @param alreadyPaise  the payer's other active cash receipts that day
 */
export function dayCashWarning(mode, amountPaise, alreadyPaise, payer, day) {
  if (mode !== 'cash' || !amountPaise || !alreadyPaise) return ''
  const total = amountPaise + alreadyPaise
  if (total < CASH_LIMIT_PAISE) return ''
  return `With this, ${payer || 'this payer'}'s cash on ${dayLabel(day)} comes to ${formatINR(total)} ` +
    `(${formatINR(alreadyPaise)} already entered). ₹2,00,000 or more in cash from one person in a day ` +
    'is not allowed (section 269ST). Check before saving.'
}

/**
 * What to place on the picked bill — or the picked whole ORDER (parts +
 * labour), whose bills a candidate carries as `members` (pre-mortem 2, G1: a
 * cheque for a pair used to leave the second bill to the amount matcher).
 * The SAME split rule as Confirm on the Match screen (splitAcross): never
 * more than the receipt holds, never more than a bill still owes; anything
 * left stays on the receipt, in accounts' Match list.
 */
export function cashTargets(choice, amountPaise) {
  if (!choice) return []
  const bills = (choice.members?.length ? choice.members : [choice]).filter((b) => b?.id)
  return splitAcross(bills, amountPaise)
    .filter((s) => s.take > 0)
    .map((s) => ({ invoice_id: s.bill.id, amount_paise: s.take }))
}

function dayLabel(day) {
  const t = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(t.getTime())) return String(day)
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(t)
}
