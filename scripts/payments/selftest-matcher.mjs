// Self-tests for the candidate matcher.
//   node scripts/payments/selftest-matcher.mjs
// Synthetic only — no files, no network, no database.

import {
  buildCandidateIndex, matchCandidates, WEIGHTS, TIE_EPSILON,
} from '../../src/service-payments/lib/matchCandidates.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

let seq = 0
const invoice = (o = {}) => ({
  id: `inv-${++seq}`,
  invoice_number: o.invoice_number ?? `MPI637026000${String(seq).padStart(4, '0')}`,
  status: 'active',
  total_paise: 193000,
  allocated_paise: 0,
  invoice_date: '2026-08-10',
  sap_customer_code: `C${seq}`,
  customer_name: 'NEW GURPAL TRANSPORT',
  vehicle_reg_no: null,
  job_ref: null,
  sap_billing_doc: null,
  dealer_order_no: null,
  payment_terms: 'cash',
  ...o,
})
const receipt = (o = {}) => ({
  amount_paise: 193000,
  received_at: '2026-08-10T06:00:00.000Z',
  payer_name: null,
  normalized_payer_name: '',
  note_numbers: [],
  reg_nos: [],
  ...o,
})

// ════════════════════════════════════════════════════════════════════════════
section('a bill must EARN its place on the list')

{
  // The defect this locks down: before it, every open bill inside the date
  // window scored for date proximity alone, so the shortlist was always
  // exactly `limit` long and "nothing in range" never fired once across 450
  // real receipts.
  const idx = buildCandidateIndex([
    invoice({ total_paise: 500000 }),
    invoice({ total_paise: 700000 }),
    invoice({ total_paise: 990000 }),
  ])
  const res = matchCandidates(receipt({ amount_paise: 123400 }), idx)
  eq('same-day bills at other amounts are NOT candidates', res.candidates.length, 0)
  ok('and the screen says so', res.reason.includes('No open bill'))
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx)
  eq('an exact amount IS a candidate', res.candidates.length, 1)
}
{
  // A faint shared token must not qualify a bill on its own — otherwise every
  // "SINGH" in the window lands on the list.
  const idx = buildCandidateIndex([
    invoice({ total_paise: 500000, customer_name: 'RAJU SINGH' }),
  ])
  const res = matchCandidates(
    receipt({ amount_paise: 123400, payer_name: 'MOHAN SINGH', normalized_payer_name: 'MOHAN SINGH' }), idx)
  eq('a common-surname echo alone is not a candidate', res.candidates.length, 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('the vehicle — how customers actually identify a job')

{
  // Measured: 17 of 28 real note numbers are the last four of a registration.
  const idx = buildCandidateIndex([
    invoice({ total_paise: 500000, vehicle_reg_no: 'GJ15AV9044' }),
    invoice({ total_paise: 500000, vehicle_reg_no: 'GJ27TD7715' }),
  ])
  const res = matchCandidates(
    receipt({ amount_paise: 764400, note_numbers: ['9044'] }), idx)
  eq('the plate tail finds the right truck', res.candidates.length, 1)
  eq('...even though the amount does not match', res.candidates[0].vehicle_reg_no, 'GJ15AV9044')
  ok('and the signal is named', res.candidates[0].signals.some((s) => s.signal === 'reg_last4'))
}
{
  const idx = buildCandidateIndex([invoice({ vehicle_reg_no: 'DD01C9924', total_paise: 500000 })])
  const res = matchCandidates(receipt({ amount_paise: 500000, reg_nos: ['DD01C9924'] }), idx)
  ok('a full registration outranks the tail', res.candidates[0].signals.some((s) => s.signal === 'reg_full'))
}
{
  // A four-digit tail is not unique. Two trucks can share it, and the screen
  // must show both rather than pick.
  const idx = buildCandidateIndex([
    invoice({ total_paise: 500000, vehicle_reg_no: 'GJ15AV9044', customer_name: 'A TRANSPORT' }),
    invoice({ total_paise: 600000, vehicle_reg_no: 'MH12XY9044', customer_name: 'B ROADLINES' }),
  ])
  const res = matchCandidates(receipt({ amount_paise: 111100, note_numbers: ['9044'] }), idx)
  eq('two trucks sharing a plate tail both appear', res.candidates.length, 2)
}

// ════════════════════════════════════════════════════════════════════════════
section('amount — unique vs one of many')

{
  const idx = buildCandidateIndex([
    invoice({ total_paise: 193000 }), invoice({ total_paise: 193000 }),
    invoice({ total_paise: 193000 }), invoice({ total_paise: 193000 }),
  ])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx)
  eq('all four ₹1,930 bills are shown', res.candidates.length, 4)
  ok('each is marked ambiguous', res.candidates.every((c) =>
    c.signals.some((s) => s.signal === 'amount_ambiguous')))
  ok('and the list is NOT ranked', res.refuse_to_rank)
  ok('nor is it confident', !res.confident)
  ok('and it says why', res.reason.includes('equally likely'))
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000 }), invoice({ total_paise: 500000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx)
  ok('a lone match at that amount is unique', res.candidates[0].signals.some((s) => s.signal === 'amount_unique'))
  ok('and confident', res.confident)
}
{
  // Outstanding, not face value: a part-paid bill matches the REMAINDER.
  const idx = buildCandidateIndex([invoice({ total_paise: 500000, allocated_paise: 307000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx)
  eq('a part-paid bill matches on what is still owed', res.candidates.length, 1)
  eq('and shows the remainder', res.candidates[0].amount_paise, 193000)
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 500000, allocated_paise: 500000 })])
  eq('a fully settled bill leaves the index', idx.docCount, 0)
}

// ════════════════════════════════════════════════════════════════════════════
section('a job that billed as two invoices')

{
  // Measured: 245 of 836 orders split into parts + labour, and the customer
  // pays the combined total. An invoice-only index shows "no match" for the
  // most ordinary case there is.
  const idx = buildCandidateIndex([
    invoice({ job_ref: '7008034213', total_paise: 47200, invoice_number: 'LCS5756260000440' }),
    invoice({ job_ref: '7008034213', total_paise: 757400, invoice_number: 'PCS5756260000577' }),
  ])
  eq('the order becomes a third candidate', idx.docCount, 3)
  const res = matchCandidates(receipt({ amount_paise: 804600 }), idx)
  eq('paying the combined total matches the ORDER', res.candidates[0].kind, 'job')
  eq('and it carries both invoices', res.candidates[0].invoice_ids.length, 2)
}
{
  const idx = buildCandidateIndex([invoice({ job_ref: '7008034213', total_paise: 47200 })])
  eq('a single-invoice order gets no job candidate', idx.docCount, 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('payer memory')

{
  const inv1 = invoice({ total_paise: 193000, sap_customer_code: 'C-AVENUE' })
  const inv2 = invoice({ total_paise: 193000, sap_customer_code: 'C-OTHER' })
  const idx = buildCandidateIndex([inv1, inv2])
  const r = receipt({ amount_paise: 193000, payer_name: 'RAMESH SHARMA', normalized_payer_name: 'RAMESH SHARMA' })
  const res = matchCandidates(r, idx, {
    payerMemory: [{ normalized_payer_name: 'RAMESH SHARMA', sap_customer_code: 'C-AVENUE', confirm_count: 4, contradiction_count: 0 }],
  })
  eq('memory breaks a same-amount tie', res.candidates[0].sap_customer_code, 'C-AVENUE')
  ok('and is named', res.candidates[0].signals.some((s) => s.signal === 'payer_memory'))
  ok('so the list is ranked again', !res.refuse_to_rank)
}
{
  const idx = buildCandidateIndex([
    invoice({ total_paise: 193000, sap_customer_code: 'C-A' }),
    invoice({ total_paise: 193000, sap_customer_code: 'C-B' }),
  ])
  const res = matchCandidates(
    receipt({ amount_paise: 193000, payer_name: 'X', normalized_payer_name: 'X' }), idx,
    { payerMemory: [{ normalized_payer_name: 'X', sap_customer_code: 'C-A', confirm_count: 1, contradiction_count: 0 }] })
  ok('ONE past confirmation is only a weak hint', res.candidates[0].signals.some((s) => s.signal === 'payer_memory_weak'))
  ok('and does not make it confident', !res.confident)
}
{
  const idx = buildCandidateIndex([
    invoice({ total_paise: 193000, sap_customer_code: 'C-A' }),
    invoice({ total_paise: 193000, sap_customer_code: 'C-B' }),
  ])
  const res = matchCandidates(
    receipt({ amount_paise: 193000, payer_name: 'X', normalized_payer_name: 'X' }), idx,
    { payerMemory: [{ normalized_payer_name: 'X', sap_customer_code: 'C-A', confirm_count: 5, contradiction_count: 2 }] })
  ok('a contradicted memory is demoted to weak', res.candidates[0].signals.some((s) => s.signal === 'payer_memory_weak'))
}

// ════════════════════════════════════════════════════════════════════════════
section('the date window, and the stale-feed brake')

{
  const idx = buildCandidateIndex([
    invoice({ total_paise: 193000, invoice_date: '2026-08-10' }),
    invoice({ total_paise: 193000, invoice_date: '2026-08-01' }),
  ])
  const res = matchCandidates(receipt({ amount_paise: 193000, received_at: '2026-08-10T06:00:00Z' }), idx)
  eq('a bill nine days earlier is outside the window', res.candidates.length, 1)
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000, invoice_date: '2026-08-07' })])
  const res = matchCandidates(receipt({ amount_paise: 193000, received_at: '2026-08-10T06:00:00Z' }), idx)
  eq('exactly three days is still inside', res.candidates.length, 1)
}
{
  // A stale invoice feed plus one-tap confirm is an error amplifier: the bill
  // that would have matched may simply not have imported yet.
  const idx = buildCandidateIndex([invoice({ total_paise: 193000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx, { feedIsStale: true })
  ok('a stale feed refuses confidence', !res.confident)
  ok('and says why', res.reason.includes('out of date'))
  eq('but candidates are still shown', res.candidates.length, 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('names never count against a candidate')

{
  // A driver settling his employer's bill shares no name with the firm. That
  // is the normal case here, not an anomaly.
  const idx = buildCandidateIndex([invoice({ total_paise: 193000, customer_name: 'AVENUE ROADWAYS' })])
  const res = matchCandidates(
    receipt({ amount_paise: 193000, payer_name: 'RAMESH SHARMA', normalized_payer_name: 'RAMESH SHARMA' }), idx)
  eq('a mismatched name does not remove the candidate', res.candidates.length, 1)
  ok('and does not reduce its score below the amount signal',
     res.candidates[0].score >= WEIGHTS.AMOUNT_UNIQUE)
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000, customer_name: null })])
  const res = matchCandidates(
    receipt({ amount_paise: 193000, payer_name: 'ANYONE', normalized_payer_name: 'ANYONE' }), idx)
  eq('a bill with no customer name still matches on amount', res.candidates.length, 1)
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000, payer_name: null }), idx)
  eq('a receipt with no payer name still works', res.candidates.length, 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('shape of the answer')

{
  const idx = buildCandidateIndex(Array.from({ length: 30 }, () => invoice({ total_paise: 193000 })))
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx, { limit: 5 })
  eq('the list is capped', res.candidates.length, 5)
  ok('and unranked when everything ties', res.refuse_to_rank)
  ok('so no candidate claims a rank', res.candidates.every((c) => c.rank === null))
}
{
  const idx = buildCandidateIndex([invoice({ total_paise: 193000 }), invoice({ total_paise: 500000 })])
  const res = matchCandidates(receipt({ amount_paise: 193000 }), idx)
  eq('a ranked list numbers from 1', res.candidates[0].rank, 1)
  eq('and reports what was searched', res.searched, idx.docCount)
}
{
  const idx = buildCandidateIndex([invoice({ status: 'parked', total_paise: 193000 })])
  eq('parked bills (parts returns) are never candidates', idx.docCount, 0)
}
{
  const idx = buildCandidateIndex([invoice({ status: 'not_payable', total_paise: 0 })])
  eq('free-of-cost bills are never candidates', idx.docCount, 0)
}
{
  const idx = buildCandidateIndex([invoice({ status: 'pre_opening', total_paise: 193000 })])
  eq('pre-opening bills are never candidates', idx.docCount, 0)
}

ok('tie epsilon is small enough to be meaningful', TIE_EPSILON > 0 && TIE_EPSILON < 20)

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
