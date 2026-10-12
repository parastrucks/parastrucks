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
  parseSearch, splitWaiting, searchPickCandidates,
} from '../../src/service-payments/lib/matchQueue.js'

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

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
