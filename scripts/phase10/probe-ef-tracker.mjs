// scripts/phase10/probe-ef-tracker.mjs
// Live check of the DEPLOYED admin-vehicle-units + admin-users (tracker switch) on STAGING,
// signed in as the real staging test accounts, over the real network.
//
//   PowerShell:  $env:PROBE_PASSWORD = '...'; node scripts/phase10/probe-ef-tracker.mjs; Remove-Item Env:\PROBE_PASSWORD
//
// STAGING ONLY — reads the public URL + publishable key from .env and refuses anything else.
// The password is read once and never stored or printed. The staging test accounts share it.
//
// WHAT IT WRITES (staging, dummy data only):
//   * flips svc.exec@'s tracker switch ON, then OFF again (and puts back whatever it found);
//   * creates ONE dummy vehicle row "DEMO-PROBE-…" and rebills it, so TWO rows stay behind
//     (they double as Stage 2's first rows on staging), with one note and one cell colour;
//   * makes two saved layouts and deletes both again through deleteView;
//   * security_audit_log rows for the switch flips and one "copy".
// Everything else is built to stop before a write (a refusal, a conflict, a missing row).
//
// What it does NOT cover: HR seeing incentives (no HR account on staging — covered offline by
// scripts/phase10/selftest-vehicle-units.mjs, which checks every rank × department).

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const STAGING_REF = 'klpnhpnlotcbbovwswmq'
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }),
)
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) { console.error('.env must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'); process.exit(2) }
if (!URL.includes(STAGING_REF)) { console.error(`Refusing: .env points at ${URL}, not staging.`); process.exit(2) }
const password = process.env.PROBE_PASSWORD
if (!password) {
  console.error("Set PROBE_PASSWORD first:  $env:PROBE_PASSWORD = '...'; node scripts/phase10/probe-ef-tracker.mjs")
  process.exit(2)
}

const ACCOUNTS = ['admin@parastrucks.test', 'tester@parastrucks.test', 'gm@parastrucks.test',
  'svc.mgr@parastrucks.test', 'svc.exec@parastrucks.test', 'pt.mgr@parastrucks.test']
const GRANTEE = 'svc.exec@parastrucks.test'
const ADMIN = 'admin@parastrucks.test'

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12)
const chassis = `DEMO-PROBE-${stamp}`
let pass = 0, fail = 0
const problems = []
const check = (cond, label, detail) => {
  if (cond) { pass++; return true }
  fail++; problems.push(label + (detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''))
  return false
}

async function call(token, fn, action, payload = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: KEY, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ action, payload }),
      })
      let body = null; try { body = await r.json() } catch { /* not json */ }
      return { status: r.status, body: body ?? {} }
    } catch (e) {
      if (attempt >= 3) return { status: 0, body: { error: e.message } }
      await new Promise(res => setTimeout(res, 1500 * attempt))
    }
  }
}
const T = (tok, action, payload) => call(tok, 'admin-vehicle-units', action, payload)
const AU = (tok, action, payload) => call(tok, 'admin-users', action, payload)

// ── sign in ──────────────────────────────────────────────────────────────────────────────────
const who = {}
for (const email of ACCOUNTS) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  let r = null
  for (let attempt = 1; attempt <= 3 && !r?.data?.session; attempt++) {
    r = await sb.auth.signInWithPassword({ email, password })
    if (!r.data?.session && !/fetch failed|network|timeout/i.test(r.error?.message ?? '')) break
  }
  if (!r?.data?.session) { console.error(`${email}: sign-in failed (${r?.error?.message})`); process.exit(1) }
  const { data: prof, error } = await sb.from('users').select('permission_level').eq('id', r.data.user.id).maybeSingle()
  if (error || !prof) { console.error(`${email}: could not read own profile — stopping (an expectation built from a failed read is not an expectation)`); process.exit(1) }
  who[email] = { token: r.data.session.access_token, id: r.data.user.id, level: prof.permission_level }
}
const admin = who[ADMIN], grantee = who[GRANTEE]
if (admin.level !== 'admin') { console.error('admin@ is not admin on staging — stopping'); process.exit(1) }
console.log('signed in:', Object.entries(who).map(([e, w]) => `${e.split('@')[0]}(${w.level})`).join(' '))

// starting switches, so the probe can put them back
const start = await AU(admin.token, 'listTrackerAccess')
if (!check(start.status === 200 && Array.isArray(start.body.access), 'admin listTrackerAccess', start)) { report(); process.exit(1) }
const startFlags = Object.fromEntries(start.body.access.map(a => [a.id, a]))
const hasAccess = (w) => w.level === 'admin' || startFlags[w.id]?.tracker_access === true
console.log('switch ON at start for:', Object.entries(who).filter(([, w]) => startFlags[w.id]?.tracker_access).map(([e]) => e).join(', ') || 'nobody')

// ── A. the gate, every account × every action, with payloads that stop before any write ─────
const STOP = {
  list: { columns: [] }, history: {}, listNotes: {}, listFormats: {}, listViews: {},
  applyChanges: {}, createUnit: { values: {} }, supersedeUnit: {}, addNote: {}, setFormats: {},
  saveView: {}, deleteView: {}, logExport: { kind: 'neither' },
}
for (const [email, w] of Object.entries(who)) {
  for (const [action, payload] of Object.entries(STOP)) {
    const r = await T(w.token, action, payload)
    if (hasAccess(w)) check(r.status !== 401 && r.status !== 403 && r.status > 0 && r.status < 500, `A ${email} ${action}: expected through the gate`, r)
    else check(r.status === 403 && r.body.error === 'No access to the vehicle tracker', `A ${email} ${action}: expected refused`, r)
    if (r.status === 200 && ['createUnit'].includes(action)) check(r.body.ok === false, `A ${email} createUnit {} must not create`, r)
  }
  const u = await T(w.token, 'dropTable', {})
  check(u.status === (hasAccess(w) ? 400 : 403), `A ${email} unknown action`, u)
}

// ── B. the switch itself: only admin may flip it ─────────────────────────────────────────────
for (const [email, w] of Object.entries(who)) {
  if (w.level === 'admin') continue
  const s = await AU(w.token, 'setTrackerAccess', { id: grantee.id, tracker_access: true, tracker_export: false })
  check(s.status === 403, `B ${email} setTrackerAccess must be refused`, s)
  const l = await AU(w.token, 'listTrackerAccess', {})
  check(l.status === 403, `B ${email} listTrackerAccess must be refused`, l)
}
let r = await AU(admin.token, 'setTrackerAccess', { id: grantee.id, tracker_access: false, tracker_export: true })
check(r.status === 400, 'B export without access refused', r)
r = await AU(admin.token, 'setTrackerAccess', { id: admin.id, tracker_access: true, tracker_export: false })
check(r.status === 400, 'B admin needs no switch (refused)', r)
r = await AU(admin.token, 'setTrackerAccess', { id: grantee.id, tracker_access: true, tracker_export: false })
check(r.status === 200 && r.body.ok === true && r.body.sessions_revoked === false, 'B grant svc.exec (no logout on grant)', r)
r = await AU(admin.token, 'listTrackerAccess')
check(r.body.access?.some(a => a.id === grantee.id && a.tracker_access && !a.tracker_export), 'B grant is listed', r)

// ── C. the SAME token now gets in (fresh getUser per call), with the right limits ────────────
const g = grantee.token
r = await T(g, 'list', { columns: ['chassis_no', 'ctc', 'dsm_incentive'] })
check(r.status === 200 && r.body.ok && r.body.hidden?.includes('dsm_incentive'), 'C grantee lists; incentive hidden', r)
r = await T(admin.token, 'list', { columns: ['chassis_no', 'ctc', 'dsm_incentive'] })
check(r.status === 200 && r.body.hidden?.length === 0, 'C admin lists; incentive not hidden', r)
r = await T(g, 'logExport', { kind: 'export', rows: 1, columns: ['chassis_no'] })
check(r.status === 403, 'C download refused without tracker_export', r)
r = await T(g, 'logExport', { kind: 'copy', rows: 1, columns: ['chassis_no', 'ctc'] })
check(r.status === 200, 'C copy allowed and logged', r)
r = await T(who['svc.mgr@parastrucks.test'].token, 'list', { columns: ['chassis_no'] })
check(r.status === 403 || hasAccess(who['svc.mgr@parastrucks.test']), 'C a manager without the switch is still refused', r)

// ── D. the write path, end to end (dummy rows) ────────────────────────────────────────────────
r = await T(g, 'createUnit', { values: { chassis_no: chassis, customer_name: 'DEMO PROBE CUSTOMER', tally_bill: '3000000', ptb_invoice_date: '2025-10-01', qty: '' } })
const unit = r.body.row
check(r.status === 200 && r.body.ok && unit?.chassis_no === chassis, 'D createUnit', r)
if (unit) {
  check(Number(unit.tcs) === 30000 && Number(unit.gst_rate) === 18 && unit.qty === 1 && Number(unit.road_tax_pct) === 6,
    'D createUnit: computed + defaults (TCS 1% of bill, GST 18% after 22 Sep 2025, qty 1, road tax 6%)', unit)
  r = await T(g, 'createUnit', { values: { chassis_no: chassis } })
  check(r.status === 409, 'D the same chassis twice refused', r)

  r = await T(g, 'applyChanges', { client_request_id: randomUUID(), changes: [{ unit_id: unit.id, column: 'ctc', before: null, after: '12,34,567' }] })
  check(r.status === 200 && r.body.ok === false && r.body.rejected?.[0]?.reason === 'not a number', 'D lakh commas refused cell by cell', r)
  r = await T(g, 'applyChanges', { client_request_id: randomUUID(), changes: [
    { unit_id: unit.id, column: 'ctc', before: null, after: 1 }, { unit_id: unit.id, column: 'ctc', before: null, after: 2 }] })
  check(r.body.ok === false && /twice/.test(r.body.rejected?.[0]?.reason ?? ''), 'D the same cell twice refused', r)
  r = await T(g, 'applyChanges', { client_request_id: randomUUID(), changes: [{ unit_id: randomUUID(), column: 'ctc', before: null, after: 1 }] })
  check(r.status === 200 && r.body.ok === false && r.body.rejected?.[0]?.reason === 'no such row', 'D a missing row reaches the database and is refused there', r)

  const R1 = randomUUID()
  r = await T(g, 'applyChanges', { client_request_id: R1, source: 'paste', changes: [{ unit_id: unit.id, column: 'ctc', before: null, after: 2800000 }] })
  check(r.body.ok === true && r.body.applied === 1 && Number(r.body.rows?.[0]?.ctc) === 2800000, 'D a paste saves and returns the recomputed row', r)
  r = await T(g, 'applyChanges', { client_request_id: R1, source: 'paste', changes: [{ unit_id: unit.id, column: 'ctc', before: null, after: 2800000 }] })
  check(r.body.ok === true && r.body.replayed === true, 'D the same request again replays, does not apply twice', r)
  r = await T(admin.token, 'applyChanges', { client_request_id: R1, changes: [{ unit_id: unit.id, column: 'ctc', before: null, after: 5 }] })
  check(r.body.replayed !== true && r.body.ok === false && r.body.conflicts?.length === 1, "D another person's request id is not theirs to replay (and the stale value conflicts)", r)

  r = await T(g, 'history', { unit_id: unit.id })
  const h = r.body.history ?? []
  check(h.some(x => x.column_key === 'ctc' && x.new_value === '2800000' && x.source === 'paste' && x.actor === grantee.id && x.actor_name),
    'D history shows who pasted what', h)
  check(h.some(x => x.column_key === '*' && x.source === 'create'), 'D history shows the row being created', h)

  r = await T(g, 'addNote', { unit_id: unit.id, column_key: 'ctc', body: 'DEMO probe note' })
  check(r.status === 200 && r.body.note?.id, 'D addNote', r)
  r = await T(g, 'addNote', { unit_id: unit.id, column_key: 'dsm_incentive', body: 'x' })
  check(r.status === 403, 'D a note on an incentive cell refused for non-HR', r)
  r = await T(g, 'listNotes', {})
  check(r.body.notes?.some(n => n.unit_id === unit.id && n.body === 'DEMO probe note' && n.author_name), 'D listNotes', r)
  r = await T(g, 'setFormats', { formats: [{ unit_id: unit.id, column_key: 'ctc', format: { bg: { rgb: '#FFFF00' } } }] })
  check(r.status === 200 && r.body.saved === 1, 'D setFormats', r)
  r = await T(g, 'listFormats', {})
  check(r.body.formats?.some(f => f.unit_id === unit.id && f.column_key === 'ctc'), 'D listFormats', r)

  // layouts
  r = await T(g, 'saveView', { name: `ZZ probe layout ${stamp}`, columns: ['chassis_no', 'ctc', 'dsm_incentive'] })
  const mine = r.body.view
  check(r.status === 200 && mine?.owner_id === grantee.id, 'D personal layout saved', r)
  r = await T(g, 'saveView', { name: `ZZ probe shared ${stamp}`, columns: ['chassis_no'], shared: true })
  check(r.status === 403, 'D a user cannot publish a shared layout', r)
  r = await T(admin.token, 'saveView', { name: `ZZ probe shared ${stamp}`, columns: ['chassis_no', 'gm_incentive'], shared: true })
  const shared = r.body.view
  check(r.status === 200 && shared?.owner_id === null, 'D admin publishes a shared layout', r)
  r = await T(g, 'listViews', {})
  const vs = r.body.views ?? []
  check(vs.some(v => v.id === mine?.id) && vs.some(v => v.id === shared?.id), 'D grantee sees own + shared layouts', vs)
  check(!vs.find(v => v.id === shared?.id)?.columns.includes('gm_incentive') && !vs.find(v => v.id === mine?.id)?.columns.includes('dsm_incentive'),
    'D incentive columns stripped from layouts for non-HR', vs)
  r = await T(admin.token, 'listViews', {})
  check(!(r.body.views ?? []).some(v => v.id === mine?.id), "D admin does not see someone's personal layout", r)
  if (shared) { r = await T(g, 'deleteView', { id: shared.id }); check(r.status === 403, 'D a user cannot delete a shared layout', r) }
  if (mine) { r = await T(admin.token, 'deleteView', { id: mine.id }); check(r.status === 403, "D admin cannot delete someone's personal layout", r) }
  if (mine) { r = await T(g, 'deleteView', { id: mine.id }); check(r.status === 200, 'D own layout deleted', r) }
  if (shared) { r = await T(admin.token, 'deleteView', { id: shared.id }); check(r.status === 200, 'D shared layout deleted by admin', r) }

  // rebill
  r = await T(g, 'supersedeUnit', { unit_id: unit.id, values: { customer_name: 'DEMO PROBE REBILL' } })
  const newId = r.body.id
  const oldRow = (r.body.rows ?? []).find(x => x.id === unit.id), newRow = (r.body.rows ?? []).find(x => x.id === newId)
  check(r.status === 200 && oldRow?.superseded_by_id === newId && newRow?.chassis_no === chassis && newRow?.customer_name === 'DEMO PROBE REBILL',
    'D rebill: old row closed and linked, new row on the same chassis', r)
  r = await T(g, 'supersedeUnit', { unit_id: unit.id, values: {} })
  check(r.status === 409, 'D rebilling the same row twice refused', r)
  r = await T(g, 'supersedeUnit', { unit_id: randomUUID(), values: {} })
  check(r.status === 404, 'D rebill of a missing row', r)
  r = await T(g, 'list', { columns: ['chassis_no'] })
  check(r.body.rows?.some(x => x.id === newId) && !r.body.rows?.some(x => x.id === unit.id), 'D list hides the rebilled row by default', r.body.rows?.length)
  r = await T(g, 'list', { columns: ['chassis_no'], includeSuperseded: true })
  check(r.body.rows?.some(x => x.id === unit.id), 'D includeSuperseded shows it', r.body.rows?.length)
}

// ── E. taking it away bites at once: the SAME token is refused on its next call ──────────────
r = await AU(admin.token, 'setTrackerAccess', { id: grantee.id, tracker_access: false, tracker_export: false })
check(r.status === 200 && r.body.sessions_revoked === true, 'E switch off revokes sessions', r)
r = await T(g, 'list', { columns: ['chassis_no'] })
check(r.status === 401 || r.status === 403, 'E the old token is refused on its very next call', r)

// put back whatever was there at the start
const was = startFlags[grantee.id]
if (was && (was.tracker_access || was.tracker_export)) {
  r = await AU(admin.token, 'setTrackerAccess', { id: grantee.id, tracker_access: was.tracker_access, tracker_export: was.tracker_export })
  check(r.status === 200, 'E starting switch restored', r)
}

report()
function report() {
  console.log(`\nprobe-ef-tracker: ${pass} passed, ${fail} failed`)
  for (const p of problems) console.log('  FAIL ' + p)
  console.log(`\nLeft on staging (dummy): rows with chassis ${chassis} (original + rebill), one note, one cell colour; svc.exec signed out.`)
  process.exitCode = fail ? 1 : 0
}
