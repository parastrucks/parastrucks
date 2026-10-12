# Service Payments — pre-mortem 1: "30 days after go-live, something went wrong"

**Status: IN PROGRESS (2026-10-12, cloud session).** Track A rig built and loading; Track B
simulation written, not yet run; findings below are candidates with their evidence tag so far.
Branch `premortem-1`, based on `claude/payments-reconciliation-tool-6eaab4` @ `32d3484`
(the red-team-4 first fix batch is included). Nothing live was touched: no Supabase, no
URL, no key, no login; network use = npm registry + GitHub fetch only.

## Mission and rules (as given by the owner, 2026-10-12)

Find what goes wrong in the first month on prod before it happens: money on the wrong
bill, counted twice, lost, or the morning routine stopping. Tracks: **A** rehearse the prod
migration on a prod-shaped database and run the repo's own probes; **B** simulate 30 working
days through the real pure modules and RPCs; **C** whatever the reading says is the real risk.

Hard rules: no live systems · every finding tagged **[Reproduced]** (committed script +
command + output), **[Read in code]** (file:line), or **[Inferred]** (own section, never above
"Slows") · what SAP/HDFC/Busy/the bank do is known only from the repo; anything else is an
owner question · frozen decisions are not re-litigated (PTB first; HDFC only; next-day batch;
humans pick; QR ranks never filters; SAP date never time; accounts uploads daily until the API;
warranty/AMC excluded; simpler English; dummy data only on staging) · write scope = new files
under `scripts/payments/premortem/` and `docs/backlog/` (the owner then asked for the standard
doc updates too: `CLAUDE.md` state bullet + `PORTAL_HISTORY.md` entry) · findings not fixes ·
severity by money first: **Wrong money · Breaks the day · Hides a problem · Slows · Polish** ·
owner decisions written as questions with options and a lean · commit as you go, author
`Dhruv Bothra <ceo@parastrucks.in>` via `-c` · push to NEW branch `premortem-1`, never to the
payments branch or `portal`; on 403 make a git bundle · resume log kept current.

## Verdict

*(pending the runs; see "Candidate findings" for what the reading has already established)*

## What would most likely go wrong first

*(pending)*

## Rehearsal database — its own gaps (Track A)

Built by `scripts/payments/premortem/rehearse-db.mjs` on **PGlite 0.3.9 = PostgreSQL 17.5
(WASM)**; prod is **17.6**. The snapshot `docs/db/schema-current.sql` (pg_dump 18.4 of prod,
**2026-07-21**) is loaded statement by statement, then `docs/db/seed-reference.sql` (same
date, 14 reference tables), then every `supabase/migrations/*.sql` dated after the snapshot in
**filename order**, as psql would run them without `ON_ERROR_STOP` (a failing statement is
recorded and the run continues).

**What the snapshot predates (so the rehearsal applies them, as prod did):**
`20260726_phase9h_admin_revoke_user_sessions`, `20260726_revoke_anon_proforma_financier_number`,
`20260824_tiv_v3_model_params`, `20260825_clear_ghost_future_months`,
`20260825_clear_ghost_judgment_months`, `20260825_tiv_atomic_upload`,
`20260825_tiv_upload_and_prune`, then the seven payments files. Prod's state of all of these
is known only from `CLAUDE.md`; the rehearsal assumes they applied cleanly on prod.

**Stubbed (each can hide something):**
- Roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `supabase_auth_admin`,
  `dashboard_user`, `postgres` created NOLOGIN with **no Supabase default privileges**. Hidden:
  Supabase's `ALTER DEFAULT PRIVILEGES` that grant ALL on new public objects to anon/authenticated
  — the payments migrations REVOKE then GRANT explicitly, so the end state is checked, but a
  grant that Supabase would have added and the migration forgot to revoke would not show here.
- `search_path = public, extensions` set on the database (Supabase's default; PGlite's is
  `"$user", public`). Needed for `btree_gist` opclasses. Hidden: nothing known.
- `auth` schema loaded from the dump (tables + `auth.uid()`, which reads
  `request.jwt.claims`), so RLS and the gates evaluate; impersonation = `set_config` of that
  GUC, as `probe-read-gates.sql` does. Hidden: GoTrue itself, token refresh, PostgREST's role
  switching (`SET ROLE authenticated`) — the rehearsal runs as superuser, so **RLS is not
  enforced on reads here**; only grants and gate-function logic are exercised.
- Skipped on purpose: `pg_net`, `pg_stat_statements`, `supabase_vault` extensions; the
  `sync_erp_users` HTTP trigger on `public.users` (`supabase_functions.http_request`, pg_net) —
  kept out so the rehearsal can never call out. Hidden: that trigger's cost/behaviour on prod
  when a payments RPC touches `users` (they only `SELECT full_name`; verified by reading all
  eleven RPC bodies).
- Failed in the snapshot (benign, 9 statements): two psql `\restrict`/`\unrestrict` meta-lines;
  `COMMENT ON EXTENSION` for pg_net, pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp;
  `CREATE EXTENSION pgcrypto` and `"uuid-ossp"` (PGlite does not ship them; nothing in the
  schema calls `uuid_generate_v4()`/`gen_salt()` — `gen_random_uuid()` is core).
- Seed: 13 reference tables (`vehicle_catalog` skipped as irrelevant); **no users** (PII, not in
  the repo) → 7 synthetic users in `seed-load.mjs`: an admin with entity and department NULL
  (prod's singleton admin shape), accounts exec/manager, service exec/manager, a Sales GM, a PT
  accounts exec; `auth.users` rows inserted because `public.users.id` has FK `users_id_fkey`
  → `auth.users(id)` (snapshot line 7619).
- Timing: WASM is several times slower than prod's Postgres; durations here are upper bounds,
  not measurements of prod.

**Rehearsal progress at the time of writing:** snapshot 761 statements OK; seed loaded
(departments 8, entities 2, access_rules 106, outlets 8 …); first post-snapshot migration
(`20260726_phase9h…`) 7/7; the run was still CPU-bound on the next files after 4+ minutes —
unexplained, see resume log. Post-migration checks and the four probes have **not run yet**.

## Candidate findings (evidence tag as it stands; ranked provisionally)

### Wrong money

**P1 · "Only bill at this exact amount" is only true inside a ±3-day window; the same open
amount can exist outside it** — [Read in code] `matchCandidates.js:228-237` computes
`unique` from `index.byAmount` filtered to `|dayGap| ≤ windowDays`; the index itself holds only
bills the page fetched for `invoiceWindow()` = receipt days ±3 (`matchQueue.js:127-138`,
`PaymentsPage.jsx` load). A credit-terms customer paying a 5-day-old bill, on a day when a
different customer's same-amount bill is open, is shown one bill with the strongest
non-plate signal (90) and `confident = true`; the label reads as a fact. Search by amount
(`paymentsData.js:88-99`, `open_paise.eq`) would find the older bill, but the screen does not
prompt it. **To reproduce in Track B:** count candidates labelled `amount_unique` while
`v_payments_open_invoices` holds another row with the same `open_paise` (the `falseUnique`
counter in `simulate-month.mjs`). Severity if confirmed: Wrong money (misplaced), human-mediated.

**P2 · A cancelled bill under matched money, a customer-code change, or a total below what is
paid becomes a clash every morning with no way to clear it in the product** — [Read in
code] `20260926_payments_import_rules.sql:123-147` (three conflict branches, correct), and
**no UI calls** `reverse_allocation`, `void_receipt`, `on_account`, `close_tds`,
`manual_receipt`, `create_group`, `assign_customer_group`, `set_credit_limit` — verified by
grep over `src/`: only `allocate`, `classify_receipt`, `set_awaiting_invoice`,
`import_invoices`, `import_receipts` have callers (`PaymentsPage.jsx`, `ImportPanel.jsx`).
Red team 4 raised the screen side (R4-3); this is the money side: the payment stays allocated
to a bill SAP cancelled until someone runs SQL. Severity: Wrong money (latent, visible as a
daily clash).

### Breaks the day

**P3 · The first import may be a month's backlog; per-row `FOR UPDATE` + customer upsert +
events inside one RPC** — [Read in code] `20260926_payments_import_rules.sql:73-164`; EF cap
5,000 rows (`index.ts:326`). Whether this exceeds the RPC statement timeout on prod is an
**owner/platform question** (Supabase's per-role `statement_timeout` is not in the repo).
Track A will time a 1,085-row import in PGlite as an upper bound.

**P4 · Accounts opens the HDFC report in Excel and saves it → every Mintoak id becomes a
number → every row refused → "No payment in this file could be read" (blocking)** — [Read in
code] `parseHdfc.js:84-91`, `importPlan.js:254`. Visible and recoverable (re-download), so
"Breaks the day" only until the re-download; listed under proved-safe-by-visibility unless
Track B shows otherwise.

### Hides a problem

**P5 · A concurrent import (double-click, two tabs) can hit `customers_entity_code_key`
inside the RPC; the Import screen then reports "This file is already imported — most likely
by your previous attempt"** — [Read in code] `20260926_payments_import_rules.sql:78-87`
(SELECT-then-INSERT on customers, no ON CONFLICT, no lock) and `ImportPanel.jsx:111-114`
(`/import_batches_hash_key|duplicate key/i` → the "already imported" message). Nothing was
imported; the clerk is told it was. Concurrency cannot be reproduced in single-connection
PGlite; the message mapping can.

**P6 · Invoice amendments update total/net/tax/status/cancelled only; a corrected billing
date, registration, job ref, plant or payment terms never lands** — [Read in code]
`20260926_payments_import_rules.sql:149-160`. A bill re-dated by SAP keeps its old date → out
of the matcher's window for the payment that arrives for it.

**P7 · `payer_memory` is never written** — [Read in code] grep over `supabase/` finds no
INSERT/UPDATE; `matchCandidates.js:239-248` reads it. The memory signals are dead code until
Phase A2; harmless, but any claim that the tool "learns repeat payers" is false today.

**P8 · Open bills never fall unless UPI pays them** — [Read in code] no UI for
`manual_receipt`; `parseBillingReport` sets `pre_opening` only when `openingBalanceAsOf` is
passed, and `ImportPanel.jsx` passes none, so every bill in a backlog import is `active` and
open forever if settled by cash/cheque/bank. Contained by the ±3-day fetch window for matching
(not a growing payload), but "open invoices" is a number that only grows. Track B measures it.

**P9 · A ₹1/₹30 test or top-up payment sits in the service queue every morning until accounts
classifies it** — [Read in code] `parseHdfc.js:150-154` imports it flagged;
`v_payments_open_receipts` lists it; only `classify_receipt` (accounts) removes it. Slows,
not wrong money.

### Owner's cost of a frozen decision (allowed to report)

**P10 · Next-day batch + a ±3-day window means every credit-terms bill paid later than three
days after billing goes through Search** — [Inferred] from the window constant and the plan's
188 credit-terms bills of 549. The lag distribution of real payments is **unknown to the repo**
→ owner question Q2.

### Proved safe so far (claims tried and not broken)

- Migration re-run safety by reading: `IF NOT EXISTS` / `DROP … IF EXISTS` throughout;
  `DROP CONSTRAINT IF EXISTS payment_receipts_source_check` and
  `payment_events_event_type_check` rely on PostgreSQL's auto-naming of inline column CHECKs
  (`<table>_<column>_check`); **Track A's post-migration check asserts exactly one such
  constraint remains** — if the name were wrong the old CHECK would survive and `source='hdfc'`
  would be refused on prod.
- Filename order of the seven files (`…import_rules` sorts before `…read_gates…` and
  `…views_for_match`) differs from the order in `CLAUDE.md` item 9; by reading, both orders
  work (`import_rules` depends only on `20260908`; `hdfc_source` and `awaiting_invoice` use
  `CREATE OR REPLACE VIEW` and append columns in a consistent order). Track A applies filename
  order and will show whether it matters.
- `payments_allocate` locks the receipt then invoices ascending by id, checks the receipt's
  remaining money **after** inserting (the RAISE rolls everything back), and clears
  `awaiting_invoice`; idempotency replays any row carrying the request id
  (`20260908_payments_a1_rpcs.sql:349-359`, `448-452`).
- The matcher scores on `total − allocated` (`matchCandidates.js:150-154`), so part payments
  and remainders are matched on what is still open (red team 4's L2-3 claim was struck for
  this reason).
- `feedIsStaleFor` fails closed (unreadable feed = stale), and `billCoverage` takes the earlier
  of end-of-last-billing-day and file mtime, never upload time (`importPlan.js:69-75`).

## Owner questions

**Q1 · Statement timeout for RPCs on prod.** Supabase sets a per-role `statement_timeout`; the
repo does not record it. Options: (a) confirm the value from the dashboard before go-live;
(b) import the backlog in ≤1,000-row files. Lean: (a), then (b) only if Track A's timing is
anywhere near it.

**Q2 · How late do credit-terms customers pay?** The ±3-day window was measured against
August's join (12 % / 63 % / 25 %), but the repo has no payment-lag distribution. Options: (a)
widen `DEFAULT_WINDOW_DAYS` for credit-terms bills only; (b) keep 3 and rely on Search; (c)
measure for two weeks after go-live from `payment_events` (allocation day − invoice date)
before deciding. Lean: (c).

**Q3 · Does HDFC's "UPI SETTLEMENT" day boundary match IST calendar days?** The parser groups
by IST day (`parseHdfc.js:166-170`); the one measured tie (₹1,48,693 for 7 Oct) agrees.
Options: (a) assume yes; (b) check a day with a 23:50 payment. Lean: (b), once, after go-live.

**Q4 · Does HDFC ever re-issue a Mintoak id or regenerate the report with different ids?**
Dedup rests on it (`payment_receipts_source_txn_key`). Only HDFC can say.

**Q5 · The five verbs with no UI (reverse, void, manual receipt, on-account, TDS, groups).**
Go-live with SQL-only access to them, or build reverse + manual receipt first? Lean: reverse
first (P2), manual receipt second (P8); the rest can wait for Phase B.

## Needs a live run / cannot be rehearsed here

- RLS enforcement as `authenticated` through PostgREST (rehearsal runs as superuser).
- The real `statement_timeout` (Q1) and real import latency.
- Concurrency (P5): two imports or two confirms at once.
- The Edge Function itself (Deno, `verify()`, rate limit): not executable here; its logic was
  read (`index.ts`, `authority.ts`).

## Resume log

- **2026-10-12 (session start)** — Branch `premortem-1` created from
  `origin/claude/payments-reconciliation-tool-6eaab4` @ `32d3484` (fetched; includes red-team-4
  fix batch `e49ea7b`). Required reading done: CLAUDE.md state blocks + item 9, plan v4
  (Part 1 + money rules), redteam4 doc, all seven migrations, `index.ts`, `authority.ts`,
  `importPlan.js`, `matchCandidates.js`, `matchQueue.js`, `parseBillingReport.js`,
  `parseHdfc.js`, `dates.js`, `paymentsData.js`, `PaymentsPage.jsx` (load/confirm/skip),
  `probe-allocation.sql`, `probe-awaiting-invoice.sql`, `probe-import-parity.sql`,
  `probe-read-gates.sql` header + body, `gen-probe-import-parity.mjs` header,
  `make-demo-files.mjs`, `selftest-demo-files.mjs` header, schema snapshot survey
  (extensions, functions, triggers, tables, `users` FK to `auth.users`), seed survey.
- **Environment facts** — Scratch deps in
  `/tmp/claude-0/…/scratchpad/pm/node_modules` (`@electric-sql/pglite@0.3.9`, `xlsx@0.18.5`
  from the npm registry — the repo's own `xlsx` is a cdn.sheetjs.com tarball the container
  cannot fetch, so `npm ci` fails here, `esbuild@0.24.2`). Gitignored symlinks point at it from
  `scripts/payments/premortem/node_modules` and the repo root `node_modules` (so the repo's
  `make-demo-files.mjs` can `import 'xlsx'`). `node --experimental-strip-types` imports
  `matchQueue.js` (which imports `authority.ts`) without bundling — verified. PGlite ships
  `btree_gist` and `uuid_ossp` as contrib; not `pgcrypto`. ESM ignores `NODE_PATH`.
  A `pkill -f` on a script name also kills the shell that ran it (exit 144) — kill by PID.
  Two WASM Postgres instances at once starve each other; run one.
- **Track A** — `rehearse-db.mjs` (loader + `postMigrationChecks()`), `sql-split.mjs`
  (psql-style splitter: quotes, dollar-tags, comments), `seed-load.mjs` (COPY→INSERT, stub
  users, `actAs`), `run-probes.mjs` (checks + four probes + residue check). First full run in
  progress at the time of this commit (log: scratchpad `rehearse.log`); it loaded the snapshot
  and seed and was CPU-bound in the 2026-07/08 migrations after 4 minutes — **next step: add
  per-statement timing to find the slow statement, or apply only the seven payments files
  (`--through` exists; a `--from` would skip the TIV files, which touch nothing payments
  depend on — state it if used).** Then run `run-probes.mjs`.
- **Track B** — `simulate-month.mjs` written (not run): 30 days, real parsers/RPCs, modelled
  world with the plan's measured rates where they exist and `[assumed]` knobs otherwise;
  scores misplaced/double/lost/tie-out/drift/false-unique/waiting-never-returns; writes
  `--json`. Run with `node --experimental-strip-types …`. Expect first-run bugs.
- **Track C (chosen, why)** — the five verbs with no UI (P2/P5/P8): the data model and RPCs
  assume reversals, manual receipts and on-account exist; the screens ship without them, so
  the first month's corrections are SQL-only. Chosen because every other finding's remedy
  passes through one of these verbs.
- **GitHub** — pushes from this session were refused 403 all day (reads work). Expect the
  same for `premortem-1`: make `git bundle create premortem-1.bundle 32d3484..premortem-1`,
  verify, send; the PC session fetches it. The owner's rule for this is in the mission.
- **Deviation from write scope, by owner instruction mid-run:** `CLAUDE.md` state bullet and
  `PORTAL_HISTORY.md` entry added (the repo's standing documentation rule).
