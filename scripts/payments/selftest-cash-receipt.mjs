// The "Cash & cheque" form's rules, checked without a browser.
//   node scripts/payments/selftest-cash-receipt.mjs
// Expectations are written out by hand. The ₹2 lakh rule is the owner's
// decision of 2026-10-13 (the server refuses one cash receipt at or over it;
// the form warns on a payer's day total) and section 269ST of the Income Tax Act.
//
// LIMIT, stated: CashPanel.jsx itself is not rendered here (it imports the live
// Supabase client). Its two calls and their order are checked in the browser
// against staging, and the server half by scripts/payments/probe-manual-receipt.sql.

import {
  CASH_MODES, CASH_LIMIT_PAISE, CASH_LIMIT_MESSAGE, refLabel, receivedAtFor, istDay,
  checkCashForm, dayCashWarning, cashTargets, overCashLimit,
} from '../../src/service-payments/lib/cashReceipt.js'
import { confirmPlan } from '../../src/service-payments/lib/confirmPlan.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

// 13 Oct, 3:30 pm in India.
const NOW = new Date('2026-10-13T10:00:00.000Z')
const form = (o = {}) => ({ mode: 'cash', amount: '845', day: '2026-10-13', payer: 'Manan Shah', ref: '', outletId: '', note: '', ...o })
const check = (o, opts = {}) => checkCashForm(form(o), { now: NOW, ...opts })

// ════════════════════════════════════════════════════════════════════════════
section('what can be recorded here')
eq('cash, cheque and bank transfer — and NOT UPI (UPI comes from the HDFC report)',
   CASH_MODES.map((m) => m.value), ['cash', 'cheque', 'netbanking'])
ok('a UPI entry is refused by the form', Boolean(check({ mode: 'upi' }).errors.mode))
eq('the second box is named by payment type',
   [refLabel('cash'), refLabel('cheque'), refLabel('netbanking')], [null, 'Cheque number', 'Bank reference (optional)'])

section('a good entry becomes exactly the row the server takes')
{
  const { errors, row } = check({ note: '  job 4412 ', outletId: 'o1' })
  eq('no errors', errors, {})
  eq('the row', row, {
    mode: 'cash', amount_paise: 84500, received_at: NOW.toISOString(), payer_name: 'Manan Shah',
    instrument_ref: null, outlet_id: 'o1', notes: 'job 4412', cash_limit_reason: null,
  })
  eq('a cheque keeps its number', check({ mode: 'cheque', ref: ' 000123 ' }).row.instrument_ref, '000123')
  eq('cash never carries a reference, even one typed before switching to cash', check({ mode: 'cash', ref: '999' }).row.instrument_ref, null)
  eq('₹1,930.50 is 193050 paise', check({ amount: '1,930.50' }).row.amount_paise, 193050)
}

section('what the form refuses, in words')
ok('no amount', /Enter the amount/.test(check({ amount: '' }).errors.amount ?? ''))
ok('not a number', /like 1930/.test(check({ amount: 'abc' }).errors.amount ?? ''))
ok('three decimals', /like 1930/.test(check({ amount: '10.123' }).errors.amount ?? ''))
ok('zero', /more than zero/.test(check({ amount: '0' }).errors.amount ?? ''))
ok('negative', /more than zero/.test(check({ amount: '-5' }).errors.amount ?? ''))
ok('no payer', /Who paid/.test(check({ payer: '  ' }).errors.payer ?? ''))
ok('a cheque with no number (it is how a bounce is traced)', /cheque number/.test(check({ mode: 'cheque', ref: '' }).errors.ref ?? ''))
ok('a bank transfer may have no reference', !check({ mode: 'netbanking', ref: '' }).errors.ref)
ok('a day in the future', /future/.test(check({ day: '2026-10-14' }).errors.day ?? ''))
ok('an outlet, when the company has outlets', /outlet/.test(check({}, { outletRequired: true }).errors.outlet ?? ''))
ok('...but not when it has none', !check({}, { outletRequired: false }).errors.outlet)
eq('errors mean no row is sent', check({ payer: '' }).row, null)

section('section 269ST — ₹2 lakh in cash')
eq('the limit is ₹2,00,000', CASH_LIMIT_PAISE, 20000000)
// Owner, 2026-10-15 (pre-mortem 2, G3): cash already in the drawer must reach
// the books. At or over the line it needs a reason, never a refusal of the record.
ok('the 269ST line is cash of ₹2,00,000 or more, never a cheque or transfer',
   overCashLimit('cash', 20000000) && !overCashLimit('cash', 19999999) && !overCashLimit('cheque', 50000000) && !overCashLimit('netbanking', 50000000))
ok('cash of exactly ₹2,00,000 with no reason: the form asks why (it is not refused as an amount)',
   /Say why/.test(check({ amount: '200000' }).errors.limitReason ?? '') && !check({ amount: '200000' }).errors.amount)
ok('...and the message on the form says the rule and what to do', /269ST/.test(CASH_LIMIT_MESSAGE) && /cheque or a bank transfer/.test(CASH_LIMIT_MESSAGE) && /flagged for the GM/.test(CASH_LIMIT_MESSAGE))
eq('with a reason: recorded, the reason sent to the server',
   check({ amount: '210000', limitReason: '  Taken at the counter  ' }).row?.cash_limit_reason, 'Taken at the counter')
eq('below the line, a typed reason is not sent (nothing to flag)',
   check({ amount: '1000', limitReason: 'x' }).row?.cash_limit_reason, null)
ok('cash of ₹1,99,999.99: accepted', check({ amount: '199999.99' }).row?.amount_paise === 19999999)
ok('a ₹2,50,000 cheque: accepted (not cash)', check({ mode: 'cheque', ref: '1', amount: '250000' }).row?.amount_paise === 25000000)
ok('a ₹5,00,000 bank transfer: accepted', check({ mode: 'netbanking', amount: '500000' }).row?.amount_paise === 50000000)
{
  const w = dayCashWarning('cash', 6000000, 15000000, 'Manan Shah', '2026-10-13')
  ok('₹1,50,000 already + ₹60,000 now: warned, with the day\'s total',
     /Manan Shah's cash on 13 Oct comes to ₹2,10,000\.00/.test(w) && /₹1,50,000\.00 already entered/.test(w) && /269ST/.test(w), w)
  eq('₹1,00,000 already + ₹50,000 now: no warning', dayCashWarning('cash', 5000000, 10000000, 'X', '2026-10-13'), '')
  eq('...landing exactly on ₹2,00,000 IS warned', Boolean(dayCashWarning('cash', 5000000, 15000000, 'X', '2026-10-13')), true)
  eq('a cheque is never warned', dayCashWarning('cheque', 6000000, 15000000, 'X', '2026-10-13'), '')
  eq('nothing entered before: no warning (the single-receipt rule covers it)', dayCashWarning('cash', 19999999, 0, 'X', '2026-10-13'), '')
}

section('which moment the receipt is stamped with')
eq('today: now', receivedAtFor('2026-10-13', NOW), NOW.toISOString())
eq('an earlier day: noon that day in India', receivedAtFor('2026-10-10', NOW), '2026-10-10T06:30:00.000Z')
eq('no day: now', receivedAtFor('', NOW), NOW.toISOString())
eq('the India day of 20:00 UTC on the 12th is the 13th', istDay('2026-10-12T20:00:00.000Z'), '2026-10-13')
eq('...and of 18:00 UTC on the 12th, still the 12th', istDay('2026-10-12T18:00:00.000Z'), '2026-10-12')

section('what is placed on a picked ORDER (pre-mortem 2, G1)')
{
  const m = (id, kind, total, terms = 'cash', allocated = 0) => ({ id, invoice_number: id, invoice_kind: kind,
    payment_terms: terms, invoice_date: '2026-10-08', total_paise: total, allocated_paise: allocated })
  const order = { id: 'job:J', kind: 'job', members: [m('PCS1', 'service_parts', 615000), m('LCS2', 'service_labour', 550000)] }
  eq('a cheque for the whole order pays both bills', cashTargets(order, 1165000),
     [{ invoice_id: 'LCS2', amount_paise: 550000 }, { invoice_id: 'PCS1', amount_paise: 615000 }])
  eq('short: the same order of filling as Confirm on the Match screen', cashTargets(order, 1000000),
     [{ invoice_id: 'LCS2', amount_paise: 550000 }, { invoice_id: 'PCS1', amount_paise: 450000 }])
  let diff = 0
  for (let i = 0; i < 500; i++) {
    const a = 1000 + ((i * 7919) % 400000), b = 1000 + ((i * 104729) % 400000)
    const o = { members: [m('A', 'service_parts', a, i % 2 ? 'cash' : 'credit', (i * 13) % 900), m('B', 'service_labour', b, i % 3 ? 'credit' : 'cash')] }
    const amt = 1 + ((i * 15485863) % 900000)
    if (JSON.stringify(cashTargets(o, amt)) !== JSON.stringify(confirmPlan(o, amt).takes)) diff++
  }
  eq('500 orders: what the cash form sends = what the Match screen says Confirm sends', diff, 0)
}

section('what is placed on the picked bill')
const bill = { id: 'b1', total_paise: 84500, allocated_paise: 0 }
eq('the payment covers the bill: the bill\'s amount', cashTargets(bill, 100000), [{ invoice_id: 'b1', amount_paise: 84500 }])
eq('the payment is short: all of it, the bill part-paid', cashTargets(bill, 50000), [{ invoice_id: 'b1', amount_paise: 50000 }])
eq('a part-paid bill: only what it still owes', cashTargets({ ...bill, allocated_paise: 40000 }, 100000), [{ invoice_id: 'b1', amount_paise: 44500 }])
eq('a bill already paid: nothing to place', cashTargets({ ...bill, allocated_paise: 84500 }, 100000), [])
eq('no bill: nothing to place', cashTargets(null, 100000), [])

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
