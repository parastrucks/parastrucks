// The mobile contract for the Match screen, asserted rather than promised.
//
//   npx esbuild scripts/payments/selftest-mobile-render.mjs --bundle \
//     --platform=node --format=esm --jsx=automatic --outfile=<tmp>/mobile.mjs \
//   && node <tmp>/mobile.mjs
//
// React is bundled IN (no --packages=external) so the output runs from anywhere,
// including a scratch directory outside the repo. For the same reason the
// stylesheet is located from the working directory, not from import.meta.url —
// after bundling, that URL points at the bundle.
//
// Mobile web is the cornerstone of this feature (owner). That is a claim which
// rots silently: someone adds a two-column layout for desktop, someone shrinks
// a button, and nothing fails. So the contract is tested — half of it against
// the rendered markup, half against the stylesheet itself, because "the tap
// target is big enough" is a CSS fact and cannot be seen in HTML.
//
// LIMIT, stated rather than implied: this renders to STATIC markup. Selection
// state, the confirm round-trip and focus behaviour are effects that need a DOM
// and jsdom is not installed here. They are verified by reading MatchScreen.jsx
// and by one real run on a phone — never claimed from this file.

import fs from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server.browser'
import MatchScreen, { confirmBarLabel } from '../../src/service-payments/components/MatchScreen.jsx'
import { signalLabel, UNDO_REASONS, REOFFER_REASONS, notServiceKindsFor } from '../../src/service-payments/lib/signalLabels.js'
import MatchedFold from '../../src/service-payments/components/MatchedFold.jsx'

let pass = 0, fail = 0
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`) }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`)

const receipt = {
  amount_paise: 193000,
  payer_name: 'NARENDER YADAV',
  source: 'gpay',
  received_at: '2026-08-10T04:56:44.000Z',
  payer_remark: '9044 bill',
}
const candidate = (o = {}) => ({
  id: 'c1', kind: 'invoice', label: 'MPI6370260000719', amount_paise: 193000,
  customer_name: 'NARENDER YADAV', sap_customer_code: '0012040678',
  signals: [{ signal: 'amount_unique', detail: 'only bill at this amount' }],
  rank: 1, ...o,
})
const render = (props) => renderToStaticMarkup(h(MatchScreen, props))

// ════════════════════════════════════════════════════════════════════════════
section('the receipt leads, and the amount is the biggest thing on it')
{
  const html = render({ receipt, result: { candidates: [candidate()], reason: '' }, remaining: 12 })
  ok('the amount is rendered', html.includes('₹1,930'))
  ok('as the receipt headline', /class="pay-receipt-amount">₹1,930</.test(html))
  ok('the payer is named', html.includes('NARENDER YADAV'))
  ok('the source is in words, not a code', html.includes('Google Pay') && !html.includes('>gpay<'))
  ok('the note the customer typed is shown verbatim', html.includes('9044 bill'))
  ok('how many are left is visible', html.includes('12'))
}
{
  const html = render({ receipt: { ...receipt, payer_name: null }, result: { candidates: [] } })
  ok('a nameless payer says so rather than rendering blank', html.includes('No name on the payment'))
}

// ════════════════════════════════════════════════════════════════════════════
section('every candidate says WHY, in words a person can disagree with')
{
  const html = render({
    receipt,
    result: {
      candidates: [
        candidate({ id: 'a', signals: [{ signal: 'reg_last4', detail: '…9044 of GJ15AV9044' }] }),
        candidate({ id: 'b', signals: [{ signal: 'amount_ambiguous', detail: '3 bills at this amount' }] }),
        candidate({ id: 'c', signals: [{ signal: 'payer_memory', detail: 'paid for this customer 4x' }] }),
      ],
      reason: '',
    },
  })
  ok('a plate match is explained as a truck', html.includes('Truck GJ15AV9044'))
  // "3 bills at this amount" counts this one: the OTHERS are two. This check
  // used to expect "3 other" — it had copied the code's off-by-one, found on
  // the first browser run (a pair read "same amount as 2 other bills").
  ok('an ambiguous amount says how many OTHERS (3 at the amount = 2 others)', html.includes('Same amount as 2 other bills'))
  ok('payer memory is explained in plain words', html.includes('Has paid this customer’s bills before'))
  // The internal signal names are for the audit log, never the counter.
  for (const jargon of ['amount_unique', 'amount_ambiguous', 'reg_last4', 'payer_memory', 'name_overlap']) {
    ok(`the internal name "${jargon}" never reaches the screen`, !html.includes(jargon))
  }
}
{
  // Red team 4 (R4-13): identical names scored "weak" among common words and
  // the card said "similar" about an exact match.
  const html = render({ receipt, result: { candidates: [
    candidate({ signals: [{ signal: 'amount_ambiguous', detail: '5 bills at this amount' },
                          { signal: 'name_overlap', detail: '4/25 same' }] }),
  ] } })
  ok('the SAME name says it matches, whatever its rarity score', html.includes('Name matches the bill') && !html.includes('close to'))
}
{
  const html = render({
    receipt,
    result: { candidates: [candidate({ kind: 'job', member_count: 2, label: '2 bills · order 7008034213' })] },
  })
  ok('a split order is badged as more than one bill', html.includes('2 bills'))
}

// ════════════════════════════════════════════════════════════════════════════
section('the tool refuses to fake a ranking')
{
  const html = render({
    receipt,
    result: {
      candidates: [candidate({ id: 'a', rank: null }), candidate({ id: 'b', rank: null })],
      refuse_to_rank: true,
      reason: '2 bills look equally likely. Pick the one you recognise — they are not ranked.',
    },
  })
  ok('the honest banner is shown', html.includes('equally likely'))
  ok('and marked as a status region', html.includes('role="status"'))
  ok('and styled as a caution, not as normal', html.includes('pay-hint-unordered'))
}
{
  const html = render({ receipt, result: { candidates: [], reason: 'No open bill within 3 days at this amount.' } })
  ok('no candidates says so plainly', html.includes('No bill matches this payment'))
  ok('confirm has nothing to confirm', html.includes('Nothing to confirm'))
}

// ════════════════════════════════════════════════════════════════════════════
section('money is never confirmed by accident')
{
  const html = render({ receipt, result: { candidates: [candidate()] } })
  ok('confirm starts disabled with nothing picked', /class="pay-confirm"[^>]*disabled/.test(html))
  ok('and asks the person to pick', html.includes('Pick a bill above'))
}
{
  const html = render({ receipt, result: { candidates: [candidate()], reason: 'The invoice feed is out of date — confirm is disabled until fresh bills land.' },
    feedIsStale: true, feedAsOf: '2 days ago' })
  // role=status, not alert: true every morning until the report lands, so an
  // alert interrupted a screen reader on every payment (R4-26).
  ok('a stale feed is announced as a status', /pay-banner-warn" role="status"/.test(html))
  ok('...that says today\'s bills are not loaded yet', html.includes('bills are not loaded yet'))
  ok('...and names when they last landed', html.includes('2 days ago'))
  ok('...and who loads them', html.includes('accounts loads them'))
  // R4-10: said once, not again 400px lower in the matcher's own words.
  ok('...said ONCE: the matcher\'s stale sentence is not repeated', !html.includes('invoice feed'))
  ok('and confirm is disabled outright', /class="pay-confirm"[^>]*disabled/.test(html))
}
{
  // R4-10: a pick used to turn the dead button into "Confirm ₹1,930".
  const html = render({ receipt, result: { candidates: [candidate()] }, feedIsStale: true, initialSelectedId: 'c1' })
  ok('while stale, even a picked bill shows "Confirm is off", not an amount',
     html.includes('Confirm is off') && !/class="pay-confirm"[^>]*>Confirm ₹/.test(html))
}
{
  // R4-20: a bill found by search comes back picked; Confirm stays a tap.
  const html = render({ receipt, result: { candidates: [candidate()] }, initialSelectedId: 'c1' })
  ok('a bill already chosen in search arrives selected', html.includes('is-selected') && html.includes('aria-pressed="true"'))
  ok('...and Confirm names the amount, still waiting for the tap', html.includes('Confirm ₹1,930'))
}
{
  const html = render({ receipt, result: { candidates: [candidate()] }, pendingId: 'c1' })
  ok('while the server is answering it says so', html.includes('Saving…'))
  ok('and every control is disabled meanwhile',
     (html.match(/disabled=""/g) || []).length >= 4)
}

// ════════════════════════════════════════════════════════════════════════════
section('the ways out stay on screen')
{
  const noop = () => {}
  const html = render({ receipt, result: { candidates: [candidate()] },
    onSearch: noop, onHoldAdvance: noop, onNotService: noop, onSkip: noop })
  // Someone who cannot find "this is not a service payment" will pick a bill
  // instead — and that is a wrong entry on a real customer's ledger.
  ok('search bills', html.includes('Search bills'))
  ok('hold it as an advance', html.includes('Bill not made yet'))
  // The L5 wordlist: none of the old words is left on a working screen.
  // (Only words this screen showed before — each of these fails on the old code.)
  for (const old of ['raised', 'exact amount', '.00<']) {
    ok(`no "${old}" on the Match screen`, !html.includes(old))
  }
  const hdfc = render({ receipt: { ...receipt, source: 'hdfc' }, onSkip: noop })
  ok('an HDFC payment says "Paid by QR", not the bank', hdfc.includes('Paid by QR') && !hdfc.includes('HDFC QR'))
  ok('mark it not-service', html.includes('Not a service payment'))
  ok('and skip', html.includes('Skip for now'))
}

// ════════════════════════════════════════════════════════════════════════════
section('"bill not raised yet" — offered only when allowed, and a waiting payment says so')
{
  const noop = () => {}
  const base = { result: { candidates: [candidate()] }, onSkip: noop }
  let html = render({ ...base, receipt })
  ok('hidden when the container does not allow it (e.g. a service executive on cash)', !html.includes('Bill not raised yet'))
  html = render({ ...base, receipt, onHoldAdvance: noop })
  ok('shown when allowed', html.includes('Bill not made yet') && !html.includes('Bill still not made'))
  ok('an ordinary payment carries no waiting note', !html.includes('pay-receipt-waiting'))

  html = render({ ...base, onHoldAdvance: noop,
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z' } })
  ok('a waiting payment shows the amber note, with the day it started waiting',
     html.includes('pay-receipt-waiting') && html.includes('Waiting for its bill since 10 Oct'))
  ok('...and the button becomes "Bill still not made"', html.includes('Bill still not made') && !html.includes('Bill not made yet'))

  html = render({ ...base, onHoldAdvance: noop,
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z', back_for_new_bill: true } })
  ok('one that came back says WHY it is in today\'s list again',
     html.includes('A new bill may be its bill'))

  // A waiting payment looks up to today, so "within 3 days" is untrue for it.
  html = render({ onSkip: noop, onHoldAdvance: noop,
    result: { candidates: [], reason: 'No open bill within 3 days at this amount. Search by name or amount, or skip it for now.' },
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z' } })
  ok('a waiting payment with no bill yet is told the truth, not "within 3 days"',
     html.includes('No bill yet. It stays waiting') && !html.includes('within 3 days'))
  html = render({ onSkip: noop, result: { candidates: [], reason: 'No open bill within 3 days at this amount.' }, receipt })
  ok('...an ordinary payment keeps the matcher\'s wording', html.includes('within 3 days'))
}
{
  // The container offers an action only when the server will accept it. A
  // button the server refuses teaches people the tool is broken.
  const html = render({ receipt, result: { candidates: [candidate()] } })
  ok('with no hold-as-advance write path, that button is not offered', !html.includes('Bill not raised yet'))
  ok('with no search wired, that button is not offered', !html.includes('Search all bills'))
  // ...but this exit stays for someone who may not classify: hiding it is how
  // a non-service payment ends up on a customer's bill. The menu tells them
  // accounts decides (state, so read in MatchScreen.jsx, not asserted here).
  ok('"not a service payment" stays visible even for someone who may not classify',
     html.includes('Not a service payment'))
}

// ════════════════════════════════════════════════════════════════════════════
section('a part-matched payment says what is left, and of how much')
{
  const html = render({
    receipt: { ...receipt, amount_paise: 400000, face_paise: 1000000, partly_matched: true },
    result: { candidates: [candidate()] },
  })
  ok('the headline is what is still to place', /class="pay-receipt-amount">₹4,000</.test(html))
  // "left of ₹10,000" read as a position (R4-6): say what the big number is.
  ok('and it says what the big number is, and how much is already matched',
     html.includes('still to match. ₹6,000 of this ₹10,000 payment is already matched.') && !html.includes('left of'))
}
{
  const html = render({ receipt, result: { candidates: [candidate()] } })
  ok('an untouched payment carries no such line', !html.includes('pay-receipt-part'))
}

// ════════════════════════════════════════════════════════════════════════════
section('everything interactive is a real button')
{
  const noop = () => {}
  const html = render({ receipt, result: { candidates: [candidate(), candidate({ id: 'c2' })] },
    onSearch: noop, onHoldAdvance: noop, onNotService: noop })
  const tags = html.match(/<(div|span|li)[^>]*onclick/gi) || []
  ok('nothing is a clickable div or span', tags.length === 0, tags.join(', '))
  const buttons = html.match(/<button[^>]*>/g) || []
  ok('there are buttons', buttons.length >= 6)
  ok('every button declares type=button, so none can submit a form',
     buttons.every((b) => b.includes('type="button"')),
     buttons.filter((b) => !b.includes('type="button"')).join(' '))
  ok('selection state is exposed to assistive tech', html.includes('aria-pressed'))
}

// ════════════════════════════════════════════════════════════════════════════
section('R4-6 / R4-12 — the picked card says what Confirm does')
{
  const noop = () => {}
  const m = (id, kind, total) => ({ id, invoice_number: id, invoice_kind: kind, payment_terms: 'cash',
    invoice_date: '2026-10-08', total_paise: total, allocated_paise: 0 })
  const big = candidate({ id: 'big', label: 'PCR1', invoice_number: 'PCR1', amount_paise: 2500000, members: [m('PCR1', 'service_parts', 2500000)] })
  const r10k = { ...receipt, amount_paise: 1000000 }
  let html = render({ receipt: r10k, result: { candidates: [big] }, onSearch: noop })
  ok('unpicked: no plan line (the list is unchanged)', !html.includes('pay-candidate-plan'))
  html = render({ receipt: r10k, result: { candidates: [big] }, onSearch: noop, initialSelectedId: 'big' })
  ok('picked, part paid: "₹15,000 stays due, the bill stays open"',
     html.includes('class="pay-candidate-plan">₹10,000 of ₹25,000 — ₹15,000 stays due, the bill stays open<'))
  ok('...and the button says it too, not "part-paid"', html.includes('Confirm ₹10,000 · ₹15,000 still due') && !html.includes('part-paid'))
  const job = candidate({ id: 'job:J', kind: 'job', member_count: 2, label: '2 bills · order J', invoice_number: 'PCS1 + LCS2',
    amount_paise: 1165000, members: [m('PCS1', 'service_parts', 615000), m('LCS2', 'service_labour', 550000)] })
  html = render({ receipt: { ...receipt, amount_paise: 1165000 }, result: { candidates: [job] }, onSearch: noop, initialSelectedId: 'job:J' })
  ok('picked order: each bill by kind and amount, the sum, "both bills close"',
     html.includes('Labour ₹5,500 + Parts ₹6,150 = ₹11,650 · both bills close') || html.includes('Parts ₹6,150 + Labour ₹5,500 = ₹11,650 · both bills close'))
  ok('...button "Confirm ₹11,650 · 2 bills"', html.includes('Confirm ₹11,650 · 2 bills'))
  html = render({ receipt: { ...receipt, amount_paise: 193000 }, result: { candidates: [candidate({ members: [m('MPI1', 'counter_sale', 193000)] })] },
                  onSearch: noop, initialSelectedId: 'c1' })
  ok('picked, paid exactly: no extra line at all', !html.includes('pay-candidate-plan') && html.includes('Confirm ₹1,930<'))
}

// ════════════════════════════════════════════════════════════════════════════
section('R4-5 — same-amount bills told apart by date and truck')
{
  const noop = () => {}
  const two = [
    candidate({ id: 'a', label: 'MPI1', invoice_number: 'MPI1', customer_name: 'DEMO HARSH TYRES', sap_customer_code: '0099000010',
                date: '2026-10-06', vehicle_reg_no: 'GJ15AV9044' }),
    candidate({ id: 'b', label: 'MPI2', invoice_number: 'MPI2', customer_name: 'DEMO INDU SPARES', sap_customer_code: '0099000011',
                date: '2026-10-08', vehicle_reg_no: null }),
  ]
  let html = render({ receipt, result: { candidates: two }, onSearch: noop })
  ok('every card says when it was billed, and the truck when there is one',
     html.includes('class="pay-candidate-when">Billed 6 Oct · GJ15AV9044<') && html.includes('class="pay-candidate-when">Billed 8 Oct<'))
  ok('the SAP customer code stays beside the name (owner: shown beside every name)',
     /DEMO HARSH TYRES<span class="pay-candidate-code"> · 0099000010<\/span>/.test(html))
  ok('the bill number is not on an unpicked card (it told nobody anything at a counter)', !/MPI[12]\b/.test(html))
  html = render({ receipt, result: { candidates: two }, onSearch: noop, initialSelectedId: 'a' })
  ok('...and appears once the card is picked, to check against the paper', html.includes('Bill MPI1') && !html.includes('Bill MPI2'))
  const job = candidate({ id: 'job:J', kind: 'job', label: '2 bills · order J', invoice_number: 'PCS1 + LCS2', member_count: 2,
                          date: '2026-10-08', vehicle_reg_no: 'GJ05XX1234' })
  html = render({ receipt, result: { candidates: [job] }, onSearch: noop, initialSelectedId: 'job:J' })
  ok('an order card names both bills when picked', html.includes('Bill PCS1 + LCS2'))
  ok('no date and no plate: no empty line', !render({ receipt, result: { candidates: [candidate({ date: null, vehicle_reg_no: null })] } }).includes('pay-candidate-when'))
  ok('no line was added: the date line took the codes line\'s place',
     // The card's LINES (the code is inside the name line, the amount inside
     // the top line): top · name · billed · why — four, as before (top · name
     // · codes · why).
     (render({ receipt, result: { candidates: [two[0]] } })
       .match(/<span class="pay-candidate-(top|name|when|why|ref)"/g) || []).length === 4)
}

// ════════════════════════════════════════════════════════════════════════════
section('"Matched today" — the fold a wrong match is undone from')
{
  const g = (o = {}) => ({ key: 'k1', allocation_ids: ['a1'], amount_paise: 340000, payer_name: 'MEHUL SHAH',
    customer_name: 'DEMO INDU SPARES', invoice_numbers: ['MPI6370260009006'], bill_count: 1,
    at: '2026-10-13T04:11:00.000Z', maker_id: 'u1', maker_name: 'Ramesh', mine: true, exported: false,
    receipt_id: 'r1', mode: 'upi', refusal: null, ...o })
  const fold = (props) => renderToStaticMarkup(h(MatchedFold, props))
  let html = fold({ groups: [g()] })
  ok('closed by default under a payment (one line, below everything)', /<details class="pay-import-fold pay-matched-fold">/.test(html))
  ok('a service person reads "You matched today: 1"', html.includes('You matched today: 1'))
  ok('the row says money, payer and bill — and when, on India\'s clock',
     html.includes('₹3,400') && html.includes('MEHUL SHAH → DEMO INDU SPARES') && html.includes('MPI6370260009006') && /9:41\s?am/i.test(html))
  ok('their own row has an Undo button', />Undo</.test(html))
  ok('no reasons until Undo is tapped (nothing is undone by one stray tap)', !html.includes('Why undo it?'))
  html = fold({ groups: [g()], defaultOpen: true, seesAll: true })
  ok('open on the end screens; accounts reads "Matched today"', /<details class="pay-import-fold pay-matched-fold" open="">/.test(html) && html.includes('Matched today: 1'))
  html = fold({ groups: [g({ key: 'k2', mine: false, bill_count: 2, invoice_numbers: ['PCS1', 'LCS2'], amount_paise: 1165000 })], seesAll: true })
  ok('a parts + labour confirm is one row: "2 bills", both numbers', html.includes('2 bills · PCS1 + LCS2'))
  ok('a colleague\'s match names who made it', html.includes('by Ramesh'))
  html = fold({ groups: [g({ refusal: 'This entry has already gone to Busy. A GM can reverse it; it will travel as a correcting entry.' })], seesAll: true })
  ok('when the server would refuse, there is NO Undo button — it says why', !/>Undo</.test(html) && html.includes('already gone to Busy'))
  html = fold({ groups: [g({ mine: false, refusal: 'Only the person who matched this, or accounts, can undo it.' })], seesAll: true })
  ok('...naming the maker where it helps', html.includes('Only Ramesh or accounts can undo this.'))
  html = fold({ groups: [] })
  ok('nothing matched yet: says "none", and the week is one tap away', html.includes('You matched today: none') && html.includes('Show the last 7 days'))
  html = fold({ groups: [g()], span: 'week' })
  ok('across the week the day is shown too', html.includes('in the last 7 days') && /13 Oct/.test(html) && html.includes('Show only today'))
  html = fold({ groups: [g()], undoingKey: 'k1' })
  ok('while undoing, the button says so and nothing else can be started', html.includes('Undoing…') && /class="pay-matched-span" disabled="">Show the last 7 days/.test(html))
  ok('six canned reasons; exactly two keep the bill on offer',
     UNDO_REASONS.length === 6 && REOFFER_REASONS.size === 2 &&
     REOFFER_REASONS.has('Undo by mistake — offer it again') && REOFFER_REASONS.has('Match again with a different amount'))
  ok('"Bill cancelled in SAP" is accounts\' alone; "Bill not raised yet" also marks it waiting',
     UNDO_REASONS.find((r) => r.label === 'Bill cancelled in SAP')?.accountsOnly === true &&
     UNDO_REASONS.find((r) => /^Bill not made yet/.test(r.label))?.waits === true)
  // The re-offer rule finds these two by their SAVED text (matchQueue
  // undoneByReceipt): reword one and every earlier undo with it stops being
  // re-offered. They must stay word for word (R4-21).
  ok('the two re-offer reasons keep their saved wording',
     JSON.stringify(UNDO_REASONS.filter((r) => r.reoffer).map((r) => r.label)) ===
     JSON.stringify(['Undo by mistake — offer it again', 'Match again with a different amount']))

  // The fold rides INSIDE the Match screen, so it keeps the room the fixed
  // confirm bar leaves; placed after it, its last line sat under the bar.
  const noop = () => {}
  const screen = render({ receipt, result: { candidates: [candidate()] }, onSearch: noop, onSkip: noop,
    footer: h('div', { className: 'probe-footer' }) })
  ok('the footer renders inside the screen, after the ways out',
     screen.indexOf('probe-footer') > screen.indexOf('Search all bills') && screen.lastIndexOf('</div>') > screen.indexOf('probe-footer'))
  const done = render({ receipt: null, footer: h('div', { className: 'probe-footer' }) })
  ok('...and on "Nothing left to match"', done.includes('Nothing left to match') && done.includes('probe-footer'))
}

// ════════════════════════════════════════════════════════════════════════════
section('red team 4 — order, announcements and dates')
{
  const noop = () => {}
  const html = render({ receipt, result: { candidates: [candidate()] },
    onSearch: noop, onHoldAdvance: noop, onNotService: noop, onSkip: noop })
  // R4-23: Confirm was four Tabs away, after the ways out. The bar is fixed,
  // so its place in the markup is only the keyboard / screen-reader order.
  ok('Confirm comes right after the bills in reading and Tab order',
     html.indexOf('class="pay-confirm"') > html.indexOf('pay-candidates') &&
     html.indexOf('class="pay-confirm"') < html.indexOf('Search bills'))
  // R4-26: "Saving…" was announced by nothing.
  ok('the confirm bar announces its changes politely', /class="pay-confirmbar" aria-live="polite"/.test(html))
  // R4-30: "Billed yesterday" — from today, or from the payment?
  ok('after a bill was left out, the next one says "Only other bill of this amount in 3 days"',
     signalLabel({ signal: 'amount_unique', detail: 'only other bill at this amount' }) === 'Only other bill of this amount in 3 days' &&
     signalLabel({ signal: 'amount_unique', detail: 'only bill at this amount' }) === 'Only bill of this amount')
  ok('a date reason says it is counted from the payment',
     signalLabel({ signal: 'date', detail: '1d' }) === 'Billed the day before the payment' &&
     signalLabel({ signal: 'date', detail: '3d' }) === 'Billed 3 days before the payment' &&
     signalLabel({ signal: 'date', detail: '-1d' }) === 'Billed the day after the payment' &&
     signalLabel({ signal: 'date', detail: '0d' }) === 'Billed the same day')
  ok('a bill found by search shows the same date style (10 Oct, not 2026-10-10)',
     signalLabel({ signal: 'search', detail: '2026-10-10' }) === 'Found by search')
}

// ════════════════════════════════════════════════════════════════════════════
section('R4-9 — "Not a service payment" is picked, then set aside from the bar')
{
  const eq = (label, got, want) => ok(label, got === want, `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  const bar = (o) => confirmBarLabel({ busy: false, refreshing: false, feedIsStale: false, aside: null,
    amountPaise: 3000, button: null, hasCandidates: false, ...o })
  const kind = { value: 'sister_unit', label: 'Sister concern / group company' }
  eq('a picked reason turns the bar into the action', bar({ aside: kind }), 'Set aside ₹30 — not service')
  eq('...even while bills are out of date (setting money aside needs no bill)', bar({ aside: kind, feedIsStale: true }), 'Set aside ₹30 — not service')
  eq('...and "Saving…" still wins while it is written', bar({ aside: kind, busy: true }), 'Saving…')
  eq('with nothing picked the bar is unchanged', bar({ hasCandidates: true }), 'Pick a bill above')
  eq('stale bills still stop a picked BILL', bar({ feedIsStale: true, button: 'Confirm ₹1,930' }), 'Confirm is off — bills not loaded yet')
  const has = (paise) => notServiceKindsFor(paise).some((k) => k.value === 'test_topup')
  ok('"Test or top-up" is offered for ₹30', has(3000))
  ok('...and for exactly ₹50 (the Import preview\'s line)', has(5000))
  ok('...but not for ₹50.01 — "test" must not make real money disappear', !has(5001))
  ok('every other reason is offered at any amount', notServiceKindsFor(10000000).length === notServiceKindsFor(0).length - 1)
  // A tap on a reason used to set the money aside at once. Now it only picks.
  const src = fs.readFileSync(path.join(process.cwd(), 'src/service-payments/components/MatchScreen.jsx'), 'utf8')
  const reasonsBlock = src.slice(src.indexOf('className="pay-reasons"'), src.indexOf('{footer}', src.indexOf('className="pay-reasons"')))
  ok('tapping a reason never calls the server by itself', reasonsBlock.length > 0 && !reasonsBlock.includes('onNotService('))
  ok('...a picked reason says so to a screen reader', reasonsBlock.includes('aria-pressed'))
}

// ════════════════════════════════════════════════════════════════════════════
section('the empty state is an ending, not a blank page')
{
  const html = render({ receipt: null, doneToday: 18 })
  ok('it says the work is finished', html.includes('Nothing left to match'))
  ok('it credits what was done', html.includes('18 payments matched'))
  ok('and says what brings more', html.includes('after accounts loads them'))
}
{
  const html = render({ receipt: null, doneToday: 1 })
  ok('and it counts one payment in the singular', html.includes('1 payment matched'))
}

// ════════════════════════════════════════════════════════════════════════════
section('the CSS contract — a phone claim that HTML cannot prove')
{
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8')
  const block = (sel) => {
    const m = css.match(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`))
    return m ? m[1] : ''
  }
  const minHeight = (sel) => {
    const m = block(sel).match(/min-height:\s*(\d+)px/)
    return m ? Number(m[1]) : 0
  }

  ok('.pay-candidate is at least a 44px target', minHeight('.pay-candidate') >= 44,
     `${minHeight('.pay-candidate')}px`)
  ok('.pay-secondary is at least a 44px target', minHeight('.pay-secondary') >= 44)
  ok('.pay-reason is at least a 44px target', minHeight('.pay-reason') >= 44)
  ok('.pay-skip is at least a 44px target', minHeight('.pay-skip') >= 44)
  ok('.pay-confirm is bigger still — it is the one that spends money',
     minHeight('.pay-confirm') >= 48, `${minHeight('.pay-confirm')}px`)

  const bar = block('.pay-confirmbar')
  ok('the confirm bar is pinned to the bottom', /position:\s*fixed/.test(bar) && /bottom:\s*0/.test(bar))
  ok('and clears the phone home indicator', /env\(safe-area-inset-bottom/.test(bar))
  ok('the page reserves room so the bar never covers the last candidate',
     /env\(safe-area-inset-bottom/.test(block('.pay-match')))

  // Room under the last button, measured instead of guessed (R4-25: it was
  // 105px too much on phones, because .app-main already pads for the nav).
  const px = (re, src) => Number((src.match(re) || [])[1] ?? NaN)
  const barH = minHeight('.pay-confirm') + px(/gap:\s*(\d+)px/, bar) + minHeight('.pay-skip') +
    2 * px(/padding:\s*(\d+)px/, bar) + 1
  const deskRoom = px(/calc\((\d+)px/, block('.pay-match')) + px(/padding:\s*\d+px\s+\d+px\s+(\d+)px/, (css.match(/@media \(min-width: 760px\) \{\s*\.app-main \{([^}]*)\}/) || [])[1] || '')
  ok('desktop: room under the list covers the bar, without a screen of dead scroll',
     deskRoom >= barH && deskRoom - barH <= 40, `bar ${barH}px, room ${deskRoom}px`)
  const phoneMatch = (css.match(/@media\s*\(max-width:\s*759px\)[\s\S]*?\.pay-match\s*\{([^}]*)\}/) || [])[1] || ''
  const phoneRoom = px(/padding-bottom:\s*(\d+)px/, phoneMatch) + 16
  ok('phone: the same, on top of the nav padding .app-main already gives',
     phoneRoom >= barH && phoneRoom - barH <= 40, `bar ${barH}px, room ${phoneRoom}px`)
  ok('...and .app-main really does pad for the nav on phones (the premise)',
     /--bottom-nav-h[^;]*\+ 16px/.test(block('.app-main')))

  // R4-1: a fixed bar with left:50% + right:auto and no width shrank to a
  // 132px pill on desktop. Both edges pinned + auto margins keep it the column.
  const wide = (css.match(/@media \(min-width: 721px\) \{\s*\.pay-confirmbar \{([^}]*)\}/) || [])[1] || ''
  ok('desktop bar: both edges pinned, centred by auto margins (no shrink-to-fit)',
     /left:\s*0/.test(wide) && /right:\s*0/.test(wide) && /margin:\s*0 auto/.test(wide) &&
     !/right:\s*auto/.test(wide) && !/translateX/.test(wide), wide.trim().replace(/\s+/g, ' '))
  ok('...and with the sidebar showing it is centred over the page column, not the window',
     /@media \(min-width: 760px\) \{\s*\.pay-confirmbar \{\s*left:\s*var\(--sidebar-w\)/.test(css) &&
     /@media \(min-width: 760px\) \{\s*\.sidebar \{\s*display:\s*flex/.test(css))

  // R4-16: the waiting strip shares .pay-match and inherited the bar's room.
  ok('the waiting strip does not inherit the confirm bar\'s bottom room',
     /\.pay-match\.pay-waiting-strip\s*\{\s*padding-bottom:\s*0/.test(css))
  // R4-2: summary { display:flex } removes the browser's marker.
  ok('Import fold headings draw their own ▸/▾ (display:flex removed the browser\'s)',
     /\.pay-import-fold summary::before\s*\{[^}]*content:\s*'▸'/.test(css) &&
     /\.pay-import-fold\[open\] > summary::before\s*\{[^}]*content:\s*'▾'/.test(css))
  // R4-4: sideways, a stacked bar left 134px for content.
  ok('phone held sideways: Confirm and Skip sit side by side',
     /@media \(max-height: 480px\) \{\s*\.pay-confirmbar \{[^}]*flex-direction:\s*row/.test(css))
  // R4-7: the page head cost 117px on phones and repeated its sub-title.
  ok('phones: the payments page head drops the crumb and the repeated sub-title',
     /\.pay-page-head \.page-head-sub \{\s*display:\s*none/.test(css))
  // The undo reasons open at the very bottom: they must scroll clear of the bar.
  ok('the undo reasons scroll clear of the confirm bar (and the nav, on phones)',
     /\.pay-reasons, \.pay-wait, \.pay-denied-note, \.pay-matched-ask \{ scroll-margin-bottom: 140px; \}/.test(css) &&
     /@media \(max-width: 759px\) \{\s*\.pay-reasons, \.pay-wait, \.pay-denied-note, \.pay-matched-ask \{\s*scroll-margin-bottom: calc\(140px \+ var\(--bottom-nav-h\)/.test(css))
  ok('the "Show the last 7 days" link is a full tap target', /\.pay-matched-span \{[^}]*min-height: 44px/.test(css))
  // R4-22: the disabled button still carries words.
  ok('disabled Confirm is readable (no white text on light grey)',
     /color:\s*var\(--gray-600\)/.test((css.match(/\.pay-confirm:disabled\s*\{([^}]*)\}/) || [])[1] || ''))

  ok('a picked not-service reason looks picked', /\.pay-reason\.is-picked \{[^}]*background: var\(--blue-lighter\)/.test(css))
  // R4-24: a blue reason line read as a link and was tapped first.
  {
    const why = block('.pay-candidate-why')
    ok('the reason under a bill is grey, not link-blue', /color:\s*var\(--gray-600\)/.test(why) && !/blue/.test(why), why)
  }

  // Found only when the screen went inside the app: the portal's bottom nav is
  // fixed at bottom: 0 with a HIGHER z-index below 760px, so a bar at bottom: 0
  // put the confirm button behind it on every phone.
  const navZ = Number((block('.bottom-nav').match(/z-index:\s*(\d+)/) || [])[1])
  const barZ = Number((block('.pay-confirmbar').match(/z-index:\s*(\d+)/) || [])[1])
  const navHides = css.match(/@media\s*\(min-width:\s*(\d+)px\)\s*\{\s*\.bottom-nav\s*\{\s*display:\s*none/)
  const navGoneAt = navHides ? Number(navHides[1]) : null
  const phoneRule = css.match(/@media\s*\(max-width:\s*(\d+)px\)\s*\{\s*\.pay-confirmbar\s*\{([^}]*)\}/)
  ok('(the bottom nav really does sit above the bar — the premise of the next checks)',
     navZ > barZ, `nav z ${navZ}, bar z ${barZ}`)
  ok('on phones the confirm bar stands ON TOP of the bottom nav, not under it',
     !!phoneRule && /bottom:\s*calc\(var\(--bottom-nav-h\)/.test(phoneRule[2]))
  ok('...at every width where the nav is shown',
     !!phoneRule && navGoneAt !== null && Number(phoneRule[1]) === navGoneAt - 1,
     `bar rule to ${phoneRule?.[1]}px, nav hidden from ${navGoneAt}px`)

  // The cornerstone, stated as a test: there is no width at which this screen
  // becomes a list beside a detail pane.
  const payCss = css.slice(css.indexOf('SERVICE PAYMENTS — MATCH'))
  ok('no .pay-* rule introduces a second layout column',
     !/\.pay-[a-z-]*\s*\{[^}]*grid-template-columns:\s*[^;]*(1fr\s+1fr|repeat\(2)/.test(payCss))
  ok('the candidate list is a single column stack',
     /flex-direction:\s*column/.test(block('.pay-candidates')))
  ok('reduced motion is honoured', payCss.includes('prefers-reduced-motion'))
}

console.log(`\n${'═'.repeat(64)}`)
console.log(`${fail === 0 ? 'ALL PASS' : 'FAILURES'}   ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
