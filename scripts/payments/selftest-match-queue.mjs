// The Match screen's decisions — who works which receipt, in what order, how a
// confirm splits across bills, and when to brake — checked without a browser.
//
//   npx esbuild scripts/payments/selftest-match-queue.mjs --bundle \
//     --platform=node --format=esm --outfile=<tmp>/q.mjs && node <tmp>/q.mjs
//
// Bundled because matchQueue.js imports the Edge Function's authority.ts —
// deliberately, so the screen and the server share one set of rules.
//
// Expectations are written out by hand. Where a rule comes from the plan, the
// test says which rule.

import {
  capabilitiesFor, toMatchReceipt, orderQueue, invoiceWindow, attachCustomerCodes,
  memoryForMatcher, allocationTargets, matchSignalOf, feedIsStaleFor, searchCandidates,
  parseSearch, splitWaiting, searchPickCandidates, windowDaysFor, undoneByReceipt, undoneNote,
  groupMatches, istDayStart, confirmPlan,
} from '../../src/service-payments/lib/matchQueue.js'
import { buildCandidateIndex, matchCandidates } from '../../src/service-payments/lib/matchCandidates.js'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (name, a, b) =>
  ok(name, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
const throws = (name, fn, re) => {
  try { fn(); ok(name, false, 'did not throw') } catch (e) { ok(name, re.test(e.message), e.message) }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`)

// ════════════════════════════════════════════════════════════════════════════
section('who may do what — the screen offers exactly what the server accepts')
{
  const who = (level, dept) => capabilitiesFor({ permission_level: level, is_active: true }, dept)
  const se = who('executive', 'service')
  ok('a service executive matches', se.canMatch)
  ok('...UPI only', se.canMatchMode('upi') && !se.canMatchMode('cash') && !se.canMatchMode('cheque'))
  ok('...and does not classify money as not-service', !se.canClassify)
  const sg = who('gm', 'service')
  ok('a service GM still does not classify (accounts-only in the plan)', !sg.canClassify)
  ok('...nor match cash', !sg.canMatchMode('cash'))
  const ae = who('executive', 'accounts')
  ok('an accounts executive matches any mode and classifies',
     ae.canMatch && ae.canClassify && ae.canMatchMode('cash') && ae.canMatchMode('netbanking'))
  const ad = who('admin', null)
  ok('the admin with no department can do all of it', ad.canMatch && ad.canClassify && ad.canMatchMode('cheque'))
  for (const [level, dept] of [['manager', 'sales'], ['gm', 'sales'], ['gm', 'back_office'],
                               ['manager', 'hr'], ['executive', 'spares'], ['gm', null]]) {
    ok(`a ${dept ?? 'no-department'} ${level} gets no Match screen`, !who(level, dept).canMatch)
  }
  ok('a missing profile gets nothing', !capabilitiesFor(null, null).canMatch)
  // Import: accounts and the admin (pilot), nobody else — not even a service GM.
  ok('accounts at any rank may import', ['executive', 'manager', 'gm'].every((l) => who(l, 'accounts').canImport))
  ok('the admin may import', ad.canImport)
  ok('service staff at every rank may NOT import', ['executive', 'manager', 'gm'].every((l) => !who(l, 'service').canImport))
  ok('nobody outside payments may import', !who('gm', 'sales').canImport && !who('manager', 'hr').canImport)
}

// ════════════════════════════════════════════════════════════════════════════
section('a receipt is matched on what is still OPEN on it')
{
  const r = toMatchReceipt({
    id: 'r1', amount_paise: 1000000, allocated_paise: 600000, open_paise: 400000,
    payer_name: 'Mr. Narender  Yadav', payer_remark: 'GJ15AV 9044 bill', received_at: '2026-08-10T04:00:00Z',
  })
  eq('the amount offered to the matcher is the remainder', r.amount_paise, 400000)
  eq('the face value is kept for the screen', r.face_paise, 1000000)
  ok('and it is flagged part-matched', r.partly_matched)
  ok('the plate in the note is extracted', r.reg_nos.includes('GJ15AV9044'))
  ok('the number in the note is extracted', r.note_numbers.includes('9044'))
  eq('the payer name is normalised for memory lookup', r.normalized_payer_name, 'NARENDER YADAV')
  const fresh = toMatchReceipt({ id: 'r2', amount_paise: 193000, allocated_paise: 0, received_at: 'x' })
  ok('an untouched receipt is not part-matched', !fresh.partly_matched && fresh.amount_paise === 193000)
  const noView = toMatchReceipt({ id: 'r3', amount_paise: 500, allocated_paise: 200 })
  eq('open is derived when the view column is absent', noView.amount_paise, 300)
}

// ════════════════════════════════════════════════════════════════════════════
section('queue order: oldest first, skipped to the back in skip order')
{
  const rs = [
    { id: 'c', received_at: '2026-08-10T09:00:00Z' },
    { id: 'a', received_at: '2026-08-09T09:00:00Z' },
    { id: 'b', received_at: '2026-08-09T09:00:00Z' },
    { id: 'd', received_at: '2026-08-11T09:00:00Z' },
  ]
  eq('oldest first, ties broken by id so the order never jitters',
     orderQueue(rs).map((r) => r.id), ['a', 'b', 'c', 'd'])
  eq('skipped ones go to the back, in the order they were skipped',
     orderQueue(rs, ['c', 'a']).map((r) => r.id), ['b', 'd', 'c', 'a'])
  eq('the input is not mutated', rs.map((r) => r.id), ['c', 'a', 'b', 'd'])
}

// ════════════════════════════════════════════════════════════════════════════
section('which bills to fetch: IST days, widened by the window')
{
  eq('nothing to match fetches nothing', invoiceWindow([], 3), null)
  eq('one morning receipt', invoiceWindow([{ received_at: '2026-08-10T04:00:00Z' }], 3),
     { from: '2026-08-07', to: '2026-08-13' })
  eq('a 01:30 IST payment is dated by IST, not UTC',
     invoiceWindow([{ received_at: '2026-08-10T20:00:00Z' }], 3), { from: '2026-08-08', to: '2026-08-14' })
  eq('the span covers the oldest and newest receipt',
     invoiceWindow([{ received_at: '2026-08-12T04:00:00Z' }, { received_at: '2026-07-30T04:00:00Z' }], 3),
     { from: '2026-07-27', to: '2026-08-15' })
  eq('a month boundary is crossed in the calendar',
     invoiceWindow([{ received_at: '2026-03-01T04:00:00Z' }], 3), { from: '2026-02-26', to: '2026-03-04' })
  eq('an unreadable time is skipped, not fatal',
     invoiceWindow([{ received_at: 'garbage' }, { received_at: '2026-08-10T04:00:00Z' }], 0),
     { from: '2026-08-10', to: '2026-08-10' })
}

// ════════════════════════════════════════════════════════════════════════════
section('one confirm, split across a parts + labour pair')
{
  const bills = [
    { id: 'L', invoice_number: 'LCR5756260000100', payment_terms: 'credit', invoice_date: '2026-08-09', total_paise: 300000, allocated_paise: 0 },
    { id: 'P', invoice_number: 'PCS5756260000200', payment_terms: 'cash',   invoice_date: '2026-08-10', total_paise: 500000, allocated_paise: 0 },
  ]
  const byId = new Map(bills.map((b) => [b.id, b]))
  const job = { id: 'job:1', invoice_ids: ['L', 'P'] }

  eq('paid in full: each bill at its exact open amount, CASH-TERMS FIRST even though the credit bill is older',
     allocationTargets(job, byId, 800000),
     [{ invoice_id: 'P', amount_paise: 500000 }, { invoice_id: 'L', amount_paise: 300000 }])
  eq('paid short: the cash bill is settled, the credit bill part-paid',
     allocationTargets(job, byId, 600000),
     [{ invoice_id: 'P', amount_paise: 500000 }, { invoice_id: 'L', amount_paise: 100000 }])
  eq('paid less than the cash bill: only the cash bill is touched',
     allocationTargets(job, byId, 200000), [{ invoice_id: 'P', amount_paise: 200000 }])
  eq('overpaid: never more than the bills owe — the surplus stays on the receipt',
     allocationTargets(job, byId, 900000),
     [{ invoice_id: 'P', amount_paise: 500000 }, { invoice_id: 'L', amount_paise: 300000 }])

  const partly = new Map([['X', { id: 'X', invoice_number: 'MPI1', payment_terms: 'cash', invoice_date: '2026-08-10', total_paise: 193000, allocated_paise: 93000 }]])
  eq('an already part-paid bill takes only what it still owes',
     allocationTargets({ id: 'X', invoice_ids: ['X'] }, partly, 193000), [{ invoice_id: 'X', amount_paise: 100000 }])

  throws('a bill that vanished from the open list refuses, rather than allocating half a job',
    () => allocationTargets({ id: 'job:2', invoice_ids: ['P', 'GONE'] }, byId, 800000), /no longer open/)
  const paid = new Map([['Z', { id: 'Z', payment_terms: 'cash', total_paise: 1000, allocated_paise: 1000 }]])
  throws('a bill with nothing left owing refuses', () => allocationTargets({ id: 'Z', invoice_ids: ['Z'] }, paid, 500), /Nothing left/)

  // The two invariants the RPC also enforces, checked over many shapes.
  let violations = 0
  for (let i = 0; i < 2000; i++) {
    const n = 1 + (i % 4)
    const set = Array.from({ length: n }, (_, k) => {
      const total = 1000 + ((i * 7919 + k * 104729) % 500000)
      return { id: `b${k}`, invoice_number: `N${k}`, payment_terms: (i + k) % 2 ? 'cash' : 'credit',
               invoice_date: `2026-08-1${k}`, total_paise: total, allocated_paise: (i * k * 31) % Math.floor(total / 2) }
    })
    const m = new Map(set.map((b) => [b.id, b]))
    const receipt = 1 + ((i * 15485863) % 900000)
    const t = allocationTargets({ id: 'j', invoice_ids: set.map((b) => b.id) }, m, receipt)
    const sum = t.reduce((a, x) => a + x.amount_paise, 0)
    if (sum > receipt) violations++
    for (const x of t) {
      const b = m.get(x.invoice_id)
      if (x.amount_paise <= 0 || x.amount_paise > b.total_paise - b.allocated_paise) violations++
    }
    const cashIdx = t.map((x) => m.get(x.invoice_id).payment_terms)
    if (cashIdx.lastIndexOf('cash') > cashIdx.indexOf('credit') && cashIdx.includes('credit')) violations++
  }
  eq('2,000 shapes: never over the receipt, never over a bill, never a credit bill before a cash one', violations, 0)

  // R4-6 / R4-12: the picked card SAYS what Confirm does. The sentence must
  // describe exactly the split Confirm sends, or it is a lie told at the
  // moment of deciding. Same 2,000 shapes, both paths, bill by bill.
  let lies = 0
  for (let i = 0; i < 2000; i++) {
    const n = 1 + (i % 4)
    const set = Array.from({ length: n }, (_, k) => {
      const total = 1000 + ((i * 7919 + k * 104729) % 500000)
      return { id: `b${k}`, invoice_number: `N${k}`, payment_terms: (i + k) % 2 ? 'cash' : 'credit',
               invoice_date: `2026-08-1${k}`, total_paise: total, allocated_paise: (i * k * 31) % Math.floor(total / 2),
               invoice_kind: k % 2 ? 'service_labour' : 'service_parts' }
    })
    const m = new Map(set.map((b) => [b.id, b]))
    const receipt = 1 + ((i * 15485863) % 900000)
    const cand = { id: 'j', invoice_ids: set.map((b) => b.id), members: set }
    const sent = allocationTargets(cand, m, receipt)
    const plan = confirmPlan(cand, receipt)
    const sentSum = sent.reduce((a, x) => a + x.amount_paise, 0)
    const owed = set.reduce((a, b) => a + b.total_paise - b.allocated_paise, 0)
    if (JSON.stringify(plan.takes) !== JSON.stringify(sent)) lies++
    if (plan.placing !== sentSum) lies++
    if (plan.stillDue !== owed - sentSum) lies++
    if (plan.leftOnPayment !== receipt - sentSum) lies++
    if (!plan.button.startsWith('Confirm ')) lies++
  }
  eq('2,000 shapes: the card\'s split = what Confirm sends, BILL BY BILL; and placed, still due, left over', lies, 0)
}

section('R4-6 / R4-12 — the words on the picked card and the button')
{
  const bill = (id, o = {}) => ({ id, invoice_number: id, invoice_kind: 'counter_sale', payment_terms: 'cash',
    invoice_date: '2026-10-08', total_paise: 193000, allocated_paise: 0, ...o })
  const one = (b) => ({ id: b.id, invoice_ids: [b.id], members: [b], amount_paise: b.total_paise - b.allocated_paise })
  let p = confirmPlan(one(bill('A')), 193000)
  eq('one bill, paid exactly: no extra line, a plain button', [p.line, p.button], ['', 'Confirm ₹1,930'])
  p = confirmPlan(one(bill('B', { total_paise: 2500000, payment_terms: 'credit' })), 1000000)
  eq('one bill, part paid: says what stays due and that the bill stays open (R4-6)',
     [p.line, p.button],
     ['₹10,000 of ₹25,000 — ₹15,000 stays due, the bill stays open', 'Confirm ₹10,000 · ₹15,000 still due'])
  p = confirmPlan(one(bill('C', { total_paise: 100000 })), 150000)
  eq('one bill, more money than it owes: says the rest stays on the payment',
     [p.line, p.button], ['Closes the bill · ₹500 of the payment stays, to place on another bill', 'Confirm ₹1,000'])

  const parts = bill('PCS1', { invoice_kind: 'service_parts', total_paise: 615000, invoice_date: '2026-10-08' })
  const labour = bill('LCS2', { invoice_kind: 'service_labour', total_paise: 550000, invoice_date: '2026-10-08' })
  const order = { id: 'job:J', kind: 'job', invoice_ids: ['PCS1', 'LCS2'], members: [labour, parts], amount_paise: 1165000 }
  p = confirmPlan(order, 1165000)
  eq('an order paid in full: both bills by name and amount, the sum, "both bills close" (R4-12)',
     [p.line, p.button], ['Labour ₹5,500 + Parts ₹6,150 = ₹11,650 · both bills close', 'Confirm ₹11,650 · 2 bills'])
  p = confirmPlan(order, 1000000)
  eq('an order paid short: which closes, which is part paid, what stays due',
     [p.line, p.button],
     ['Labour ₹5,500 closes · Parts ₹4,500 of ₹6,150 — ₹1,650 stays due', 'Confirm ₹10,000 · ₹1,650 still due'])
  p = confirmPlan(order, 300000)
  eq('an order paid very short: the bill not reached says "not paid"',
     p.line, 'Labour ₹3,000 of ₹5,500 · Parts ₹6,150 not paid — ₹8,650 stays due')
  p = confirmPlan({ ...order, members: [labour, parts, bill('PCS3', { invoice_kind: 'service_parts', total_paise: 10000 })] }, 1200000)
  ok('three bills, all paid, money over: "all 3 bills close" and the rest stays on the payment',
     /all 3 bills close · ₹250 of the payment stays/.test(p.line), p.line)
  eq('a bill of an unknown kind is named by its number',
     confirmPlan({ ...order, members: [bill('X1', { invoice_kind: null, total_paise: 100 }), bill('X2', { invoice_kind: null, total_paise: 100 })] }, 200).line,
     'Bill X1 ₹1 + Bill X2 ₹1 = ₹2 · both bills close')
  eq('a candidate without its bills says no more than it knows',
     confirmPlan({ id: 'q', amount_paise: 50000 }, 80000), { line: '', button: 'Confirm ₹500', placing: 50000, stillDue: 0, leftOnPayment: 0, takes: null })
}

// ════════════════════════════════════════════════════════════════════════════
section('the stale-bills brake fails CLOSED')
{
  const r = { received_at: '2026-08-10T10:00:00Z' }
  ok('no bill import ever: stale', feedIsStaleFor(r, null))
  ok('bills landed after the payment: fresh', !feedIsStaleFor(r, { covered_until: '2026-08-11T03:30:00Z' }))
  ok('bills last landed before the payment: stale', feedIsStaleFor(r, { covered_until: '2026-08-10T09:59:00Z' }))
  ok('an unreadable coverage time: stale', feedIsStaleFor(r, { covered_until: 'soon' }))
  ok('an unreadable payment time: stale', feedIsStaleFor({ received_at: null }, { covered_until: '2026-08-11T00:00:00Z' }))
}

// ════════════════════════════════════════════════════════════════════════════
section('what the search box means')
{
  eq('"9044" is searched as money AND as a plate / bill fragment',
     parseSearch('9044'), { kind: 'number', paise: 904400, text: '9044' })
  eq('"1,930" likewise', parseSearch('1,930'), { kind: 'number', paise: 193000, text: '1930' })
  eq('paise make it money only', parseSearch('1930.50'), { kind: 'number', paise: 193050, text: null })
  eq('so does a rupee sign', parseSearch('₹1,930'), { kind: 'number', paise: 193000, text: null })
  eq('a name is text', parseSearch('  Sharma  '), { kind: 'text', text: 'Sharma' })
  eq('a plate is text', parseSearch('GJ15AV9044'), { kind: 'text', text: 'GJ15AV9044' })
  // Red team 4 (R4-20): two digits matched nearly every bill number mid-typing.
  eq('two digits are an amount only, never a bill/plate fragment', parseSearch('19'), { kind: 'number', paise: 1900, text: null })
  eq('three digits are a fragment again', parseSearch('904'), { kind: 'number', paise: 90400, text: '904' })
  eq('one character is not a search', parseSearch('a'), null)
  eq('empty is not a search', parseSearch(''), null)
  const hostile = parseSearch('x"),total_paise.gt.0,(y*%_')
  ok('filter syntax cannot be smuggled in: no quote, comma or parenthesis survives',
     hostile && !/[",()*%_]/.test(hostile.text), JSON.stringify(hostile))
  eq('punctuation alone is not a search', parseSearch('",()'), null)
}

// ════════════════════════════════════════════════════════════════════════════
section('codes, memory, search results and the audit signal')
{
  const customers = [{ id: 'c1', sap_customer_code: '0011290297' }]
  const inv = attachCustomerCodes([{ id: 'i1', customer_id: 'c1' }, { id: 'i2', customer_id: 'c9' }], customers)
  eq('a bill gets its customer code', inv[0].sap_customer_code, '0011290297')
  eq('an unknown customer gets null, not a crash', inv[1].sap_customer_code, null)

  const mem = memoryForMatcher([{ customer_id: 'c1', confirm_count: 3 }, { customer_id: 'c9', confirm_count: 9 }], customers)
  eq('memory is keyed by SAP code, and a customer we cannot name is dropped', mem.map((m) => m.sap_customer_code), ['0011290297'])

  const sc = searchCandidates([{ id: 'i1', invoice_number: 'MPI1', total_paise: 193000, allocated_paise: 3000, invoice_date: '2026-08-10' }])
  eq('a search result offers what is still owed', sc[0].amount_paise, 190000)
  eq('and says a person found it', sc[0].signals[0].signal, 'search')
  eq('and is never ranked', sc[0].rank, null)
  eq('a search pick is recorded as a search in the audit trail', matchSignalOf(sc[0]), 'search')

  eq('the strongest signal is recorded, not the first listed',
     matchSignalOf({ signals: [{ signal: 'date' }, { signal: 'amount_ambiguous' }, { signal: 'reg_last4' }] }), 'reg_last4')
  eq('date alone is never recorded as the reason', matchSignalOf({ signals: [{ signal: 'date' }] }), null)
}

// ════════════════════════════════════════════════════════════════════════════
section('"bill not raised yet" — who may say it, and when a waiting payment comes back')
{
  const who = (level, dept) => capabilitiesFor({ permission_level: level, is_active: true }, dept)
  // Moves no money, so it follows matching (plan: "Allocate UPI: service, accounts").
  ok('a service executive may say it for UPI', who('executive', 'service').canMarkWaiting('upi'))
  ok('...not for cash — that money is accounts\' to place', !who('executive', 'service').canMarkWaiting('cash'))
  ok('accounts may say it for cash', who('executive', 'accounts').canMarkWaiting('cash'))
  ok('a Sales manager may not say it at all', !who('manager', 'sales').canMarkWaiting('upi'))

  const MARKED = '2026-10-10T06:00:00.000Z'
  const bills = new Map([
    ['old', { id: 'old', created_at: '2026-10-09T18:00:00.000Z' }],   // there when it was marked
    ['new', { id: 'new', created_at: '2026-10-11T18:00:00.000Z' }],   // imported since
  ])
  const r = (id, o = {}) => ({ id, awaiting_invoice: true, awaiting_since: MARKED, ...o })
  const cands = { a: [{ invoice_ids: ['old'] }], b: [{ invoice_ids: ['old'] }, { invoice_ids: ['new'] }],
                  c: [], d: [{ invoice_ids: ['old', 'new'] }] }
  const split = (rs) => splitWaiting(rs, (x) => cands[x.id] ?? [], bills)

  let s = split([{ id: 'n', awaiting_invoice: false }])
  eq('an ordinary payment is in today\'s list', [s.queue.length, s.waiting.length], [1, 0])
  s = split([r('a')])
  eq('marked while a ₹1,930 bill was already open: STAYS waiting (the person saw it and said no)',
     [s.queue.length, s.waiting.length], [0, 1])
  s = split([r('b')])
  ok('a bill imported SINCE it was marked: comes back, flagged', s.queue.length === 1 && s.queue[0].back_for_new_bill)
  s = split([r('c')])
  eq('no possible bill at all: stays waiting', [s.queue.length, s.waiting.length], [0, 1])
  s = split([r('d')])
  ok('a parts+labour pair with one new bill in it: comes back', s.queue.length === 1)
  s = split([r('a', { awaiting_since: null })])
  ok('no record of when it was marked: comes back (one extra look beats never)', s.queue.length === 1)
  s = split([r('b'), r('a'), { id: 'n', awaiting_invoice: false }])
  eq('mixed: two in the list, one waiting', [s.queue.map((x) => x.id).sort(), s.waiting.map((x) => x.id)], [['b', 'n'], ['a']])
}

// ════════════════════════════════════════════════════════════════════════════
section('an ADVANCE paid days before its bill still comes back')
{
  const TODAY = '2026-10-10'
  const paid = (o = {}) => ({ id: 'adv', received_at: '2026-10-01T05:00:00.000Z', awaiting_invoice: true,
    awaiting_since: '2026-10-01T06:00:00.000Z', amount_paise: 1500000, payer_name: 'DEMO ADVANCE',
    normalized_payer_name: 'DEMO ADVANCE', note_numbers: [], reg_nos: [], ...o })
  eq('an ordinary payment keeps the usual window', windowDaysFor({ received_at: '2026-10-01T05:00:00Z' }, TODAY, 3), 3)
  eq('a waiting one looks from its own day up to today (9 days)', windowDaysFor(paid(), TODAY, 3), 9)
  eq('...never less than the usual window', windowDaysFor(paid({ received_at: '2026-10-09T05:00:00Z' }), TODAY, 3), 3)
  eq('...and at most about a quarter', windowDaysFor(paid({ received_at: '2026-01-01T05:00:00Z' }), TODAY, 3), 90)

  eq('the bills fetched for an ordinary queue stop 3 days after the last payment',
     invoiceWindow([{ received_at: '2026-10-01T05:00:00Z' }], 3, { today: TODAY }), { from: '2026-09-28', to: '2026-10-04' })
  eq('...but reach today when a payment is waiting',
     invoiceWindow([paid()], 3, { today: TODAY }), { from: '2026-09-28', to: TODAY })

  // The real shape: a ₹15,000 advance on the 1st, its bill raised on the 10th.
  const bill = { id: 'B', invoice_number: 'B', invoice_date: TODAY, total_paise: 1500000, allocated_paise: 0,
    status: 'active', customer_name: 'DEMO ADVANCE', created_at: '2026-10-10T12:00:00.000Z' }
  const idx = buildCandidateIndex([bill])
  const back = (days) => splitWaiting([paid()], (r) => matchCandidates(r, idx, { windowDays: days(r) }).candidates,
    new Map([['B', bill]]))
  ok('with the waiting window, the advance comes back for its bill', back((r) => windowDaysFor(r, TODAY, 3)).queue.length === 1)
  ok('...with only the usual 3 days it would NEVER come back', back(() => 3).waiting.length === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('a bill found by SEARCH brings its order partner (parts + labour)')
{
  const bill = (id, rupees, o = {}) => ({ id, invoice_number: id, total_paise: rupees * 100, allocated_paise: 0,
    invoice_date: '2026-10-07', customer_name: 'DEMO FLEET', job_ref: 'J1', ...o })
  const parts = bill('PCS1', 8450), labour = bill('LCS1', 3200)

  let c = searchPickCandidates(parts, [parts, labour], 1165000)
  eq('paid ₹11,650 = the pair: the whole order is offered FIRST', c.map((x) => x.kind), ['job', 'invoice'])
  eq('...covering both bills, at their sum', [c[0].invoice_ids.sort(), c[0].amount_paise, c[0].member_count],
     [['LCS1', 'PCS1'], 1165000, 2])
  ok('...and it is still marked as found by search, not as a suggestion', c[0].signals[0].signal === 'search' && c[0].rank === null)
  eq('...confirming it pays both bills in full',
     allocationTargets(c[0], new Map([parts, labour].map((v) => [v.id, v])), 1165000).map((t) => [t.invoice_id, t.amount_paise]).sort(),
     [['LCS1', 320000], ['PCS1', 845000]])

  c = searchPickCandidates(parts, [parts, labour], 845000)
  eq('paid ₹8,450 = the parts bill alone: that bill first, the order second', c.map((x) => x.kind), ['invoice', 'job'])
  eq('a bill with no partner: offered alone, as before', searchPickCandidates(parts, [parts], 845000).length, 1)
  eq('a bill with no order number: alone', searchPickCandidates(bill('MPI1', 1930, { job_ref: null }), [], 193000).length, 1)
  eq('the partner list need not include the picked bill',
     searchPickCandidates(parts, [labour], 1165000)[0].invoice_ids.sort(), ['LCS1', 'PCS1'])
  eq('a part-paid partner counts only what it still owes',
     searchPickCandidates(parts, [{ ...labour, allocated_paise: 100000 }], 1065000)[0].amount_paise, 1065000)
}

// ════════════════════════════════════════════════════════════════════════════
section('undone matches — remembered per payment (pre-mortem F1)')
{
  const rows = [
    { receipt_id: 'r1', invoice_id: 'A', reversed_at: '2026-10-10T05:00:00.000Z', reverse_reason: 'Wrong customer' },
    { receipt_id: 'r1', invoice_id: 'A', reversed_at: '2026-10-12T20:00:00.000Z', reverse_reason: 'Still wrong' },
    { receipt_id: 'r1', invoice_id: 'B', reversed_at: '2026-10-11T05:00:00.000Z', reverse_reason: null },
    { receipt_id: 'r2', invoice_id: 'A', reversed_at: '2026-10-11T05:00:00.000Z', reverse_reason: 'x' },
    { receipt_id: 'r3', invoice_id: 'C', reversed_at: null },   // not undone: ignored
  ]
  const m = undoneByReceipt(rows)
  eq('grouped by payment, one entry per bill, newest first',
     m.get('r1').map((u) => [u.invoice_id, u.reverse_reason]), [['A', 'Still wrong'], ['B', '']])
  ok('another payment\'s undo is its own', m.get('r2').length === 1 && !m.has('r3'))
  eq('nothing in, nothing out', undoneByReceipt(undefined).size, 0)

  // 20:00 UTC on the 12th is 01:30 on the 13th in India.
  eq('a search pick of that bill says so, with the IST day and the reason',
     undoneNote(m.get('r1'), ['A']),
     'This payment was taken off this bill before on 13 Oct ("Still wrong"). Check it is really the one before you confirm again.')
  ok('...also when the bill is one of the picked order\'s bills', /taken off this bill before/.test(undoneNote(m.get('r1'), ['Z', 'B'])))
  eq('...and says nothing for a bill it was never taken off', undoneNote(m.get('r1'), ['Z']), '')
  eq('...or for a payment with no undo', undoneNote(undefined, ['A']), '')
  ok('an unreadable time drops the date, never the warning',
     /^This payment was taken off this bill before\. /.test(undoneNote([{ invoice_id: 'A', reversed_at: 'garbage', reverse_reason: '' }], ['A'])))

  // A waiting payment must not come back for the bill it was taken off: the
  // person said "not this one" about it, which "bill imported since" would
  // otherwise overrule every morning.
  const MARKED = '2026-10-10T06:00:00.000Z'
  const bill = { id: 'N', invoice_number: 'MPI1', status: 'active', total_paise: 777700, allocated_paise: 0,
                 invoice_date: '2026-10-11', customer_name: 'QUICK FREIGHT', created_at: '2026-10-11T18:00:00.000Z' }
  const idx = buildCandidateIndex([bill])
  const r = toMatchReceipt({ id: 'w', amount_paise: 777700, allocated_paise: 0, received_at: '2026-10-08T06:00:00.000Z',
                             payer_name: 'QUICK FREIGHT', awaiting_invoice: true, awaiting_since: MARKED })
  const byId = new Map([[bill.id, bill]])
  const today = '2026-10-12'
  const withUndo = (und) => splitWaiting([r], (x) => matchCandidates(x, idx, {
    windowDays: windowDaysFor(x, today, 3), undone: und }).candidates, byId)
  ok('control: a new bill at its amount brings a waiting payment back', withUndo([]).queue.length === 1)
  ok('...but not the bill it was taken off', withUndo(['N']).queue.length === 0 && withUndo(['N']).waiting.length === 1)
}

// ════════════════════════════════════════════════════════════════════════════
section('undo — a slip or a re-split keeps the bill on offer (owner, 2026-10-13)')
{
  const row = (reason, at, inv = 'A') => ({ receipt_id: 'r', invoice_id: inv, reversed_at: at, reverse_reason: reason })
  let m = undoneByReceipt([row('Undo by mistake — offer it again', '2026-10-12T05:00:00Z')])
  ok('"Undo by mistake" does not hide the bill', !m.has('r'))
  m = undoneByReceipt([row('Match again with a different amount', '2026-10-12T05:00:00Z')])
  ok('"Match again with a different amount" does not hide the bill', !m.has('r'))
  m = undoneByReceipt([row('Wrong customer', '2026-10-12T05:00:00Z')])
  ok('"Wrong customer" hides it', m.get('r')?.[0]?.invoice_id === 'A')
  m = undoneByReceipt([row('Wrong customer', '2026-10-10T05:00:00Z'), row('Undo by mistake — offer it again', '2026-10-12T05:00:00Z')])
  ok('the NEWEST undo of a bill decides: a later slip puts it back on offer', !m.has('r'))
  m = undoneByReceipt([row('Undo by mistake — offer it again', '2026-10-10T05:00:00Z'), row('Wrong customer', '2026-10-12T05:00:00Z')])
  ok('...and a later "wrong" hides it again', m.get('r')?.length === 1)
  m = undoneByReceipt([row('Undo by mistake — offer it again', '2026-10-12T05:00:00Z'), row('Wrong bill — same amount', '2026-10-12T05:00:00Z', 'B')])
  eq('a slip on one bill does not unhide another', m.get('r').map((u) => u.invoice_id), ['B'])
  eq('a typed reason nobody listed hides it (the safe side)',
     undoneByReceipt([row('something else', '2026-10-12T05:00:00Z')]).get('r').length, 1)
}

section('"Matched today" — one row per confirm, whose, and who may undo')
{
  const who = (id, level, dept) => capabilitiesFor({ id, permission_level: level, is_active: true }, dept)
  const svc = who('u-svc', 'executive', 'service')
  const svc2 = who('u-svc2', 'executive', 'service')
  const acc = who('u-acc', 'executive', 'accounts')
  const gm = who('u-gm', 'gm', 'service')
  const a = (o) => ({ id: o.id, client_request_id: o.req ?? null, receipt_id: o.rcpt ?? 'r1', invoice_id: o.inv ?? 'i1',
    amount_paise: o.amt ?? 100000, allocated_at: o.at ?? '2026-10-13T04:00:00.000Z', allocated_by: o.by ?? 'u-svc',
    export_batch_id: o.exp ?? null, reversed_at: o.rev ?? null,
    receipt: { payer_name: o.payer ?? 'SURESH DESAI', mode: o.mode ?? 'upi' },
    invoice: { invoice_number: o.no ?? 'PCS1', customer_name: o.cust ?? 'DEMO FLEET CARRIERS' },
    maker: { full_name: o.maker ?? 'Ramesh' } })
  const rows = [
    a({ id: 'p', req: 'Q', amt: 845000, no: 'PCS1', at: '2026-10-13T04:00:00.000Z' }),
    a({ id: 'l', req: 'Q', amt: 320000, no: 'LCS2', at: '2026-10-13T04:00:00.000Z' }),
    a({ id: 'x', req: 'Z', amt: 193000, no: 'MPI9', cust: 'DEMO ASHA', by: 'u-svc2', maker: 'Mahesh', at: '2026-10-13T06:00:00.000Z' }),
    a({ id: 'g', req: 'G', amt: 50000, rev: '2026-10-13T07:00:00.000Z' }),
  ]
  const all = groupMatches(rows, acc)
  eq('accounts sees every confirm, newest first; an undone one is gone', all.map((g) => g.key), ['Z', 'Q'])
  const pair = all.find((g) => g.key === 'Q')
  eq('a parts + labour confirm is ONE row: both allocations, the sum, both bill numbers',
     [pair.allocation_ids, pair.amount_paise, pair.invoice_numbers, pair.bill_count], [['p', 'l'], 1165000, ['PCS1', 'LCS2'], 2])
  eq('a service executive sees only their own', groupMatches(rows, svc).map((g) => g.key), ['Q'])
  ok('...and may undo it (the maker, before export)', groupMatches(rows, svc)[0].refusal === null && groupMatches(rows, svc)[0].mine)
  eq('a GM sees everyone\'s', groupMatches(rows, gm).map((g) => g.key), ['Z', 'Q'])
  ok('accounts may undo anyone\'s before export', all.every((g) => g.refusal === null))
  ok('a colleague\'s match is not "mine", and names its maker', !all.find((g) => g.key === 'Z').mine || false)
  // The server's rule, not a copy of it: a non-maker service executive is refused.
  ok('the server rule refuses a colleague\'s match to a service executive',
     /Only the person who matched this/.test(svc2.undoRefusal({ maker_id: 'u-svc', exported: false }) ?? ''))
  const sent = groupMatches([a({ id: 'e', req: 'E', exp: 'batch-1' })], acc)[0]
  ok('once sent to Busy, accounts is refused and told a GM can', /already gone to Busy/.test(sent.refusal ?? ''))
  ok('...and a GM may', groupMatches([a({ id: 'e', req: 'E', exp: 'batch-1' })], gm)[0].refusal === null)
  eq('a row with no request id stands alone', groupMatches([a({ id: 'solo' }), a({ id: 'solo2' })], acc).length, 2)
  eq('nothing in, nothing out', groupMatches(undefined, acc), [])

  // 20:00 UTC on the 12th is 01:30 on the 13th in India: "today" began at
  // 18:30 UTC on the 12th, not at UTC midnight.
  eq('"today" starts at midnight India time', istDayStart('2026-10-12T20:00:00.000Z'), '2026-10-12T18:30:00.000Z')
  eq('"the last 7 days" = today and the six before', istDayStart('2026-10-12T20:00:00.000Z', 6), '2026-10-06T18:30:00.000Z')
}

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
