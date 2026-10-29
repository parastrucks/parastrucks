// Red team 4 rig: render every Service Payments state to static HTML inside a
// replica of the app shell (top bar, bottom nav), so screenshots show what a
// phone shows — including anything the nav covers.
//
// Real renders: MatchScreen, SearchPanel (pure components, real code).
// Replicas (hand-copied from the JSX, same classes): page head + tabs, the
// Import preview/done, empty states from PaymentsPage, bottom nav, Create sheet,
// drawer. Replicas are marked in STATES with replica: true.

import fs from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server.browser'
import MatchScreen from '/home/user/parastrucks/src/service-payments/components/MatchScreen.jsx'
import SearchPanel from '/home/user/parastrucks/src/service-payments/components/SearchPanel.jsx'
import Icon from '/home/user/parastrucks/src/components/Icon.jsx'
import { formatINR } from '/home/user/parastrucks/src/service-payments/lib/paise.js'

const REPO = '/home/user/parastrucks'
const OUT = path.resolve(process.argv[2] || './out')
fs.mkdirSync(OUT, { recursive: true })
fs.copyFileSync(path.join(REPO, 'public/paras-logo.png'), path.join(OUT, 'paras-logo.png'))
const CSS = fs.readFileSync(path.join(REPO, 'src/index.css'), 'utf8').replace(/\/paras-logo\.png/g, 'paras-logo.png')

const icon = (name, size, color) => renderToStaticMarkup(h(Icon, { name, size, color }))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── shell ────────────────────────────────────────────────────────────────
const TABS = {
  service: [{ to: '/', icon: 'dashboard', label: 'Home' }, { to: '/vendor-jobs', icon: 'wrench', label: 'Jobs' }],
  accounts: [{ to: '/', icon: 'dashboard', label: 'Home' }, { to: '/vendor-jobs', icon: 'wrench', label: 'Jobs' }],
  admin: [{ to: '/', icon: 'dashboard', label: 'Home' }, { to: '/tiv-forecast', icon: 'trending', label: 'TIV' },
          { to: '/employees', icon: 'users', label: 'Team' }, { to: '/profile', icon: 'user', label: 'Profile' }],
}
function bottomNav(role) {
  const tabs = TABS[role] || TABS.service
  const mid = tabs.length / 2
  const tab = (t) => `<a class="bottom-tab" href="#">${icon(t.icon, 21, 'var(--text-muted)')}<span class="bottom-tab-label">${t.label}</span></a>`
  return `<nav class="bottom-nav">${tabs.slice(0, mid).map(tab).join('')}<button type="button" class="bottom-nav-create" aria-label="Create new">${icon('plus', 26, '#fff')}</button>${tabs.slice(mid).map(tab).join('')}</nav>`
}
function topbar(initials) {
  return `<header class="topbar"><button type="button" class="topbar-btn" aria-label="Open menu">${icon('menu', 22, '#fff')}</button><img class="topbar-logo" src="paras-logo.png" alt="Paras Trucks"><a class="topbar-avatar" href="#" aria-label="Profile">${initials}</a></header>`
}
function sidebar(name) {
  const link = (ic, label, active = false) => `<a class="sidebar-link${active ? ' active' : ''}" href="#">${icon(ic, 17, active ? 'var(--accent)' : 'var(--text-muted)')}<span>${label}</span></a>`
  return `<aside class="sidebar"><div class="sidebar-logo"><img src="paras-logo.png" alt="Paras Trucks"></div>
  <div class="sidebar-entity"><button type="button" class="sidebar-entity-trigger"><span class="sidebar-avatar-sm">${name.split(' ').map((w) => w[0]).join('')}</span><span class="sidebar-entity-info"><span class="sidebar-username">${name}</span><span class="entity-badge">PTB</span></span></button></div>
  <nav class="sidebar-nav"><div class="sidebar-section"><div class="sidebar-section-label">Service Tools</div>${link('wrench', 'Vendor Jobs')}${link('rupee', 'Match Payments', true)}</div></nav></aside>`
}
function pageHead({ tabs = null, count = 0, active = 'match' } = {}) {
  const seg = tabs ? `<div class="seg pay-tabs" role="tablist" aria-label="Payments">
    <button type="button" role="tab" aria-selected="${active === 'match'}" class="seg-btn ${active === 'match' ? 'active' : ''}">Match${count ? ` (${count})` : ''}</button>
    <button type="button" role="tab" aria-selected="${active === 'import'}" class="seg-btn ${active === 'import' ? 'active' : ''}">Import</button></div>` : ''
  return `<div class="page-head"><div><div class="page-head-crumb">Service Tools</div><h1 class="page-head-title">Match Payments<span class="period-accent">.</span></h1><div class="page-head-sub">Which bill did each UPI payment pay?</div></div></div>${seg}`
}
function shell({ body, role = 'service', name = 'Ramesh Patel', overlay = '', title }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="app-layout">${sidebar(name)}${topbar(initials)}<main class="app-main"><div class="page">${body}</div></main>${bottomNav(role)}</div>${overlay}</body></html>`
}

// ── fixtures (DEMO data, dates around 2026-10-12 IST) ───────────────────
const T = (day, hm) => `2026-10-${String(day).padStart(2, '0')}T${hm}:00+05:30`
const rc = (o) => ({ source: 'hdfc', received_at: T(9, '11:42'), ...o })
let cid = 0
const bill = (o) => ({ id: `c${++cid}`, kind: 'invoice', rank: 1, signals: [], ...o })
const sig = (signal, detail = '') => ({ signal, detail })
const res = (candidates, o = {}) => ({ candidates, refuse_to_rank: false, confident: false, reason: '', searched: 0, ...o })
const NO_BILL = 'No open bill within 3 days at this amount. Search by name or amount, or skip it for now.'

const R = {
  jayesh: rc({ id: 'r1', amount_paise: 215000, payer_name: 'JAYESH PATEL', received_at: T(8, '10:05') }),
  ganga: rc({ id: 'r2', amount_paise: 1000000, payer_name: 'GANGA SAGAR MAHESHWARI', received_at: T(9, '16:20') }),
  quick: rc({ id: 'r3', amount_paise: 777700, payer_name: 'DEMO QUICK FREIGHT', received_at: T(8, '13:10') }),
  mehul: rc({ id: 'r4', amount_paise: 340000, payer_name: 'MEHUL SHAH', received_at: T(10, '09:48') }),
  suresh: rc({ id: 'r5', amount_paise: 1165000, payer_name: 'SURESH DESAI', received_at: T(10, '12:31') }),
  asha: rc({ id: 'r6', amount_paise: 193000, payer_name: 'DEMO ASHA ENTERPRISE', received_at: T(11, '10:02') }),
  nirav: rc({ id: 'r7', amount_paise: 193000, payer_name: 'NIRAV PATEL', received_at: T(11, '10:40') }),
  bhavin: rc({ id: 'r8', amount_paise: 193000, payer_name: 'DEMO BHAVIN TRADING', received_at: T(12, '08:15') }),
  quickWaiting: rc({ id: 'r3', amount_paise: 777700, payer_name: 'DEMO QUICK FREIGHT', received_at: T(8, '13:10'), awaiting_invoice: true, awaiting_since: T(12, '09:00') }),
  quickBack: rc({ id: 'r3', amount_paise: 777700, payer_name: 'DEMO QUICK FREIGHT', received_at: T(8, '13:10'), awaiting_invoice: true, awaiting_since: T(12, '09:00'), back_for_new_bill: true }),
  noname: rc({ id: 'r9', amount_paise: 450000, payer_name: null, received_at: T(11, '15:55') }),
  kisan30: rc({ id: 'r10', amount_paise: 3000, payer_name: 'DEMO KISAN TRADERS', received_at: T(9, '11:50') }),
}
const C = {
  jay: bill({ label: 'MPI5756260000412', amount_paise: 215000, customer_name: 'DEMO JAY BATTERIES', sap_customer_code: '0099000412', signals: [sig('amount_unique', 'only bill at this amount'), sig('date', 'd0')] }),
  ganga: bill({ label: 'PCR5756260000418', amount_paise: 2500000, customer_name: 'GANGA SAGAR MAHESHWARI', sap_customer_code: '0099000418', signals: [sig('name_overlap_strong', '25/25'), sig('date', 'd1')] }),
  harsh: bill({ label: 'MPI5756260000431', amount_paise: 340000, customer_name: 'DEMO HARSH AUTO', sap_customer_code: '0099000431', signals: [sig('amount_ambiguous', '2 bills at this amount'), sig('date', 'd0')] }),
  indu: bill({ label: 'MPI5756260000433', amount_paise: 340000, customer_name: 'DEMO INDU ROADLINES', sap_customer_code: '0099000433', signals: [sig('amount_ambiguous', '2 bills at this amount'), sig('date', 'd1')] }),
  fleet: bill({ kind: 'job', label: 'Job 5756001234', member_count: 2, amount_paise: 1165000, customer_name: 'DEMO FLEET CARRIERS', sap_customer_code: '0099000440', signals: [sig('amount_unique', 'only order at this amount'), sig('date', 'd0')] }),
}
const def = (name, code, n, extra = []) => bill({ label: `MPI57562600005${code}`, amount_paise: 193000, customer_name: name, sap_customer_code: `00990005${code}`, signals: [sig('amount_ambiguous', `${n} bills at this amount`), ...extra, sig('date', 'd0')] })
const fiveDef = [
  def('DEMO ASHA ENTERPRISE', '01', 5, [sig('name_overlap', '17/25')]),
  def('DEMO BHAVIN TRADING', '02', 5), def('DEMO CHIRAG MOTORS', '03', 5), def('DEMO DINESH LOGISTICS', '04', 5), def('DEMO EKTA TRANSPORT', '05', 5),
]
const fourDef = fiveDef.slice(1).map((c) => ({ ...c, signals: [sig('amount_ambiguous', '4 bills at this amount'), sig('date', 'd0')] }))

const match = (props) => renderToStaticMarkup(h(MatchScreen, { remaining: 9, doneToday: 0, onConfirm() {}, onSkip() {}, onSearch() {}, onHoldAdvance() {}, onNotService() {}, ...props }))
// MatchScreen keeps selection in useState; a static render cannot tap. For the
// "selected" states, the markup is the real render with the class and the
// extra chips patched in exactly as the component would emit them.
function selectFirst(html, extraChips = []) {
  let out = html.replace('class="pay-candidate"', 'class="pay-candidate is-selected"').replace('aria-pressed="false"', 'aria-pressed="true"')
  if (extraChips.length) out = out.replace(/(<span class="pay-candidate-why">[^<]*<\/span>)/, `$1<span class="pay-candidate-all">${extraChips.map((c) => `<span class="pay-chip">${c}</span>`).join('')}</span>`)
  return out
}
const confirmLabel = (html, label) => html.replace(/<button type="button" class="pay-confirm" disabled="">[^<]*<\/button>/, `<button type="button" class="pay-confirm">${label}</button>`)
const search = (props) => renderToStaticMarkup(h(SearchPanel, { search: async () => [], onPick() {}, onCancel() {}, ...props }))
// SearchPanel's results live in state from an async search; patch the static
// "idle" render to show each result state with the real markup shapes.
function searchState(receipt, query, hintText, rows = []) {
  let html = search({ receipt, initialQuery: query })
  html = html.replace(/<p class="pay-hint" role="status">[^<]*<\/p>/, `<p class="pay-hint" role="status">${esc(hintText)}</p>`)
  if (rows.length) {
    const li = rows.map((v) => `<li><button type="button" class="pay-candidate"><span class="pay-candidate-top"><span class="pay-candidate-amount">${formatINR(v.total_paise - (v.allocated_paise ?? 0))}</span></span><span class="pay-candidate-name">${esc(v.customer_name)}</span><span class="pay-candidate-ref">${v.invoice_number} · ${v.sap_customer_code}</span><span class="pay-candidate-why">Billed ${v.invoice_date}${v.vehicle_reg_no ? ` · ${v.vehicle_reg_no}` : ''}${v.allocated_paise > 0 ? ` · ${formatINR(v.allocated_paise)} already paid` : ''}</span></button></li>`).join('')
    html = html.replace('<ul class="pay-candidates"></ul>', `<ul class="pay-candidates">${li}</ul>`)
  }
  return html
}

const empty = (title, sub, buttons = [], tick = true) => `<div class="pay-match pay-match-empty">${tick ? '<p class="pay-empty-tick" aria-hidden="true">✓</p>' : ''}<h2 class="pay-empty-title">${title}</h2><p class="pay-empty-sub">${sub}</p>${buttons.map((b) => `<button type="button" class="pay-secondary">${b}</button>`).join('')}</div>`

// Import replicas
const count = (label, n, sub = '', strong = false, warn = false) => (!strong && !n) ? '' : `<div class="pay-import-count${warn && n ? ' is-warn' : ''}"><dt>${label}</dt><dd><strong>${n}</strong>${sub ? `<span> · ${sub}</span>` : ''}</dd></div>`
const fold = (title, items) => items.length ? `<details class="pay-import-fold"><summary>${title} (${items.length})</summary><ul class="pay-import-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul></details>` : ''
const importPick = (error = '') => `<div class="pay-import"><section class="pay-import-pick"><label class="pay-search-label" for="pay-import-file">Choose a file to import</label><p class="pay-hint">The SAP <strong>Billing Report</strong>, or the day’s <strong>HDFC SmartHub transaction report</strong> (both .xlsx). Nothing is saved until you have seen what it will change. Uploading a report that overlaps an earlier one is fine — payments already imported are recognised and skipped.</p><input id="pay-import-file" class="pay-import-input" type="file" accept=".xlsx,.xls,.csv">${error ? `<p class="pay-banner pay-banner-warn" role="alert">${error}</p>` : ''}</section></div>`
function importPreview({ kindLabel, file, blocking = [], counts, hints = [], settle = null, warnings = [], folds = [], action, disabled = false }) {
  return `<div class="pay-import"><section class="pay-import-preview" aria-label="What this import will do"><p class="pay-import-file"><strong>${kindLabel}</strong> · ${file}</p>
  ${blocking.length ? `<div class="pay-banner pay-banner-warn" role="alert"><strong>This file cannot be imported.</strong><ul class="pay-import-list">${blocking.map((b) => `<li>${b}</li>`).join('')}</ul></div>` : ''}
  <dl class="pay-import-counts">${counts.join('')}</dl>
  ${hints.map((t) => `<p class="pay-hint">${t}</p>`).join('')}
  ${settle ? `<div class="pay-import-settle"><p class="pay-hint">Each day below should equal the <strong>UPI SETTLEMENT</strong> credit HDFC pays into the account the next morning (QR ${settle.qr}):</p><ul class="pay-import-list">${settle.days.map(([d, v]) => `<li>${d} — <strong>${v}</strong></li>`).join('')}</ul></div>` : ''}
  ${warnings.length ? `<ul class="pay-import-list pay-import-warn">${warnings.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}
  ${folds.join('')}
  <div class="pay-import-actions"><button type="button" class="pay-confirm"${disabled ? ' disabled=""' : ''}>${action}</button><button type="button" class="pay-skip">Choose a different file</button></div></section></div>`
}
const importDone = (sub, mismatch = '') => `<div class="pay-import"><section class="pay-import-done" aria-label="Import finished"><p class="pay-empty-tick" aria-hidden="true">✓</p><h2 class="pay-empty-title">Imported</h2><p class="pay-empty-sub">${sub}</p>${mismatch ? `<p class="pay-banner pay-banner-warn" role="alert"><strong>This is not what the preview showed.</strong> ${mismatch}. Someone may have imported or matched in the meantime. Nothing was lost — check the Match screen, and import the file again to see the current picture.</p>` : ''}<div class="pay-import-actions"><button type="button" class="pay-confirm">Go to matching</button><button type="button" class="pay-skip">Import another file</button></div></section></div>`

const createSheet = () => {
  const row = (ic, label, desc) => `<button type="button" class="sheet-row"><span class="sheet-row-icon">${icon(ic, 19, 'var(--ink)')}</span><span class="sheet-row-text"><span class="sheet-row-label">${label}</span><span class="sheet-row-desc">${desc}</span></span>${icon('arrow-right', 16, 'var(--text-muted)')}</button>`
  return `<div class="sheet-backdrop"><div class="sheet-panel" role="dialog" aria-modal="true" aria-label="Create new"><div class="sheet-head"><span class="sheet-title">Create new</span><button class="sheet-close" aria-label="Close">${icon('x', 20)}</button></div>${row('wrench', 'New Vendor Job', 'Outside-workshop / ancillary repair job')}${row('rupee', 'Match Payments', 'Which bill did each UPI payment pay?')}</div></div>`
}
const drawer = () => {
  const link = (ic, label, active = false) => `<a class="drawer-link${active ? ' active' : ''}" href="#">${icon(ic, 18, active ? '#fff' : 'rgba(255,255,255,.7)')}<span>${label}</span></a>`
  return `<div class="drawer-backdrop"><div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Navigation"><div class="drawer-head"><img class="drawer-logo" src="paras-logo.png" alt="Paras Trucks"><button class="drawer-close" aria-label="Close menu">${icon('x', 22, '#fff')}</button></div><nav class="drawer-nav">${link('dashboard', 'Home')}<div class="drawer-section"><div class="drawer-section-label">Service Tools</div>${link('wrench', 'Vendor Jobs')}${link('rupee', 'Match Payments')}</div></nav></div></div>`
}

// ── the states ───────────────────────────────────────────────────────────
const acct = { role: 'accounts', name: 'Tester Accounts' }
const svcHead = pageHead()
const acctHead = (n, active = 'match') => pageHead({ tabs: true, count: n, active })
const STATES = [
  { id: 'E1a', title: 'Service exec: bottom nav on the Home page (no Match Payments tab)', replica: true, body: `<div class="page-head"><div><div class="page-head-crumb">Paras Trucks & Buses</div><h1 class="page-head-title">Home<span class="period-accent">.</span></h1></div></div><p class="pay-hint">(home page content)</p>` },
  { id: 'E1b', title: 'Service exec: the Create (+) sheet open', replica: true, body: `<div class="page-head"><div><div class="page-head-crumb">Paras Trucks & Buses</div><h1 class="page-head-title">Home<span class="period-accent">.</span></h1></div></div>`, overlay: createSheet() },
  { id: 'E1c', title: 'Service exec: the menu drawer open', replica: true, body: `<div class="page-head"><div><h1 class="page-head-title">Home<span class="period-accent">.</span></h1></div></div>`, overlay: drawer() },
  { id: 'E2', title: 'Accounts: page head with Match (9) / Import tabs, first payment', replica: 'head', ...acct, body: acctHead(9) + match({ receipt: R.jayesh, result: res([C.jay]) }) },
  { id: 'E3', title: 'Service exec view: no tabs, "Not a service payment" opened → accounts decides', body: svcHead + match({ receipt: R.jayesh, result: res([C.jay]), onNotService: undefined }).replace('</div><div class="pay-confirmbar">', '</div><p class="pay-hint" role="status">Accounts decides what is not a service payment. Skip it for now — it stays in the queue for them.</p><div class="pay-confirmbar">') },
  { id: 'E4', title: 'Wrong department: the denied hint', replica: true, body: svcHead + `<div class="pay-match"><p class="pay-hint" role="status">Matching payments is for the service and accounts teams.</p></div>` },
  { id: 'E5', title: 'Loading spinner', replica: true, body: svcHead + `<div class="full-center"><div class="spinner"></div></div>` },
  { id: 'M1', title: 'One clear bill; payer name unrelated to the customer', body: svcHead + match({ receipt: R.jayesh, result: res([C.jay]) }) },
  { id: 'M1s', title: 'M1 with the bill selected: Confirm ₹2,150.00', body: svcHead + confirmLabel(selectFirst(match({ receipt: R.jayesh, result: res([C.jay]) }), ['Billed the same day']), 'Confirm ₹2,150.00') },
  { id: 'M2', title: 'Part payment ₹10,000 against ₹25,000, selected', body: svcHead + confirmLabel(selectFirst(match({ receipt: R.ganga, result: res([C.ganga]) }), ['Billed yesterday']), 'Confirm ₹10,000.00 · part-paid') },
  { id: 'M3', title: 'No bill matches this payment', body: svcHead + match({ receipt: R.quick, result: res([], { reason: NO_BILL }) }) },
  { id: 'M4', title: 'Two bills at the same amount, a person picks', body: svcHead + match({ receipt: R.mehul, result: res([C.harsh, C.indu]) }) },
  { id: 'M5', title: 'A "2 bills" job card (parts + labour)', body: svcHead + match({ receipt: R.suresh, result: res([C.fleet]) }) },
  { id: 'M6', title: 'Five identical ₹1,930 bills, ranked', body: svcHead + match({ receipt: R.asha, result: res(fiveDef) }) },
  { id: 'M7', title: 'Four identical ₹1,930 bills, not ranked', body: svcHead + match({ receipt: R.nirav, result: res(fourDef, { refuse_to_rank: true, reason: 'These bills are equally likely — the list is not ranked. Pick by name, or skip.' }) }) },
  { id: 'M8', title: 'Bills are out of date: Confirm off', body: svcHead + match({ receipt: R.bhavin, result: res(fourDef, { refuse_to_rank: true, reason: 'The invoice feed is out of date — confirm is disabled until fresh bills land.' }), feedIsStale: true, feedAsOf: '11 Oct, 11:59 pm' }) },
  { id: 'M9a', title: '"Bill not raised yet" tapped: the wait question (first time)', body: svcHead + match({ receipt: R.quick, result: res([], { reason: NO_BILL }) }).replace('<div class="pay-confirmbar">', `<div class="pay-wait" role="group" aria-label="Wait for its bill"><p class="pay-hint">Wait for its bill? It leaves today’s list and comes back by itself when a newly imported bill could be its own.</p><div class="pay-escapes"><button type="button" class="pay-secondary">Yes, wait for the bill</button><button type="button" class="pay-secondary">Cancel</button></div></div><div class="pay-confirmbar">`) },
  { id: 'M9b', title: '"Still not raised" tapped on a waiting payment', body: svcHead + `<div class="pay-match pay-waiting-strip" role="status"><p class="pay-hint">Looking at payments waiting for their bills.</p><button type="button" class="pay-secondary">Back to today’s list</button></div>` + match({ receipt: R.quickWaiting, result: res([]), remaining: 1 }).replace('<div class="pay-confirmbar">', `<div class="pay-wait" role="group" aria-label="Wait for its bill"><p class="pay-hint">Still not raised? It goes back to waiting, and returns only for a bill imported after now.</p><div class="pay-escapes"><button type="button" class="pay-secondary">Yes, keep waiting</button><button type="button" class="pay-secondary">Not waiting — keep it in today’s list</button></div></div><div class="pay-confirmbar">`) },
  { id: 'M10', title: 'The waiting view: a payment waiting for its bill', body: svcHead + `<div class="pay-match pay-waiting-strip" role="status"><p class="pay-hint">Looking at payments waiting for their bills.</p><button type="button" class="pay-secondary">Back to today’s list</button></div>` + match({ receipt: R.quickWaiting, result: res([]), remaining: 1 }) },
  { id: 'M11', title: 'A waiting payment comes back: a bill imported since could be it', body: svcHead + match({ receipt: R.quickBack, result: res([bill({ label: 'LCS5756260000471', amount_paise: 777700, customer_name: 'DEMO QUICK FREIGHT', sap_customer_code: '0099000471', signals: [sig('amount_unique', 'only bill at this amount'), sig('name_overlap_strong', '25/25'), sig('date', 'd-4')] })]), remaining: 1 }) },
  { id: 'M12a', title: 'Nothing left to match (3 done)', body: svcHead + match({ receipt: null, doneToday: 3 }) },
  { id: 'M12b', title: 'Everything is matched, 1 waiting', replica: true, body: svcHead + empty('Everything is matched', '1 payment is waiting for its bill. It comes back by itself when a newly imported bill could be its.', ['Look at the 1 waiting for its bill']) },
  { id: 'M12c', title: "That's all the waiting ones", replica: true, body: svcHead + empty('That’s all the waiting ones', 'They stay out of today’s list and come back by themselves when a newly imported bill could be theirs.', ['Back to today’s list'], false) },
  { id: 'M12d', title: '2 skipped, everything else matched (service exec)', replica: true, body: svcHead + empty('2 skipped', 'Everything else is matched. The skipped payments are still waiting — accounts will see them too. 1 more is waiting for its bill.', ['Go through the skipped ones again', 'Look at the 1 waiting for its bill'], false) },
  { id: 'M13', title: '"Not a service payment" opened (accounts): the reasons', ...acct, body: acctHead(3) + match({ receipt: R.kisan30, result: res([], { reason: NO_BILL }), remaining: 3 }).replace('<div class="pay-confirmbar">', `<ul class="pay-reasons" aria-label="What kind of payment is this?">${['Vehicle booking advance', 'Sister business', 'Refund coming back', 'Not a customer payment', 'Something else'].map((l) => `<li><button type="button" class="pay-reason">${l}</button></li>`).join('')}</ul><div class="pay-confirmbar">`) },
  { id: 'M14a', title: 'Saving… (confirm in flight)', body: svcHead + match({ receipt: R.jayesh, result: res([C.jay]), pendingId: 'c1' }) },
  { id: 'M14b', title: "Couldn't load payments", replica: true, body: svcHead + `<div class="pay-match"><p class="pay-banner pay-banner-warn" role="alert"><strong>Couldn’t load payments.</strong> TypeError: Failed to fetch</p><button type="button" class="pay-secondary">Try again</button></div>` },
  { id: 'M15', title: 'No name given / Unnamed customer', body: svcHead + match({ receipt: R.noname, result: res([bill({ label: 'MPI5756260000455', amount_paise: 450000, customer_name: null, sap_customer_code: '0099000455', signals: [sig('amount_unique', 'only bill at this amount'), sig('date', 'd0')] })]) }) },
  { id: 'M16', title: 'M6 with ASHA selected: all reasons shown', body: svcHead + confirmLabel(selectFirst(match({ receipt: R.asha, result: res(fiveDef) }), ['Billed the same day']), 'Confirm ₹1,930.00') },
  { id: 'M17', title: 'Long names and a big amount at phone width', body: svcHead + match({ receipt: rc({ id: 'r11', amount_paise: 123456789, payer_name: 'SHREE GANESH TRANSPORT AND LOGISTICS PRIVATE LIMITED AHMEDABAD', received_at: T(11, '18:05') }), result: res([bill({ label: 'PCR5756260000499', amount_paise: 123456789, customer_name: 'SHREE GANESH TRANSPORT AND LOGISTICS PRIVATE LIMITED', sap_customer_code: '0099000499', signals: [sig('amount_unique', 'only bill at this amount'), sig('name_overlap_strong', '25/25'), sig('date', 'd1')] })]) }) },
  { id: 'M18', title: 'Partly matched receipt: "left of ₹25,000"', body: svcHead + match({ receipt: rc({ id: 'r12', amount_paise: 1500000, face_paise: 2500000, partly_matched: true, payer_name: 'GANGA SAGAR MAHESHWARI', received_at: T(9, '16:20') }), result: res([], { reason: NO_BILL }) }) },
  { id: 'S1', title: 'Search: idle', body: svcHead + search({ receipt: R.quick }) },
  { id: 'S2', title: 'Search: searching', body: svcHead + searchState(R.quick, '7777', 'Searching…') },
  { id: 'S3', title: 'Search: no open bill matches', body: svcHead + searchState(R.quick, '7777', 'No open bill matches that.') },
  { id: 'S4', title: 'Search: 3 results for "sharma"', body: svcHead + searchState(R.mehul, 'sharma', '3 open bills', [
    { total_paise: 480000, allocated_paise: 0, customer_name: 'RAMESH SHARMA', invoice_number: 'MPI5756260000460', sap_customer_code: '0099000460', invoice_date: '2026-10-10', vehicle_reg_no: 'GJ01DM4821' },
    { total_paise: 2500000, allocated_paise: 1000000, customer_name: 'SHARMA ROADWAYS', invoice_number: 'PCR5756260000418', sap_customer_code: '0099000418', invoice_date: '2026-10-09', vehicle_reg_no: 'GJ05DM0077' },
    { total_paise: 193000, allocated_paise: 0, customer_name: 'KAMAL SHARMA', invoice_number: 'MPI5756260000502', sap_customer_code: '0099000502', invoice_date: '2026-10-11' },
  ]) },
  { id: 'S5', title: 'Back from search: the found bill with its warning', body: svcHead + match({ receipt: R.quick, result: res([bill({ label: 'LCS5756260000471', amount_paise: 777700, customer_name: 'DEMO QUICK FREIGHT', sap_customer_code: '0099000471', signals: [sig('search', '12 Oct')] })], { reason: 'You found this bill by searching. Check the customer and amount before confirming.' }) }) },
  { id: 'I0', title: 'Import: choose a file', replica: true, ...acct, body: acctHead(0, 'import') + importPick() },
  { id: 'I1', title: 'Import: Billing Report 1 preview', replica: true, ...acct, body: acctHead(0, 'import') + importPreview({ kindLabel: 'SAP Billing Report', file: 'DEMO Billing Report 1.xlsx', counts: [count('New bills', 20, '18 to be paid · ₹1,09,876.72', true)], hints: ['Also new, but not owed by customers: 1 free of cost (₹2,000.00) · 1 parts return, on hold until accounts decide (₹1,250.00).', 'Bills are complete up to <strong>11 Oct, 11:59 pm</strong>. Payments after that will show “bills out of date” on the Match screen until the next Billing Report.'], action: 'Import 20 new bills' }) },
  { id: 'I2', title: 'Import: the same file again, blocked', replica: true, ...acct, body: acctHead(0, 'import') + importPreview({ kindLabel: 'SAP Billing Report', file: 'DEMO Billing Report 1.xlsx', blocking: ['This exact file was already imported on 12 Oct, 9:14 am. Choose a newer export.'], counts: [count('New bills', 0, '', true), count('Already stored, unchanged', 20)], action: 'Nothing to import', disabled: true }) },
  { id: 'I3', title: 'Import: HDFC report 1 preview with a failed attempt and the tie-out', replica: true, ...acct, body: acctHead(0, 'import') + importPreview({ kindLabel: 'HDFC SmartHub transaction report', file: 'DEMO HDFC report 1.xlsx', counts: [count('New payments', 10, '₹56,012.67', true), count('Failed attempts — not money', 1)], settle: { qr: 'KTR510/DEMO0001', days: [['Wed 8 Oct', '₹2,150.00'], ['Thu 9 Oct', '₹22,375.67'], ['Fri 10 Oct', '₹27,627.00'], ['Sat 11 Oct', '₹3,860.00']] }, warnings: ['1 row not imported — see below.', '1 payment of ₹50 or less (a test or a top-up) — imported, shown in matching.'], folds: [fold('Failed attempts — not money', ['Row 7 — ₹4,800.00 from RAMESH SHARMA, 10 Oct, 11:02 am — not imported; the payer usually tried again'])], action: 'Import 10 new payments' }) },
  { id: 'I4', title: "Import: this morning's HDFC report, overlapping yesterday", replica: true, ...acct, body: acctHead(0, 'import') + importPreview({ kindLabel: 'HDFC SmartHub transaction report', file: 'DEMO HDFC report 2.xlsx', counts: [count('New payments', 1, '₹1,930.00', true), count('Already imported', 2)], settle: { qr: 'KTR510/DEMO0001', days: [['Sat 11 Oct', '₹3,860.00'], ['Sun 12 Oct', '₹1,930.00']] }, action: 'Import 1 new payment' }) },
  { id: 'I5', title: 'Import: Billing Report 2 with a change and a clash', replica: true, ...acct, body: acctHead(0, 'import') + importPreview({ kindLabel: 'SAP Billing Report', file: 'DEMO Billing Report 2.xlsx', counts: [count('New bills', 2, '₹9,277.00', true), count('Changed since last import', 1), count('Already stored, unchanged', 18), count('Clash with what is stored', 1, '', false, true)], hints: ['Bills are complete up to <strong>12 Oct, 11:59 pm</strong>. Payments after that will show “bills out of date” on the Match screen until the next Billing Report.'], warnings: ['1 bill clashes with what is stored and will be left as it is — see Clashes below.'], folds: [fold('Clashes', ['MPI5756260000501 — cancelled in SAP, but ₹1,930.00 is matched to it. Reverse that match first, then import again.']), fold('Changed since last import', ['MPI5756260000447 — total: ₹745.00 → ₹845.00'])], action: 'Import 2 new bills and 1 change' }) },
  { id: 'I6', title: 'Import: done', replica: true, ...acct, body: acctHead(0, 'import') + importDone('20 new · 0 changed · 0 unchanged') },
  { id: 'I7', title: 'Import: done, but not what the preview showed', replica: true, ...acct, body: acctHead(0, 'import') + importDone('9 new · 1 already there', 'new: expected 10, got 9') },
  { id: 'I8', title: 'Import: reading the file', replica: true, ...acct, body: acctHead(0, 'import') + `<div class="pay-import"><p class="pay-hint" role="status">Reading the file and checking it against what is stored…</p></div>` },
  { id: 'I9', title: 'Import: retry after a dropped connection', replica: true, ...acct, body: acctHead(0, 'import') + importPick('This file is already imported — most likely by your previous attempt, whose answer was lost. Nothing was imported twice.') },
]

// ── write html + text dumps ──────────────────────────────────────────────
function textOf(html) {
  const body = html.replace(/^[\s\S]*<main class="app-main">/, '').replace(/<nav class="bottom-nav">[\s\S]*$/, '')
  return body.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<\/(p|h1|h2|li|div|section|button|dt|dd|label|summary|a|option)>/g, '\n')
    .replace(/<\/span>(?=<span class="pay-candidate-|<span class="pay-chip)/g, '\n')
    .replace(/<\/span><\/span>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}
const index = []
for (const s of STATES) {
  const html = shell({ body: s.body, role: s.role, name: s.name, overlay: s.overlay, title: `${s.id} — ${s.title}` })
  fs.writeFileSync(path.join(OUT, `${s.id}.html`), html)
  fs.writeFileSync(path.join(OUT, `${s.id}.txt`), `# ${s.id} — ${s.title}${s.replica ? `  [replica${s.replica === 'head' ? ': page head only' : ''}]` : ''}\n\n${textOf(html)}\n`)
  index.push({ id: s.id, title: s.title, replica: !!s.replica, role: s.role || 'service', overlay: !!s.overlay })
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2))
console.log(`${STATES.length} states → ${OUT}`)
