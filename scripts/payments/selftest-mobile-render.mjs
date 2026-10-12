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
import MatchScreen from '../../src/service-payments/components/MatchScreen.jsx'
import { signalLabel } from '../../src/service-payments/lib/signalLabels.js'

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
  ok('the amount is rendered', html.includes('₹1,930.00'))
  ok('as the receipt headline', /class="pay-receipt-amount">₹1,930\.00</.test(html))
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
  ok('payer memory is explained in plain words', html.includes('has paid for them before'))
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
  ok('the SAME name says it matches, whatever its rarity score', html.includes('Payer name matches the customer') && !html.includes('similar'))
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
  // R4-10: a pick used to turn the dead button into "Confirm ₹1,930.00".
  const html = render({ receipt, result: { candidates: [candidate()] }, feedIsStale: true, initialSelectedId: 'c1' })
  ok('while stale, even a picked bill shows "Confirm is off", not an amount',
     html.includes('Confirm is off') && !/class="pay-confirm"[^>]*>Confirm ₹/.test(html))
}
{
  // R4-20: a bill found by search comes back picked; Confirm stays a tap.
  const html = render({ receipt, result: { candidates: [candidate()] }, initialSelectedId: 'c1' })
  ok('a bill already chosen in search arrives selected', html.includes('is-selected') && html.includes('aria-pressed="true"'))
  ok('...and Confirm names the amount, still waiting for the tap', html.includes('Confirm ₹1,930.00'))
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
  ok('search all bills', html.includes('Search all bills'))
  ok('hold it as an advance', html.includes('Bill not raised yet'))
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
  ok('shown when allowed', html.includes('Bill not raised yet') && !html.includes('Still not raised'))
  ok('an ordinary payment carries no waiting note', !html.includes('pay-receipt-waiting'))

  html = render({ ...base, onHoldAdvance: noop,
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z' } })
  ok('a waiting payment shows the amber note, with the day it started waiting',
     html.includes('pay-receipt-waiting') && html.includes('Waiting for its bill since 10 Oct'))
  ok('...and the button becomes "Still not raised"', html.includes('Still not raised') && !html.includes('Bill not raised yet'))

  html = render({ ...base, onHoldAdvance: noop,
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z', back_for_new_bill: true } })
  ok('one that came back says WHY it is in today\'s list again',
     html.includes('a bill imported since could be it'))

  // A waiting payment looks up to today, so "within 3 days" is untrue for it.
  html = render({ onSkip: noop, onHoldAdvance: noop,
    result: { candidates: [], reason: 'No open bill within 3 days at this amount. Search by name or amount, or skip it for now.' },
    receipt: { ...receipt, awaiting_invoice: true, awaiting_since: '2026-10-10T06:00:00.000Z' } })
  ok('a waiting payment with no bill yet is told the truth, not "within 3 days"',
     html.includes('No bill for it yet') && !html.includes('within 3 days'))
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
  ok('the headline is what is still to place', /class="pay-receipt-amount">₹4,000\.00</.test(html))
  ok('and it says of how much', html.includes('left of ₹10,000.00'))
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
section('red team 4 — order, announcements and dates')
{
  const noop = () => {}
  const html = render({ receipt, result: { candidates: [candidate()] },
    onSearch: noop, onHoldAdvance: noop, onNotService: noop, onSkip: noop })
  // R4-23: Confirm was four Tabs away, after the ways out. The bar is fixed,
  // so its place in the markup is only the keyboard / screen-reader order.
  ok('Confirm comes right after the bills in reading and Tab order',
     html.indexOf('class="pay-confirm"') > html.indexOf('pay-candidates') &&
     html.indexOf('class="pay-confirm"') < html.indexOf('Search all bills'))
  // R4-26: "Saving…" was announced by nothing.
  ok('the confirm bar announces its changes politely', /class="pay-confirmbar" aria-live="polite"/.test(html))
  // R4-30: "Billed yesterday" — from today, or from the payment?
  ok('a date reason says it is counted from the payment',
     signalLabel({ signal: 'date', detail: '1d' }) === 'Billed the day before the payment' &&
     signalLabel({ signal: 'date', detail: '3d' }) === 'Billed 3 days before the payment' &&
     signalLabel({ signal: 'date', detail: '-1d' }) === 'Billed the day after the payment' &&
     signalLabel({ signal: 'date', detail: '0d' }) === 'Billed the same day')
  ok('a bill found by search shows the same date style (10 Oct, not 2026-10-10)',
     signalLabel({ signal: 'search', detail: '2026-10-10' }) === 'Found by search · billed 10 Oct')
}

// ════════════════════════════════════════════════════════════════════════════
section('the empty state is an ending, not a blank page')
{
  const html = render({ receipt: null, doneToday: 18 })
  ok('it says the work is finished', html.includes('Nothing left to match'))
  ok('it credits what was done', html.includes('18 payments matched'))
  ok('and says what brings more', html.includes('imported'))
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
  // R4-22: the disabled button still carries words.
  ok('disabled Confirm is readable (no white text on light grey)',
     /color:\s*var\(--gray-600\)/.test((css.match(/\.pay-confirm:disabled\s*\{([^}]*)\}/) || [])[1] || ''))

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
