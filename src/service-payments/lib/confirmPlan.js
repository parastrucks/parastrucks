// What one Confirm does to the bills it pays, and how to say it before the
// tap (red team 4: R4-6, R4-12). Kept apart from matchQueue.js, which
// imports the Edge Function's authority.ts, so the cash form and its plain
// node self-test can use the SAME split rule as the Match screen.

import { formatINR } from './paise.js'

/**
 * The ONE split rule, shared by Confirm (allocationTargets) and by what the
 * screen says Confirm will do (confirmPlan) — so the sentence can never
 * describe a split the server is not sent. Cash-terms first, then oldest,
 * then by number; each bill takes what it still owes until the money runs out.
 * Every bill comes back, in that order, with what it takes (0 when not reached).
 */
export function splitAcross(bills, receiptOpenPaise) {
  let left = receiptOpenPaise
  return [...bills]
    .sort((a, b) =>
      (a.payment_terms === 'cash' ? 0 : 1) - (b.payment_terms === 'cash' ? 0 : 1) ||
      String(a.invoice_date).localeCompare(String(b.invoice_date)) ||
      String(a.invoice_number).localeCompare(String(b.invoice_number)))
    .map((bill) => {
      const open = bill.total_paise - (bill.allocated_paise ?? 0)
      const take = left > 0 ? Math.max(0, Math.min(open, left)) : 0
      left -= take
      return { bill, open, take }
    })
}

const BILL_KIND_LABEL = { service_parts: 'Parts', service_labour: 'Labour', counter_sale: 'Counter sale' }

/**
 * What Confirm will do, in words, for the picked card (red team 4: R4-6 "the
 * screen never says what happens to the rest", R4-12 "one confirm pays two
 * bills and the card shows neither"). One line on the PICKED card only — the
 * unpicked list is unchanged — and the Confirm button's own words.
 *
 *   one bill, paid in full     line ''                       button "Confirm ₹1,930.00"
 *   one bill, part paid        "₹10,000.00 of ₹25,000.00 — ₹15,000.00 stays due, the bill stays open"
 *                              button "Confirm ₹10,000.00 · ₹15,000.00 still due"
 *   order, both close          "Parts ₹6,150.00 + Labour ₹5,500.00 = ₹11,650.00 · both bills close"
 *                              button "Confirm ₹11,650.00 · 2 bills"
 *   order, short               "Parts ₹6,150.00 closes · Labour ₹3,850.00 of ₹5,500.00 — ₹1,650.00 stays due"
 *   more money than the bills  "... · ₹500.00 of the payment stays, to place on another bill"
 *
 * @returns {{line: string, button: string, placing: number, stillDue: number, leftOnPayment: number}}
 */
export function confirmPlan(candidate, receiptOpenPaise) {
  const members = candidate?.members?.length ? candidate.members : null
  if (!members) {
    // A candidate without its bills (never from this app's own lists): say no
    // more than is known.
    const placing = Math.min(candidate?.amount_paise ?? 0, receiptOpenPaise)
    return { line: '', button: `Confirm ${formatINR(placing)}`, placing, stillDue: 0, leftOnPayment: 0, takes: null }
  }
  const split = splitAcross(members, receiptOpenPaise)
  const placing = split.reduce((a, s) => a + s.take, 0)
  const stillDue = split.reduce((a, s) => a + (s.open - s.take), 0)
  const leftOnPayment = Math.max(0, receiptOpenPaise - placing)
  // Bill by bill, exactly what Confirm will send (the self-test compares them).
  const takes = split.filter((s) => s.take > 0).map((s) => ({ invoice_id: s.bill.id, amount_paise: s.take }))
  const rest = leftOnPayment > 0 ? ` · ${formatINR(leftOnPayment)} of the payment stays, to place on another bill` : ''

  if (split.length === 1) {
    const [{ open, take }] = split
    if (take < open) {
      return {
        line: `${formatINR(take)} of ${formatINR(open)} — ${formatINR(open - take)} stays due, the bill stays open`,
        button: `Confirm ${formatINR(take)} · ${formatINR(open - take)} still due`,
        placing, stillDue, leftOnPayment, takes,
      }
    }
    return { line: rest ? `Closes the bill${rest}` : '', button: `Confirm ${formatINR(take)}`, placing, stillDue, leftOnPayment, takes }
  }

  const name = (b) => BILL_KIND_LABEL[b.invoice_kind] ?? `Bill ${b.invoice_number}`
  if (stillDue === 0) {
    const all = split.length === 2 ? 'both bills close' : `all ${split.length} bills close`
    return {
      line: `${split.map((s) => `${name(s.bill)} ${formatINR(s.take)}`).join(' + ')} = ${formatINR(placing)} · ${all}${rest}`,
      button: `Confirm ${formatINR(placing)} · ${split.length} bills`,
      placing, stillDue, leftOnPayment, takes,
    }
  }
  const parts = split.map((s) => (s.take === s.open
    ? `${name(s.bill)} ${formatINR(s.take)} closes`
    : s.take > 0
      ? `${name(s.bill)} ${formatINR(s.take)} of ${formatINR(s.open)}`
      : `${name(s.bill)} ${formatINR(s.open)} not paid`))
  return {
    line: `${parts.join(' · ')} — ${formatINR(stillDue)} stays due`,
    button: `Confirm ${formatINR(placing)} · ${formatINR(stillDue)} still due`,
    placing, stillDue, leftOnPayment, takes,
  }
}
