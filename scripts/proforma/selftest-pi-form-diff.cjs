// Differential self-test of src/pages/ProformaInvoice.jsx (written for the 2026-10-22 hotfix, PR #134).
//
// Drives the REAL component in jsdom twice — once at a base git ref, once as it is now — with
// identical inputs, and compares what each would SAVE (proforma_invoices inserts), NUMBER (rpc),
// PRINT (generateProformaPdf args) and SHOW (inline errors, batch summary, button state).
// D-scenarios must be byte-identical before/after (back-office + admin with the switch off);
// N-scenarios assert the admin "Without chassis & engine no." behaviour on the current file.
// Supabase, auth, toast, PDF and Icon are replaced by ./pi-form-mocks.js, which only records.
//
// Proven able to fail (2026-10-22): planted bugs — switch ignored (noChassis = isAdmin), chassis
// no longer trimmed, TCS on unit MRP instead of the total — each produced FAILs; live file 29/29.
//
// Run from the repo root. jsdom + esbuild are NOT repo dependencies — install them OUTSIDE the repo:
//   npm i --prefix <scratch> --no-save --no-package-lock jsdom@24.1.3 esbuild@0.24.2
//   node scripts/proforma/selftest-pi-form-diff.cjs <scratch> [baseRef=d27a495^]
// NEW_FILE=<path> swaps the "current" side (use it to plant a bug and watch the test fail).
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')
const { createRequire } = require('module')

const DEPS = process.argv[2] || process.env.SELFTEST_DEPS
if (!DEPS) { console.error('usage: node scripts/proforma/selftest-pi-form-diff.cjs <dir with node_modules/jsdom + esbuild> [baseRef]'); process.exit(2) }
const depRequire = createRequire(path.join(path.resolve(DEPS), 'noop.js'))
const esbuild = depRequire('esbuild')
const { JSDOM } = depRequire('jsdom')

const WT = path.resolve(__dirname, '../..')
const BASE_REF = process.argv[3] || 'd27a495^'
const H = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-form-diff-'))
const OLD = path.join(H, 'ProformaInvoice.base.jsx')
fs.writeFileSync(OLD, execSync(`git show ${BASE_REF}:src/pages/ProformaInvoice.jsx`, { cwd: WT }))
const VARIANTS = { old: OLD, new: process.env.NEW_FILE || path.join(WT, 'src/pages/ProformaInvoice.jsx') }
const MOCK = path.join(__dirname, 'pi-form-mocks.js')
const MOCKED = { '../lib/supabase': 1, '../lib/fetchAll': 1, '../context/AuthContext': 1, '../context/ToastContext': 1, '../utils/pdfGenerator': 1, '../components/Icon': 1 }

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://team.parastrucks.in/proforma-invoice' })
const w = dom.window
for (const k of Object.getOwnPropertyNames(w)) if (!(k in globalThis)) { try { globalThis[k] = w[k] } catch {} }
globalThis.window = w; globalThis.document = w.document; globalThis.navigator = w.navigator
w.Element.prototype.scrollIntoView = function () {}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

async function bundle(name, file) {
  const entry = path.join(H, `entry-${name}.jsx`)
  fs.writeFileSync(entry, `export { default as C } from ${JSON.stringify(file.replace(/\\/g, '/'))}\nexport { createRoot } from 'react-dom/client'\nexport * as React from 'react'\n`)
  const out = path.join(H, `bundle-${name}.cjs`)
  await esbuild.build({
    entryPoints: [entry], bundle: true, outfile: out, format: 'cjs', platform: 'browser', jsx: 'automatic',
    nodePaths: [path.join(WT, 'node_modules')], define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'error',
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /^\.\.\// }, a => {
        if (MOCKED[a.path]) return { path: MOCK }
        if (a.path === '../lib/useDebounce') return { path: path.join(WT, 'src/lib/useDebounce.js') }
        return null
      })
    } }],
  })
  return require(out)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
function setVal(el, v) {
  const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new w.Event('input', { bubbles: true }))
}
const row = i => $$('.model-chip-row')[i]
const h = {
  async cust(o) { for (const [k, v] of Object.entries(o)) { setVal($('#pi-cust-' + k), v); await sleep(5) } },
  async add(q, idx = 0) { setVal($('#pi-search'), q); await sleep(260); const it = $$('.search-item')[idx]; if (!it) throw new Error('no search result for ' + q); it.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })); await sleep(20) },
  async addRow(m = 0) { $$('.model-chip-add-row')[m].click(); await sleep(10) },
  async field(r, which, v) {
    const R = row(r)
    const el = which === 'chassis' ? R.querySelector('input[id^=pi-chassis]') : which === 'engine' ? R.querySelector('input[id^=pi-engine]')
      : which === 'qty' ? R.querySelector('input[id^=pi-qty]') : which === 'desc' ? R.querySelector('textarea')
      : R.querySelectorAll('.model-chip-row-prices input')[{ mrp: 0, rto: 1, ins: 2 }[which]]
    if (!el) throw new Error(`row ${r} has no ${which} field`)
    setVal(el, v); await sleep(5)
  },
  hasSwitch() { return !!$('input[role=switch]') },
  async toggle() { $('input[role=switch]').click(); await sleep(10) },
  async submit() { $('button[type=submit]').click(); await sleep(150) },
  snap() {
    return {
      inserts: rec().inserts, rpcs: rec().rpcs, pdfs: rec().pdfs, toasts: rec().toasts,
      errors: $$('.form-error').map(e => e.textContent),
      summary: ($('.price-summary') || {}).textContent, submitDisabled: $('button[type=submit]').disabled,
      models: $$('.model-chip').length,
    }
  },
}
const rec = () => globalThis.__rec

globalThis.__ENT = { id: 'e-ptb', code: 'PTB', full_name: 'Paras Trucks & Buses', address: 'Ahmedabad', gstin: '24AAAAA0000A1Z5', bank_name: 'B', bank_account: '1', bank_ifsc: 'I' }
globalThis.__CATALOG = [
  { id: 1, cbn: 'CGE111017CC003', description: 'Ecomet 1110 CNG long description', sub_category: 'Ecomet CNG', segment: 'ICV Truck', tyres: '6', mrp_incl_gst: 2181395, brand_id: 'b-al' },
  { id: 2, cbn: 'CTB141500B0001', description: 'Boss 1415 HB tipper description', sub_category: 'Boss 1415', segment: 'Tipper', tyres: '6', mrp_incl_gst: 2650001, brand_id: 'b-al' },
]
const BO = { profile: { id: 'u-bo', entity_id: 'e-ptb', full_name: 'Back Office', permission_level: 'manager' }, isAdmin: false }
const ADMIN = { profile: { id: 'u-admin', entity_id: 'e-ptb', full_name: 'Admin', permission_level: 'admin' }, isAdmin: true }

async function mount(mod, auth) {
  globalThis.__rec = { inserts: [], rpcs: [], pdfs: [], toasts: [] }
  globalThis.__auth = auth
  document.body.innerHTML = '<div id="root"></div>'
  const root = mod.createRoot($('#root'))
  root.render(mod.React.createElement(mod.C))
  await sleep(60)
  return root
}

// Standard batch: 2 models, 3 PIs, edited MRP/description, RTO + insurance, all customer fields.
async function standardBatch(t) {
  await t.cust({ name: 'Acme Logistics', mobile: '9800000000', gstin: '24ABCDE1234F1Z5', addr: 'Ahmedabad, GJ', hyp: 'HDFC Bank' })
  await t.add('Ecomet'); await t.addRow(0)
  await t.add('Boss')
  await t.field(0, 'chassis', ' MB1CH0001 '); await t.field(0, 'engine', 'EN0001'); await t.field(0, 'rto', '125000'); await t.field(0, 'ins', '45001')
  await t.field(1, 'chassis', 'MB1CH0002'); await t.field(1, 'engine', 'EN0002'); await t.field(1, 'mrp', '2150000'); await t.field(1, 'desc', 'Edited particulars')
  await t.field(2, 'chassis', 'MB1CH0003'); await t.field(2, 'engine', 'EN0003')
}

const SCENARIOS = [
  // ---- differential: must be IDENTICAL before and after the hotfix ----
  { name: 'D1 back-office: normal 3-PI batch saves exactly as before', diff: true, auth: BO, run: async t => { await standardBatch(t); return t.snap() } },
  { name: 'D2 admin, switch OFF: normal batch saves exactly as before', diff: true, auth: ADMIN, run: async t => { await standardBatch(t); return t.snap() } },
  { name: 'D3 back-office: blank engine on row 2 is refused, nothing saved', diff: true, auth: BO, run: async t => {
    await standardBatch(t); await t.field(1, 'engine', '   '); await t.submit(); return t.snap() } },
  { name: 'D4 back-office: no customer name → button disabled, nothing saved', diff: true, auth: BO, run: async t => {
    await standardBatch(t); await t.cust({ name: '' }); await t.submit(); return t.snap() } },
  { name: 'D5 back-office: MRP 0 → button disabled, nothing saved', diff: true, auth: BO, run: async t => {
    await standardBatch(t); await t.field(2, 'mrp', '0'); await t.submit(); return t.snap() } },
  { name: 'D6 back-office: summary panel before submit', diff: true, auth: BO, run: async t => { await standardBatch(t); const s = t.snap(); return { summary: s.summary, disabled: s.submitDisabled } } },
  { name: 'D7 admin: switch ON then OFF — quantity typed meanwhile is ignored', diff: true, auth: ADMIN, run: async (t, v) => {
    await standardBatch(t)
    if (v === 'new') { await t.toggle(); await t.field(0, 'qty', '5'); await t.field(2, 'qty', '7'); await t.toggle() }
    return t.snap() } },
]
for (const s of SCENARIOS) { const r = s.run; s.run = async (t, v) => { const out = await r(t, v); if (s.name.startsWith('D3') || s.name.startsWith('D4') || s.name.startsWith('D5')) return out; await t.submit(); return t.snap() } }
SCENARIOS.find(s => s.name.startsWith('D6')).run = async t => { await standardBatch(t); const s = t.snap(); return { summary: s.summary, disabled: s.submitDisabled } }

// ---- new behaviour: assertions against the live component only ----
const NEW_ONLY = [
  { name: 'N1 back-office never sees the switch', auth: BO, run: async t => { const ok = !t.hasSwitch(); return [[ok, 'switch absent for back-office']] } },
  { name: 'N2 admin sees the switch, off by default', auth: ADMIN, run: async t => [[t.hasSwitch(), 'switch present'], [$('input[role=switch]') && !$('input[role=switch]').checked, 'unchecked by default']] },
  { name: 'N3 admin switch ON: qty 3 + qty 1, RTO/ins totals, no chassis', auth: ADMIN, run: async t => {
    await t.cust({ name: 'Fleet Co' }); await t.add('Ecomet'); await t.addRow(0)
    await t.field(0, 'chassis', 'SHOULD-NOT-SAVE'); await t.field(0, 'engine', 'NOPE')
    await t.toggle()
    await t.field(0, 'qty', '3'); await t.field(0, 'rto', '300000'); await t.field(0, 'ins', '90000')
    const sum = $('.price-summary').textContent
    await t.submit()
    const s = t.snap(), [a, b] = s.inserts.map(i => i.payload)
    const mrp = 2181395, tot = mrp * 3
    return [
      [!!a && !!b && s.inserts.length === 2, '2 PIs saved'],
      [a.chassis_no === '' && a.engine_no === '' && b.chassis_no === '' && b.engine_no === '', "chassis/engine stored as '' (typed values ignored)"],
      [a.line_items[0].qty === 3 && a.line_items[0].mrp === mrp && a.line_items[0].total_cost === tot, 'row 1: qty 3, unit MRP, total = MRP × 3'],
      [a.line_items[0].basic_amt === Math.round(tot / 1.18) && a.line_items[0].gst_amt === tot - Math.round(tot / 1.18), 'row 1: basic + GST split on the total'],
      [a.tcs_amount === Math.round(tot / 100) && a.rto_tax === 300000 && a.insurance === 90000, 'row 1: TCS 1% of total, RTO/ins as typed (PI totals)'],
      [a.grand_total === tot + Math.round(tot / 100) + 300000 + 90000, 'row 1: grand total'],
      [b.line_items[0].qty === 1 && b.line_items[0].total_cost === mrp && b.grand_total === mrp + Math.round(mrp / 100), 'row 2: qty 1 behaves like a normal PI'],
      [s.pdfs[0].chassisNo === '' && s.pdfs[0].engineNo === '' && s.pdfs[0].lineItems[0].qty === 3 && s.pdfs[0].grandTotal === a.grand_total, 'PDF args match the saved row'],
      [sum.includes('87,25,580') && sum.includes('4 units'), 'summary: total MRP ₹87,25,580 (4 × unit) and "4 units"'],
      [s.models === 0 && s.toasts.some(x => x[0] === 'success'), 'form reset + success toast'],
    ]
  } },
  { name: 'N4 admin switch ON: bad quantities are refused, nothing saved', auth: ADMIN, run: async t => {
    const out = []
    for (const q of ['', '0', '-1', '2.5', '1000', 'abc']) {
      await t.cust({ name: 'Q test' }); await t.add('Ecomet')
      if (!$('input[role=switch]').checked) await t.toggle()
      await t.field(0, 'qty', q); await t.submit()
      const s = t.snap()
      out.push([s.inserts.length === 0 && s.errors.some(e => e.includes('Quantity must be a whole number from 1 to 999')), `qty "${q}" refused`])
      $$('.model-chip-header button')[0].click(); await sleep(10)
    }
    await t.add('Ecomet'); await t.field(0, 'qty', '999'); await t.submit()
    const s = t.snap()
    out.push([s.inserts.length === 1 && s.inserts[0].payload.line_items[0].qty === 999, 'qty 999 accepted'])
    return out
  } },
  { name: 'N5 admin switch ON: error clears when the switch is turned off', auth: ADMIN, run: async t => {
    await t.cust({ name: 'E test' }); await t.add('Ecomet'); await t.toggle(); await t.field(0, 'qty', '0'); await t.submit()
    const had = t.snap().errors.length > 0
    await t.toggle()
    return [[had, 'qty error shown'], [t.snap().errors.length === 0, 'error cleared after switching off']]
  } },
]

;(async () => {
  const mods = { old: await bundle('old', VARIANTS.old), new: await bundle('new', VARIANTS.new) }
  let pass = 0, fail = 0
  for (const s of SCENARIOS) {
    const out = {}
    for (const v of ['old', 'new']) { const root = await mount(mods[v], s.auth); try { out[v] = await s.run(h, v) } catch (e) { out[v] = { crashed: e.message } } root.unmount() }
    const same = JSON.stringify(out.old) === JSON.stringify(out.new)
    const saved = (out.new.inserts || []).length
    console.log(`${same ? 'PASS' : 'FAIL'}  ${s.name}  (inserts=${saved}, errors=${JSON.stringify(out.new.errors || [])})`)
    if (!same) { fail++; const f = path.join(H, 'diff-' + s.name.slice(0, 2) + '.json'); fs.writeFileSync(f, JSON.stringify(out, null, 1)); console.log('      old vs new written to ' + f) } else pass++
  }
  for (const s of NEW_ONLY) {
    const root = await mount(mods.new, s.auth)
    let checks; try { checks = await s.run(h, 'new') } catch (e) { checks = [[false, 'crashed: ' + e.message]] } root.unmount()
    for (const [ok, label] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name} — ${label}`); ok ? pass++ : fail++ }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
