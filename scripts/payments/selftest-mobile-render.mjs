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
  ok('a nameless payer says so rather than rendering blank', html.includes('No name given'))
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
  const html = render({ receipt, result: { candidates: [candidate()] }, feedIsStale: true, feedAsOf: '2 days ago' })
  ok('a stale feed raises an alert', html.includes('role="alert"'))
  ok('...that says bills are out of date', html.includes('out of date'))
  ok('...and names when they last landed', html.includes('2 days ago'))
  ok('and confirm is disabled outright', /class="pay-confirm"[^>]*disabled/.test(html))
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
  ok('...and the page leaves room for both',
     /@media\s*\(max-width:\s*759px\)[\s\S]*?\.pay-match\s*\{[^}]*--bottom-nav-h/.test(css))

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
