# Service Payments — pre-mortem 1: "30 days after go-live, something went wrong"

**Status: COMPLETE (2026-10-12, cloud session).** Both tracks ran. Branch `premortem-1`,
based on `claude/payments-reconciliation-tool-6eaab4` @ `32d3484` (red team 4's first fix
batch included). Nothing live was touched: no Supabase, no URL, no key, no login; network use
= npm registry + GitHub fetch only. Scripts: `scripts/payments/premortem/` (README there).

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

The money core holds: the seven prod migrations apply cleanly on a prod-shaped database
(219/219 statements, 21 shape checks, four probes 154/154, zero residue), and in two
simulated months of ~480 UPI payments and ~2,400 bills **nothing was counted twice, nothing
was lost, the per-day totals tied to the rupee on all 29 scored days, and the allocation
caches never drifted**. What will go wrong is not the ledger but the loop around it: the
product ships every rule for catching a bad match and **no door for undoing one** — a wrong
confirm, a cancelled-under-money bill and a cash-settled bill all stay exactly as they are
until someone runs SQL, and a match that *is* reversed by SQL is forgotten the next morning,
when the same wrong bill comes back as "the only bill at this exact amount". The second
problem is drift: the open-bills list grows by every non-UPI bill forever (1,800 open bills
after one month, 95 % of them never UPI-paid), the service queue carries ~12 % of the month's
payments unresolved at day 30, and the same ~60 payments are re-decided every morning.

## What would most likely go wrong first

**Week 1, day 3 or so:** a payment made a few days *before* its bill is raised (an advance;
5 % of payments in the model) lands on the one same-amount bill that *is* in the window,
labelled "Only bill at this exact amount", `confident = true`. Someone confirms it. Three
days later the real bill arrives, outside the ±3-day window of that payment, and is never
offered. If accounts notices and reverses by SQL, the payment returns to the queue the next
morning and the **same wrong bill is the only candidate again** — nothing records that it was
rejected. Reproduced three times in a row on one payment in seed 11 (F1). Everything else in
the first month is slower: the daily clash on a cancelled bill (F2), the queue that will not
shrink (F4), the open-bills count that only climbs (F5).

## Findings, ranked (severity by money)

### Wrong money

**F1 · A confident "only bill at this exact amount" can be the wrong bill, and once reversed
it is offered again, still confident** — [Reproduced] + [Read in code].
- Reproduced: `node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs
  --days 30 --seed 11 --backlog 28 --export mtd --json /tmp/m.json` →
  `misplacedToolLedConfident: 1`, and in `misplacedDetail`: txn `…13400` ₹3,400 paid
  2026-10-23 for a bill raised 2026-10-28 (`trueBillsOpenInDb: []` at confirm time), placed on
  `MPI57562600011448` with `signal: amount_unique, confident: true` on 10-24; reversed by RPC
  on 10-27; **placed on the same bill again on 10-28**; reversed 10-31; **again on 11-01**, by
  which time the true bill was in the database but 5 days from the payment, outside the
  window. Counter across the month: `reofferedAfterReversal: 13` (seed 11), `8` (seed 7).
  Negative control: the counter is 0 in any run where no reversal happens (delta export run
  before reversals were modelled). Earlier in the same run, with a careless persona (confirm
  the top candidate even when the amount differs), tool-led confident misplacements were 6.
- Read in code: `matchCandidates.js:228-237` — `unique` is computed over `index.byAmount`
  filtered to `|dayGap| ≤ windowDays`; the index holds only the ±3-day fetch
  (`matchQueue.js:127-138`, `PaymentsPage.jsx` load), so "only" means "only in the window".
  `matchCandidates.js:294-297` makes `amount_unique` a *strong* signal that lifts the
  refuse-to-rank guard. `payments_reverse_allocation` (`20260908_payments_a1_rpcs.sql:473-505`)
  sets `reversed_at/by/reason` and nothing else; no module reads `reversed_at` when ranking
  (grep `revers` over `matchCandidates.js`, `matchQueue.js`, `PaymentsPage.jsx`,
  `paymentsData.js`: no hits). `windowDaysFor` (`matchQueue.js:151-157`) widens the window only
  for payments *marked waiting*, so an advance that was wrongly matched instead of marked
  never gets the wide window.
- Also measured, same runs: `falseUniqueLabels` 22 (seed 7) / 17 (seed 11) — candidates
  labelled "only bill at this amount" while `v_payments_open_invoices` held another bill with
  the same open amount outside the window. Most were harmless (the person confirmed the right
  one); the label is still untrue as worded.
- Sketch of a fix (not built): remember rejections — exclude `(receipt, invoice)` pairs with a
  reversed allocation from that receipt's candidates, or at least drop their `amount_unique`
  to `amount_ambiguous`; and compute "only" against all open bills, not the window (one count
  query per amount, or a window-wide `byAmount` built from the search view).

**F2 · SAP cancels a bill that already has money on it → a conflict every morning, and the
product has no verb to clear it** — [Reproduced] + [Read in code].
- Reproduced: seed 7 and 11, `--export mtd`: day 18 cancels one paid bill; every Billing
  Report import from 2026-11-01 to 2026-11-11 reports `conflicts: 1` for the same bill
  (`conflictsSeenInMonth: 9`), the bill stays `active` with the money on it
  (`cancelledUnderMoney: 0` — the cancellation is *held*, never applied), and the amendment of
  another paid bill (+₹100) lands once (`amendedSeenInMonth: 1`). With `--export delta` (each
  export carries only new days) `conflictsSeenInMonth: 0, amendedSeenInMonth: 0` — the
  cancellation and the amendment **never reach the portal at all**.
- Read in code: the three conflict branches `20260926_payments_import_rules.sql:123-147` are
  correct and say "reverse that match first"; the only callers of the Edge Function in `src/`
  are `allocate`, `classify_receipt`, `set_awaiting_invoice` (`PaymentsPage.jsx`) and the two
  imports (`ImportPanel.jsx`) — `reverse_allocation`, `void_receipt`, `manual_receipt`,
  `on_account`, `close_tds`, the group verbs have none. Red team 4 raised the screen side
  (R4-3, "no screen lists or reverses a match"); this is the money side.
- Which shape prod will see depends on the export's date range → **Q1**.

**F3 · Wrong picks the person makes are kept, not caught** — [Reproduced] (world-dependent).
- Seed 7: 18 misplaced allocations in 427 confirms (6 of them the modelled 3 % deliberate
  slip, 12 tool-led among same-amount bills), `misplacedKept: 11`, ₹21,897 still on the wrong
  bills at day 30. Seed 11: 36 of 397, kept 21, ₹46,280. With a careless persona (accepts a
  name match even when the amount differs) the same seeds gave 41 and 81 misplaced, ₹1.32 lakh
  and ₹2.1 lakh, mostly by `name_overlap_strong` — a part payment onto a stranger's bill.
- The numbers are the persona's, not the product's (`MODEL` knobs `[assumed]`); the product
  fact is that **no screen shows what was matched yesterday**, so a kept error is only found
  by the customer or at Busy reconciliation. `misplacedTrueBillAbsent` 14 of 31 tool-led
  (seed 11): the true bill was not in the database when the person confirmed (advance, or
  same-day bill not yet exported and the brake let it through because the *payment* was
  inside coverage).

### Breaks the day

**F4 · The service queue does not shrink; the same payments are re-decided every morning** —
[Reproduced].
- `openReceiptsByDay` climbs 0 → 67 (seed 7) / 53 (seed 11) by day 30 — 12–13 % of the
  month's payments open — while `skips` total 1,959 / 1,526 and `searches` 916 / 778 across
  the 29 mornings: roughly 60 skip decisions a day by day 20, on payments already skipped.
  `staleBlocked` 94 / 118 are this morning's payments correctly held for tomorrow's bills.
- Read in code: a skip is client state only (`PaymentsPage.jsx` `skipped` is reset by
  `load()`), there is no "park", "not ours" for service staff decides nothing
  (`authority.ts`: `classify_receipt` accounts-only), and `payments_set_awaiting_invoice`
  is the only persistent "later". The ₹1 test payment (`testPaymentStillOpen: 1`, both seeds)
  is the simplest case: it sits in the queue for 27 days.

### Hides a problem

**F5 · Open bills only fall when UPI pays them; the list grows by ~55 a day for ever** —
[Reproduced].
- `openInvoicesEnd` 1,805 (seed 7) / 1,766 (seed 11); `openNeverPaidByUpi` 1,707 / 1,688 —
  every cash, cheque, credit and counter bill ever imported stays "open". With a 28-working-day
  backlog in the first file this is 1,150 open bills on day 1. Search (newest first, 20 rows)
  and the ±3-day window keep the *screen* usable; the number itself, and any "outstanding"
  report built on `v_payments_open_invoices`, is wrong from day one.
- Read in code: no `manual_receipt` UI; `parseBillingReport` marks `pre_opening` only with
  `openingBalanceAsOf`, which `ImportPanel.jsx` never passes.

**F6 · A concurrent import can trip `customers_entity_code_key` and the screen then says
"already imported"** — [Read in code] `20260926_payments_import_rules.sql:78-87`
(SELECT-then-INSERT on `customers`, no `ON CONFLICT`, no lock) and `ImportPanel.jsx:111-114`
(`/import_batches_hash_key|duplicate key/i` → the "already imported" message). Nothing was
imported; the clerk is told it was. Not reproducible on single-connection PGlite.

**F7 · Amendments update total/net/tax/status only; a corrected date, plate, job ref or
terms never lands** — [Read in code] `20260926_payments_import_rules.sql:149-160`. A bill
re-dated by SAP keeps its old date and falls out of the window for its payment.

**F8 · `payer_memory` is never written** — [Read in code] no INSERT/UPDATE in `supabase/`;
`matchCandidates.js:239-248` reads it. Dead signal until Phase A2; any claim that the tool
"learns repeat payers" is false today.

### Slows

**F9 · Accounts opens the HDFC report in Excel and saves it → every Mintoak id becomes a
number → "No payment in this file could be read"** — [Read in code] `parseHdfc.js:84-91`,
`importPlan.js:254`. Blocking and visible; recoverable by re-downloading. Correctly refused
rather than silently truncated — listed so the morning note can say "download, do not open".

### Inferred (never ranked above Slows)

**I1 · Credit-terms customers who pay later than three days after billing always go through
Search** — from the window constant and the plan's 188 credit-terms bills of 549. The real
lag distribution is not in the repo → **Q2**. In the model 10 % of UPI payments were 2–6 days
late; those were the ones the persona had to search for (`foundBySearch` 9 / 17 by amount;
0 by name — the amount search found them first).

**I2 · The real HDFC report's Mintoak ids are unique per transaction** — assumed by the
dedup index and by this simulation's generator; only HDFC can confirm → **Q4**.

### Track C — the pick, and why

The five verbs with no UI (`reverse_allocation`, `manual_receipt`, `void_receipt`,
`on_account`, `close_tds`; plus groups). Chosen because the remedy for F1, F2, F3 and F5 each
passes through one of them, and because the data model assumes they exist (every conflict
message says "reverse that match first"). Go-live without at least *reverse* means the first
month's corrections are SQL by the owner — and F1 shows that even that path loops.

## Proved safe (claims tried and not broken)

Track A, `node scripts/payments/premortem/run-probes.mjs` (log: 40 lines, all PASS):
- The seven payments migrations on the prod-shaped database, filename order:
  `20260830` 151/151 · `20260908` 11/11 · `20260926_import_rules` 10/10 ·
  `20260926_read_gates_and_route` 13/13 · `20260926_views_for_match` 12/12 · `20261009` 12/12 ·
  `20261012` 10/10 — **zero failures**. The three same-day files reference none of each other
  (grep), so filename order and the order in `CLAUDE.md` item 9 are equivalent.
- 21 post-migration checks PASS: 14 money tables with RLS; 11 RPCs + 2 gates; authenticated
  has no write and anon nothing on money tables; `payments_allocate` not executable by
  authenticated, `payments_import_invoices` not by anon, `payments_set_awaiting_invoice`
  executable by service_role; the read gate executable by authenticated (RLS needs it);
  **exactly one** `source` CHECK (accepts `hdfc`) and **exactly one** `event_type` CHECK
  (accepts `awaiting_invoice`) — the `DROP CONSTRAINT IF EXISTS` names were right, so the old
  CHECKs did not survive; views carry `qr_ref`, `awaiting_since`, `created_at`; both open
  views `security_invoker`; 6 `/payments` access rules; btree_gist EXCLUDE on memberships;
  `payment_events` append-only trigger; idempotency index `NULLS NOT DISTINCT`; a Sales GM is
  refused by the read gate.
- `probe-allocation.sql` **26 passed, 0 failed** · `probe-import-parity.sql` **41/0** ·
  `probe-awaiting-invoice.sql` **30/0** · `probe-read-gates.sql` **57/0** · residue 0.
- `probe-read-gates.sql` on prod: it refuses when `public.users` carries an HTTP trigger
  (`probe-read-gates.sql:44-49`), which prod does (ERP sync). Here the trigger is deliberately
  not loaded, so the probe ran and proved the gate SQL on the prod *shape*. That is as much as
  a rehearsal can give; on prod the md5 comparison in `CLAUDE.md` item 9 remains the check.

Track B, both seeds (`--backlog 28 --export mtd`):
- **doubleCounted 0 · lostPayments 0 · cacheDriftRows 0 · perDayTieBreaks 0 of 29 days** —
  including the 23:50 / 00:10 IST pair (day 6/7), the Sunday payments, the day before and
  after the holiday, overlapping HDFC files every day, and 10–18 `SaleFailed` rows per month
  that never became money.
- The same HDFC file sent twice (day 9) is blocked by hash: `"This exact file was already
  imported. Nothing in it is new."` — once, the first copy landed.
- Amendments travel (`amendedSeenInMonth: 1`) and cancellation-under-money is held, never
  applied (`cancelledUnderMoney: 0`) — the rule is right; F2 is about clearing it.
- The largest Billing Report import, 1,405 rows, took **527 ms** in PGlite (slowest import of
  the month 1,031 ms; 1,212-row first import 824 ms). WASM is slower than prod's Postgres, so
  the statement-timeout worry (earlier P3) is retired unless prod's timeout is under ~2 s
  (**Q3**, now a formality).
- "Bill not raised yet" round-trips: 1 waiting at month end in both seeds,
  `waitingWithBillAlreadyImported: 0` — with the careful persona nobody marked a payment
  waiting while its bill was already present. (With the first, careless persona 27 of 28
  waiting payments had their bill already imported *before* the mark, and so could never come
  back — a person who presses "Bill not raised yet" because the shortlist is empty, while the
  bill is simply outside the window, parks that payment for good. Kept here as a note, not a
  finding: it needs a human to confirm the behaviour.)
- `payments_allocate` refuses an allocation onto a bill with nothing outstanding (seen when
  my first simulation loop kept a stale bill list: `invoice … has 0 paise outstanding but
  480000 was allocated`, RPC line 83). The real page reloads after every confirm
  (`PaymentsPage.jsx:185`), so the stale-list path cannot happen there.

## Rehearsal database — its own gaps (Track A)

Built by `scripts/payments/premortem/rehearse-db.mjs` on **PGlite 0.3.9 = PostgreSQL 17.5
(WASM)**; prod is **17.6**. The snapshot `docs/db/schema-current.sql` (pg_dump 18.4 of prod,
**2026-07-21**) is loaded statement by statement, then `docs/db/seed-reference.sql` (same
date, 13 reference tables), then every `supabase/migrations/*.sql` dated after the snapshot in
**filename order**, as psql would run them without `ON_ERROR_STOP` (a failing statement is
recorded and the run continues). Full run ≈ 3 minutes.

**What the snapshot predates (applied here as prod did):** `20260726_phase9h…`,
`20260726_revoke_anon…`, `20260824_tiv_v3_model_params`, `20260825_clear_ghost_future_months`
and `…judgment_months` (both DO blocks **refuse** on the empty TIV tables here — by design, and
benign), `20260825_tiv_atomic_upload`, `20260825_tiv_upload_and_prune`, then the seven
payments files. Prod's state of all of these is known only from `CLAUDE.md`.

**Stubbed (each can hide something):**
- Roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `supabase_auth_admin`,
  `dashboard_user`, `postgres` created NOLOGIN with **no Supabase default privileges**. Hidden:
  a grant Supabase's `ALTER DEFAULT PRIVILEGES` would add that the migration forgot to revoke.
- `search_path = public, extensions` on the database (Supabase's default). `btree_gist` and
  `uuid-ossp` loaded as PGlite contrib. Hidden: nothing known.
- `auth` schema from the dump (`auth.uid()` reads `request.jwt.claims`), so the gates
  evaluate; impersonation = `set_config` of that GUC. **Reads run as superuser, so RLS is not
  enforced here** — grants and gate logic are exercised, PostgREST's `SET ROLE` is not.
- Skipped on purpose: `pg_net`, `pg_stat_statements`, `supabase_vault`; the `sync_erp_users`
  HTTP trigger on `public.users` — kept out so the rehearsal can never call out. Hidden: that
  trigger's cost on prod (the RPCs only `SELECT full_name` from `users`).
- Failed in the snapshot, benign (7): two psql `\restrict`/`\unrestrict` meta-lines and five
  `COMMENT ON EXTENSION` lines for extensions not present.
- Seed: 13 reference tables; **no users** (PII) → 7 synthetic users (`seed-load.mjs`), with
  `auth.users` rows because `public.users.id` → `auth.users(id)`.
- Timing: WASM; durations are upper bounds for prod's Postgres, not measurements of it.

**The "PGlite hang" never existed.** Three earlier runs stalled for 20–60 minutes after
`20260825_tiv_atomic_upload.sql`; the resume log and the first CLAUDE.md bullet called it a
WASM hang and skipped the next file. `--trace` showed no statement of the next file ever
started: the stall was `sql-split.mjs`'s "comment-only statement" regex
`/^(--[^\n]*\n?\s*)*$/`, exponential on the long comment headers that open
`20260825_tiv_upload_and_prune.sql` and `20260830_payments_a1_schema.sql` (now split in 1 ms
and 7 ms). Second rehearsal bug: `new PGlite(undefined, { extensions })` loads **no**
extensions — PGlite takes a non-string first argument *as* the options — which read as
"btree_gist is not available" and 13 failed statements in the schema file. Both fixed; nothing
is skipped by default now. Recorded because a rehearsal that blames the database for its own
tooling would have sent a false alarm to prod.

## The simulated month (Track B) — what it is and is not

`simulate-month.mjs` drives the **real** `parseBillingReport`, `parseHdfc`, `importPlan`
(gates, diff, preview, `rowsToCommit`), `matchCandidates`, `matchQueue`
(`splitWaiting`, `invoiceWindow`, `windowDaysFor`, `allocationTargets`, `feedIsStaleFor`,
`searchPickCandidates`) and the RPCs on the Track A database, with files in the
`make-demo-files.mjs` shapes. The person is modelled: service first, accounts second, each
morning = load → act on the first workable payment → reload (as `PaymentsPage` does after
every confirm); confirm when `confident`, or when a name-matched or top candidate is owed
exactly the money (70 %); otherwise search by amount then by payer name, as
`searchOpenInvoices` does; mark "Bill not raised yet" half the time when both searches are
empty; a 3 % deliberate wrong pick; half the wrong picks reversed by RPC three days later
(optimistic — there is no reverse UI). World knobs are in `MODEL`, each `[plan]` (measured in
the plan: 37 bills/day, 18 UPI/day, 53 % split jobs, 11 % DEF, 36 % counter, 2.7 % FOC, 1.1 %
returns, 3 % failed attempts) or `[assumed]` (50 % paid outside UPI; lag 60 % same day / 25 %
next / 10 % 2–6 days late / 5 % advance up to 7 days; 5 % part payments; 65 % firm-name
payers; Sundays off; one holiday). Same-day amount collisions came out at 36 % of bills vs
the plan's measured 24 % — the model is somewhat *harder* than August was. Two seeds (7, 11)
agree on every structural result; the misplaced counts move with the persona and are reported
as such.

Commands (≈ 100 s each):

    node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs --days 30 --seed 7  --backlog 28 --export mtd   --json /tmp/m7.json
    node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs --days 30 --seed 11 --backlog 28 --export mtd   --json /tmp/m11.json
    node --experimental-strip-types scripts/payments/premortem/simulate-month.mjs --days 30 --seed 7  --backlog 28 --export delta --json /tmp/m7d.json

Key output lines (seed 7 / seed 11, mtd):

| measure | seed 7 | seed 11 |
|---|---|---|
| bills (of which backlog) · UPI success · failed attempts | 2,478 (1,150) · 508 · 10 | 2,396 (1,115) · 455 · 18 |
| confirms · skips · searches · stale-blocked · marks | 427 · 1,959 · 916 · 94 · 1 | 397 · 1,526 · 778 · 118 · 1 |
| misplaced (deliberate / tool-led / tool-led confident) · kept · ₹ | 18 (6/12/0) · 11 · ₹21,897 | 36 (5/31/1) · 21 · ₹46,280 |
| re-offered after reversal | 8 | 13 |
| false "only bill at this amount" labels | 22 | 17 |
| double counted · lost · cache drift · tie breaks | 0 · 0 · 0 · 0/29 | 0 · 0 · 0 · 0/29 |
| open payments day 30 · waiting | 67 · 1 | 53 · 1 |
| open bills day 30 · never UPI-paid | 1,805 · 1,707 | 1,766 · 1,688 |
| conflicts seen (one bill) · amended seen | 9 · 1 | 9 · 1 |
| largest import rows · ms (slowest ms) | 1,405 · 527 (806) | 1,357 · 450 (1,031) |

## Owner questions

**Q1 · What date range will the daily SAP Billing Report cover?** F2 hinges on it.
(a) *Month to date or a rolling 31 days* — cancellations and amendments reach the portal; the
import compares ~1,300 rows a day and commits the few changed (fast here: ≤1 s); the
cancelled-under-money clash shows every morning until cleared. (b) *Only new days* — files
are small, but a cancellation or amendment of any already-exported bill **never** arrives, and
the money sits on a bill SAP no longer has. Lean: **(a)**, and write it into the morning note.

**Q2 · How late do credit-terms customers pay by UPI?** The ±3-day window was measured
against August's join (12 % / 63 % / 25 %); the repo has no lag distribution. (a) widen the
window for credit-terms bills only; (b) keep 3 and rely on Search; (c) measure for two weeks
from `payment_events` (allocation day − invoice date) before deciding. Lean: **(c)**.

**Q3 · Prod's RPC `statement_timeout`.** A 1,405-row import took ~0.5–1.0 s here. (a) read
the value from the dashboard once before go-live; (b) nothing. Lean: **(a)**, five minutes.

**Q4 · Does HDFC ever re-issue a Mintoak id, or regenerate a report with different ids?**
Dedup rests on it. Only HDFC can say.

**Q5 · Which verbs get a screen before go-live?** (a) *reverse* only — clears F2's clash and
lets F1/F3 be corrected, but F1's re-offer loop stays unless rejections are remembered;
(b) reverse + "remember the rejection" (the fix sketched in F1); (c) reverse + manual receipt
(also stops F5's list from growing for cash/cheque bills); (d) go live SQL-only. Lean: **(b)**
first, then manual receipt; TDS, on-account and groups can wait for Phase B.

**Q6 · Who clears the service queue?** F4: skipped payments return daily; only accounts can
classify. (a) accept, and make the morning note say "skip means tomorrow"; (b) give service
staff a persistent "not mine, for accounts" that moves it off their list (no money moves);
(c) nothing. Lean: **(b)** — it is `classify_receipt` with a new kind and a service gate, not
a new table.

## Owner decisions (2026-10-13, PC session) — do not re-ask

Asked after the branch was brought in and F1, F6, F7, F8 were re-read in code and held.

- **Q1 → month to date.** The daily Billing Report covers the 1st of the month to yesterday, so
  SAP cancellations and amendments reach the portal (F2's "delta" shape is off the table). ⚠️
  Known limit, said once and not re-litigated: in the first days of a month the file no longer
  carries last month's bills, so a cancellation of one of those is not seen until someone looks.
  (The rolling-31-days option covered that; the owner chose month to date.)
- **Q2 → keep the ±3-day window; late credit-terms payments are found by Search.** No widening.
- **Q3 → measured, not asked.** The Edge Function calls the RPCs as `service_role` through
  PostgREST; `service_role` has no `rolconfig`, so the login role `authenticator`'s
  **`statement_timeout=8s`** applies — **identical on prod and staging** (`pg_roles.rolconfig`,
  read 2026-10-13). The rehearsal's worst import was ≤1.03 s on WASM: ~8× headroom.
- **Q4 → open, HDFC's to answer.** Added to the "ask HDFC" list beside the scheduled report.
- **Q5 → undo + "don't re-offer" + cash/cheque receipts, before go-live.** (1) A list of matches
  with Undo, reason required (`reverse_allocation`; the server already enforces maker/accounts
  pre-export, GM after). (2) A reversed (payment, bill) pair is never offered again to that
  payment as "only bill at this amount" — F1's loop. (3) Accounts records cash/cheque payments
  (`payments_manual_receipt` exists, accounts-only) so those bills stop counting as open — F5.
  No database work for any of the three. TDS, on-account, void and groups wait for Phase B.
- **Q6 → keep Skip, and explain it.** No "not mine" verb; the morning note (and, if it costs no
  line, the screen) says a skipped payment comes back tomorrow and accounts clears the rest.

## Needs a live run / cannot be rehearsed here

- RLS enforcement as `authenticated` through PostgREST (rehearsal reads run as superuser).
- The real `statement_timeout` (Q3) and real import latency on Supabase.
- Concurrency (F6): two imports or two confirms at once.
- The Edge Function itself (Deno, `verify()`, rate limit): read, not executed.
- Whether a real person presses "Bill not raised yet" when the shortlist is empty but the
  bill exists outside the window (the careless-persona note under proved-safe).

## Resume log

- **2026-10-12 (session start)** — Branch `premortem-1` from
  `origin/claude/payments-reconciliation-tool-6eaab4` @ `32d3484`. Required reading done
  (CLAUDE.md state blocks + item 9, plan v4, redteam4 doc, the seven migrations, `index.ts`,
  `authority.ts`, the pure modules, `PaymentsPage.jsx`, the four probes, the generators,
  snapshot and seed surveys).
- **Environment** — Scratch deps in `/tmp/claude-0/…/scratchpad/pm/node_modules`
  (`@electric-sql/pglite@0.3.9`, `xlsx@0.18.5`, `esbuild@0.24.2`); the repo's `npm ci` cannot
  run here (`xlsx` is a cdn.sheetjs.com tarball the proxy refuses). Gitignored symlinks from
  `scripts/payments/premortem/node_modules` and the repo-root `node_modules`.
  `node --experimental-strip-types` imports `matchQueue.js` → `authority.ts` unbundled. ESM
  ignores `NODE_PATH`. `pkill -f <script>` kills the invoking shell — kill by PID. Two WASM
  instances at once starve each other — run one.
- **Track A** — Three runs "hung" (20–60 min) after `20260825_tiv_atomic_upload.sql`; a
  `--trace` flag showed no statement of the next file started → the splitter's regex was
  exponential on long comment headers (fixed, 1–7 ms). Then `btree_gist` "not available" →
  the PGlite constructor dropped the options object (fixed). Final run: 14 migrations,
  2 TIV DO-blocks refuse (benign), seven payments files 219/219; `run-probes.mjs`: 21 checks
  PASS, probes 26/41/30/57 with 0 failures, residue 0.
- **Track B** — First runs: wrong column name in my feed query (now reads
  `v_payments_feed_status` like the page); JWT claim set transaction-locally (now session-level
  for the match session); stale bill list across one session (now load → act → reload, as the
  page does); truth lookup through a column the view does not carry; amount pools too small
  (89 % collisions → retuned to 36 %); advance payments created after their day's file (world
  now generated before it is lived); export shape made a knob (`--export mtd|delta`) after the
  delta shape silently dropped the SAP cancellation; persona made careful (confirm only when
  the money equals what the pick is owed); scoring excludes the last day's payments (they
  arrive in the next morning's file). Final runs: seeds 7 and 11 mtd, seed 7 delta.
- **Track C** — the five verbs with no UI; reasons above.
- **GitHub** — pushes from this session 403 all day (reads/fetches work). Delivery by
  `git bundle create premortem-1.bundle 32d3484..premortem-1`, verified, sha256 printed.
- **Deviation from write scope, by owner instruction mid-run:** `CLAUDE.md` state bullet and
  `PORTAL_HISTORY.md` entry (the repo's standing documentation rule).
