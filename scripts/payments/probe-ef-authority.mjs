// scripts/payments/probe-ef-authority.mjs
// Live check that the DEPLOYED service-payments Edge Function enforces the
// authority ladder — signed in as real users, over the real network.
//
//   node scripts/payments/probe-ef-authority.mjs
//
// STAGING ONLY. Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env and
// refuses to run against anything but the staging project.
//
// WRITES NOTHING. Every request is built to get past the authority gate and then
// stop on a deliberately missing field: an ALLOWED caller gets 400/404 ("…
// required", "not found"), a REFUSED caller gets 403 with the ladder's message.
// A 200 would mean a write happened — the probe treats that as a hard failure.
//
// The password is asked for once (typed, not echoed) and never stored, logged
// or written anywhere. The staging test accounts share one password.
//
// What this does NOT cover: departments with no staging test account (Sales,
// HR, Back Office, Spares, PDI). Those are covered offline, for every rank, by
// scripts/payments/selftest-authority.mjs — which also proves index.ts takes
// every role decision from authority.ts, the file that test checks.

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const STAGING_REF = 'klpnhpnlotcbbovwswmq'

// ── Config from .env (public values only — URL and publishable key) ────────
const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8')
    .split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()] }),
)
const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY
if (!URL || !KEY) { console.error('.env must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'); process.exit(2) }
if (!URL.includes(STAGING_REF)) {
  console.error(`Refusing: .env points at ${URL}, not staging (${STAGING_REF}).`)
  process.exit(2)
}
const EF = `${URL}/functions/v1/service-payments`

const ACCOUNTS = [
  'admin@parastrucks.test',
  'tester@parastrucks.test',
  'gm@parastrucks.test',
  'svc.mgr@parastrucks.test',
  'svc.exec@parastrucks.test',
  'pt.mgr@parastrucks.test',
]

// ── The plan's ladder, written out by hand (same table as the self-test) ───
const admin    = (p) => p.level === 'admin'
const inDept   = (p) => p.dept === 'service' || p.dept === 'accounts'
const accounts = (p) => admin(p) || p.dept === 'accounts'
const payGm    = (p) => admin(p) || (p.level === 'gm' && inDept(p))
const EXPECT = {
  allocate:              (p) => admin(p) || inDept(p),
  on_account:            accounts,
  reverse_allocation:    (p) => admin(p) || inDept(p),
  classify_receipt:      accounts,
  close_tds:             (p) => accounts(p) || payGm(p),
  manual_receipt:        accounts,
  void_receipt:          accounts,
  import_invoices:       accounts,
  import_receipts:       accounts,
  create_group:          payGm,
  assign_customer_group: payGm,
  set_credit_limit:      payGm,
}
// Payloads that pass the gate and then stop on a missing or unknown field.
const PAYLOAD = {
  allocate:              () => ({ receipt_id: randomUUID(), targets: [{ invoice_id: randomUUID(), amount_paise: 100 }] }),
  on_account:            () => ({}),
  reverse_allocation:    () => ({}),
  classify_receipt:      () => ({}),
  close_tds:             () => ({}),
  manual_receipt:        () => ({}),
  void_receipt:          () => ({}),
  import_invoices:       () => ({}),
  import_receipts:       () => ({}),
  create_group:          () => ({}),
  assign_customer_group: () => ({}),
  set_credit_limit:      () => ({}),
}

// ── Hidden password prompt ─────────────────────────────────────────────────
function askHidden(question) {
  if (process.env.PROBE_PASSWORD) return Promise.resolve(process.env.PROBE_PASSWORD)
  if (!process.stdin.isTTY) { console.error('Run this in a terminal (the password is typed, not piped).'); process.exit(2) }
  process.stdout.write(question)
  return new Promise((resolve) => {
    const stdin = process.stdin
    let s = ''
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8')
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData)
          process.stdout.write('\n'); return resolve(s)
        }
        if (ch === '') { process.stdout.write('\n'); process.exit(130) }
        if (ch === '' || ch === '\b') s = s.slice(0, -1)
        else s += ch
      }
    }
    stdin.on('data', onData)
  })
}

// ── Run ────────────────────────────────────────────────────────────────────
const password = await askHidden('Staging test-account password: ')
let pass = 0, fail = 0
const problems = []

for (const email of ACCOUNTS) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: signIn, error: sErr } = await sb.auth.signInWithPassword({ email, password })
  if (sErr || !signIn?.session) {
    fail++; problems.push(`${email}: sign-in failed (${sErr?.message ?? 'no session'})`)
    console.log(`\n${email}: SIGN-IN FAILED — ${sErr?.message ?? 'no session'}`)
    continue
  }
  // Expectations come from the account's REAL profile, not from its email.
  const { data: prof } = await sb.from('users')
    .select('permission_level, departments(code), entities(code)')
    .eq('id', signIn.user.id).maybeSingle()
  const p = { level: prof?.permission_level ?? null, dept: prof?.departments?.code ?? null }
  console.log(`\n${email}  —  ${p.level} · ${p.dept ?? '(no dept)'} · ${prof?.entities?.code ?? '(no entity)'}`)

  for (const action of Object.keys(EXPECT)) {
    const want = EXPECT[action](p)
    const res = await fetch(EF, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.session.access_token}` },
      body: JSON.stringify({ action, payload: PAYLOAD[action]() }),
    })
    const body = await res.json().catch(() => ({}))
    let ok, verdict
    if (res.status === 200) {
      ok = false; verdict = 'WROTE SOMETHING (200) — the probe must never write'
    } else if (want) {
      ok = res.status === 400 || res.status === 404
      verdict = ok ? `allowed (${res.status}: ${body.error})` : `expected ALLOWED, got ${res.status}: ${body.error}`
    } else {
      ok = res.status === 403
      verdict = ok ? `refused (403: ${body.error})` : `expected REFUSED, got ${res.status}: ${body.error}`
    }
    ok ? pass++ : (fail++, problems.push(`${email} ${action}: ${verdict}`))
    console.log(`  ${ok ? '✓' : '✗'} ${action.padEnd(22)} ${verdict}`)
  }
  await sb.auth.signOut({ scope: 'local' })
}

console.log(`\nprobe-ef-authority: ${pass} passed, ${fail} failed`)
if (fail) { console.log(problems.map(x => '  ✗ ' + x).join('\n')); process.exit(1) }
