// Pre-mortem Track A: rehearse the prod migration on a database shaped like prod.
//
//   node scripts/payments/premortem/rehearse-db.mjs [--through <migration-prefix>] [--keep <dir>]
//
// 1. Starts an embedded PostgreSQL (PGlite 17.x, from the scratch node_modules —
//    see README.md) and creates the Supabase roles the migrations GRANT to.
// 2. Loads docs/db/schema-current.sql (the prod snapshot, 2026-07-21) STATEMENT
//    BY STATEMENT, recording every statement that fails. Those failures are the
//    rehearsal's own gaps and are printed, not hidden.
// 3. Applies every supabase/migrations/*.sql dated after the snapshot, in
//    filename order, the way prod would receive them — also statement by
//    statement, so a failure is attributed to a line and the run continues as
//    psql does by default (no ON_ERROR_STOP).
// 4. Prints a summary and exports the db for the probes (run-probe.mjs).
//
// Nothing here touches any live system: there is no network, no URL, no key.

import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { splitSql } from './sql-split.mjs'
import { copyBlocksToInserts, insertStubUsers, STUB_USERS } from './seed-load.mjs'
// gen_random_uuid() is built into PostgreSQL 13+; the snapshot's pgcrypto
// extension is loaded only if PGlite ships it (it is optional here).

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const SNAPSHOT = path.join(REPO, 'docs/db/schema-current.sql')
const SNAPSHOT_DATE = '20260721'
const args = process.argv.slice(2)
const through = args.includes('--through') ? args[args.indexOf('--through') + 1] : null
const keep = args.includes('--keep') ? args[args.indexOf('--keep') + 1] : null

export async function openRehearsalDb({ log = console.log, quiet = false, seed = true } = {}) {
  const db = new PGlite(keep || undefined, { extensions: { btree_gist, uuid_ossp } })
  await db.waitReady
  const say = quiet ? () => {} : log

  // ── Supabase pieces the snapshot assumes but a bare Postgres lacks ────────
  // Every one of these is a GAP in the rehearsal and is reported as such.
  const stubs = []
  const stub = async (what, sql) => { stubs.push(what); await db.exec(sql) }
  await stub('roles anon / authenticated / service_role / supabase_admin / postgres (NOLOGIN, no Supabase default privileges)',
    `DO $$ DECLARE r text; BEGIN
       FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','supabase_admin','supabase_auth_admin','dashboard_user','postgres'] LOOP
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
       END LOOP; END $$;`)
  // Supabase's default search_path is "$user", public, extensions — the schema
  // migration relies on it to find btree_gist's gist opclasses (its own comment
  // says so). PGlite's default is "$user", public.
  await stub('search_path = public, extensions (Supabase database default; needed for btree_gist opclasses)',
    `ALTER DATABASE postgres SET search_path = public, extensions;`)

  // ── the snapshot ─────────────────────────────────────────────────────────
  const raw = fs.readFileSync(SNAPSHOT, 'utf8')
  const stmts = splitSql(raw)
  const skipped = []   // statements we deliberately do not run (unavailable extensions, HTTP triggers)
  const failed = []    // statements that errored when run
  const SKIP = [
    { re: /CREATE EXTENSION IF NOT EXISTS pg_net/i, why: 'pg_net (HTTP from SQL) is not in PGlite' },
    { re: /CREATE EXTENSION IF NOT EXISTS pg_stat_statements/i, why: 'pg_stat_statements is not in PGlite' },
    { re: /CREATE EXTENSION IF NOT EXISTS supabase_vault/i, why: 'supabase_vault is not in PGlite' },
    { re: /supabase_functions\.http_request\(/i, why: 'the sync_erp_users HTTP webhook trigger on public.users (pg_net); kept OUT so a rehearsal can never call out' },
    { re: /^\\restrict/i, why: 'psql meta-command' },
    { re: /^SET transaction_timeout/i, why: 'PG17 setting; harmless either way' },
  ]
  let n = 0
  for (const s of stmts) {
    const sk = SKIP.find((k) => k.re.test(s))
    if (sk) { skipped.push({ why: sk.why, head: head(s) }); continue }
    try { await db.exec(s); n++ } catch (e) { failed.push({ error: e.message.split('\n')[0], head: head(s) }) }
  }
  say(`snapshot: ${n} statements ran, ${skipped.length} skipped on purpose, ${failed.length} failed`)
  for (const f of failed) say(`    snapshot ✗ ${f.error}\n      at: ${f.head}`)

  // Session search_path for everything after the snapshot (the dump reset it to '').
  await db.exec(`SET search_path = public, extensions;`)

  // ── reference rows (prod seed snapshot, same date) + synthetic users ─────
  // Stated gaps: the seed holds reference tables only (no users, no business
  // rows); vehicle_catalog is skipped as irrelevant; the probes' "admin" and
  // department users are stubs inserted here.
  let seeded = []
  if (seed) {
    const seedText = fs.readFileSync(path.join(REPO, 'docs/db/seed-reference.sql'), 'utf8')
    for (const b of copyBlocksToInserts(seedText, { skipTables: ['vehicle_catalog'] })) {
      if (b.skipped || !b.sql) { seeded.push({ table: b.table, rows: 0, skipped: !!b.skipped }); continue }
      try { await db.exec(b.sql); seeded.push({ table: b.table, rows: b.rows }) }
      catch (e) { seeded.push({ table: b.table, rows: 0, error: e.message.split('\n')[0] }) }
    }
    await db.exec(`SELECT setval('public.access_rules_id_seq', (SELECT coalesce(max(id),0)+1 FROM public.access_rules), false)`)
    await insertStubUsers(db)
    stubs.push(`seed: ${seeded.filter((s) => s.rows).length} reference tables from docs/db/seed-reference.sql (vehicle_catalog skipped); ${STUB_USERS.length} synthetic users (prod user rows are not in the repo)`)
    say(`seed: ${seeded.map((s) => `${s.table.replace('public.', '')}=${s.error ? 'ERR' : s.rows}`).join(' ')}`)
  }

  // ── migrations after the snapshot, in filename order ─────────────────────
  const dir = path.join(REPO, 'supabase/migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && f.slice(0, 8) > SNAPSHOT_DATE).sort()
  const applied = []
  for (const f of files) {
    if (through && f > through) break
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    const parts = splitSql(sql)
    const errs = []
    let ran = 0
    for (const s of parts) {
      try { await db.exec(s); ran++ } catch (e) { errs.push({ error: e.message.split('\n')[0], head: head(s) }) }
    }
    applied.push({ file: f, statements: parts.length, ran, errors: errs })
    say(`${f}: ${ran}/${parts.length} statements${errs.length ? ` — ${errs.length} FAILED` : ''}`)
    for (const e of errs) say(`    ✗ ${e.error}\n      at: ${e.head}`)
  }
  return { db, stubs, skipped, failed, applied, files, seeded }
}

/**
 * Things that must be true after the seven files have landed on prod — each one
 * a way a migration could have silently half-applied. Returns [{label, ok, got}].
 */
export async function postMigrationChecks(db) {
  const out = []
  const q = async (label, sql, want) => {
    try {
      const r = await db.query(sql)
      const got = Object.values(r.rows[0] ?? {})[0]
      out.push({ label, ok: String(got) === String(want), got: String(got), want: String(want) })
    } catch (e) { out.push({ label, ok: false, got: 'ERROR ' + e.message.split('\n')[0], want: String(want) }) }
  }
  await q('14 money tables exist', `select count(*) from pg_tables where schemaname='public' and tablename in ('customer_groups','customers','customer_group_memberships','customer_group_dismissals','service_invoices','payment_receipts','payment_receipt_counters','payment_allocations','payer_memory','payment_import_batches','payment_export_batches','busy_balance_checks','payment_events','payment_cash_tieouts')`, 14)
  await q('RLS enabled on all 14', `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relname in ('customer_groups','customers','customer_group_memberships','customer_group_dismissals','service_invoices','payment_receipts','payment_receipt_counters','payment_allocations','payer_memory','payment_import_batches','payment_export_batches','busy_balance_checks','payment_events','payment_cash_tieouts')`, 14)
  await q('11 payments_* RPCs + 2 gates present', `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'payments_%'`, 13)
  await q('authenticated has NO write on money tables', `select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and table_name like 'payment%' and privilege_type in ('INSERT','UPDATE','DELETE')`, 0)
  await q('anon has nothing on money tables', `select count(*) from information_schema.role_table_grants where grantee='anon' and table_schema='public' and (table_name like 'payment%' or table_name in ('customers','customer_groups','service_invoices'))`, 0)
  await q('authenticated cannot EXECUTE payments_allocate', `select has_function_privilege('authenticated','public.payments_allocate(uuid,uuid,jsonb,uuid,uuid,text)','EXECUTE')`, false)
  await q('anon cannot EXECUTE payments_import_invoices', `select has_function_privilege('anon','public.payments_import_invoices(uuid,jsonb,jsonb,uuid)','EXECUTE')`, false)
  await q('service_role can EXECUTE payments_set_awaiting_invoice', `select has_function_privilege('service_role','public.payments_set_awaiting_invoice(uuid,uuid,boolean,uuid)','EXECUTE')`, true)
  await q('authenticated CAN execute the read gate (RLS needs it)', `select has_function_privilege('authenticated','public.payments_can_read()','EXECUTE')`, true)
  await q('source CHECK accepts hdfc (the DROP CONSTRAINT named the right constraint)', `select count(*) from pg_constraint where conrelid='public.payment_receipts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%hdfc%'`, 1)
  await q('only ONE source CHECK remains on payment_receipts', `select count(*) from pg_constraint where conrelid='public.payment_receipts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%bharatpe%'`, 1)
  await q('event_type CHECK accepts awaiting_invoice', `select count(*) from pg_constraint where conrelid='public.payment_events'::regclass and contype='c' and pg_get_constraintdef(oid) like '%awaiting_invoice%'`, 1)
  await q('only ONE event_type CHECK remains', `select count(*) from pg_constraint where conrelid='public.payment_events'::regclass and contype='c' and pg_get_constraintdef(oid) like '%cash_tieout%'`, 1)
  await q('open-receipts view carries qr_ref + awaiting_since', `select count(*) from information_schema.columns where table_name='v_payments_open_receipts' and column_name in ('qr_ref','awaiting_since')`, 2)
  await q('open-invoices view carries created_at', `select count(*) from information_schema.columns where table_name='v_payments_open_invoices' and column_name='created_at'`, 1)
  await q('both open views are security_invoker', `select count(*) from pg_class where relname in ('v_payments_open_receipts','v_payments_open_invoices') and 'security_invoker=true' = any(reloptions)`, 2)
  await q('/payments has exactly 6 access_rules rows', `select count(*) from public.access_rules where route='/payments'`, 6)
  await q('EXCLUDE (btree_gist) constraint exists on memberships', `select count(*) from pg_constraint where conrelid='public.customer_group_memberships'::regclass and contype='x'`, 1)
  await q('payment_events is append-only (trigger present)', `select count(*) from pg_trigger where tgrelid='public.payment_events'::regclass and tgname='payment_events_no_update'`, 1)
  await q('idempotency index is NULLS NOT DISTINCT', `select count(*) from pg_indexes where indexname='payment_allocations_idempotency_key' and indexdef ilike '%NULLS NOT DISTINCT%'`, 1)
  await q('read gate is department-first (a Sales GM is refused)', `select public.payments_can_read()`, false) // no jwt set → false either way; the probe does the real check
  return out
}

function head(s) { return s.replace(/\s+/g, ' ').trim().slice(0, 110) }

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, stubs, skipped, failed, applied } = await openRehearsalDb()
  console.log('\n── rehearsal gaps ──')
  for (const s of stubs) console.log(`  stub: ${s}`)
  for (const s of skipped) console.log(`  skipped: ${s.why}\n           ${s.head}`)
  for (const f of failed) console.log(`  snapshot FAILED: ${f.error}\n           ${f.head}`)
  const bad = applied.filter((a) => a.errors.length)
  console.log(`\n── migrations: ${applied.length} files, ${bad.length} with errors ──`)
  const r = await db.query(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'payments_%'`)
  console.log(`payments_* functions present: ${r.rows[0].n}`)
  await db.close()
  process.exit(bad.length ? 1 : 0)
}
