# Phase 10 — Vehicle Tracker: Final Plan (presentation + execution)

## Context

The back-office runs each vehicle's commercial life across **six Excel workbooks** (purchase from Ashok Leyland, payments, sale, financing, delivery, retention/rebates, staff incentives, customer refunds). Phase 10 replaces them with one spreadsheet-feel, database-backed page at `/tracker` — **one row = one chassis number**. Success is measured by **adoption**: if the team finds it slower than Excel, the project failed.

Planning is now **closed** and this plan was **approved by the owner on 2026-08-11**. Two independent review rounds are done and merged.

**The four Phase 10 documents, all in this repo** (nothing lives in `~/.claude/plans/` any more — a Phase 10 plan was lost that way once):

| Doc | What it is |
|---|---|
| `docs/backlog/phase10-execution-plan.md` (this file) | ⭐ The approved plan — layman's explanation, build order, and the appendix of load-bearing facts |
| `docs/backlog/phase10-vehicle-tracker.md` | Design reference — every decision, formula, and the full findings register |
| `docs/backlog/phase10-review-round2.md` | Round-2 evidence — every number independently re-derived |
| `scripts/phase10/*.cjs` | The SheetJS scripts behind those numbers, re-runnable against the real workbooks |

The last open questions were resolved by the owner this session:

| Decision (2026-08-11) | Choice |
|---|---|
| Grid library | React 19 deferred (own later project). **Grid choice now settled by a 1 d comparative spike** (owner principle, see below): `react-data-grid@7.0.0-beta.48` (pinned candidate) vs `@glideapps/glide-data-grid@6.0.3` (MIT, React 18, ships Excel-grade range selection/copy/fill natively; canvas-based — editors and a11y are the trade-off). Winner = highest score on the Excel-parity checklist |
| Rebilled/re-sold chassis | **Superseded rows** — a rebill creates a new row; old row kept, marked superseded |
| Incentive columns | **Hidden** — visible to admin and HR only (owner, 2026-08-11) |
| Export | **Separately gated + audited** — its own flag, every export logged |
| Collections | **One system** — refunds AND collections in the same signed settlement batches |
| Excel read-only date | Deferred to 10a — back-office picks the date |

---

## PART 1 — The plan in plain language

**Two guiding principles (owner, 2026-08-11):**
1. **The closer it is to Excel, the better.** Every interaction is judged by one test — would an Excel user's fingers already know how to do this? Where the web genuinely can't match Excel, the replacement is one obvious click, never a new habit to learn.
2. **Don't reinvent the wheel.** The current way of working is not broken — it works, it is just **scattered across six files and unstructured**. Phase 10's job is to give the existing process one structured home, not to redesign the process. When there's a choice between replicating how the team already does something and inventing a "better" way — replicate. The only genuinely new things in this plan exist where the scatter itself causes real damage: one shared table instead of six copies, undo, the conflict report, the settlement letter, and the change log. Everything else is the same work in one place.

**What we're building.** One page on the portal that looks and types like Excel, where every truck the dealership ever buys has exactly one line: when it arrived from Ashok Leyland, what we paid, who bought it, how it was financed, when it was delivered, what AL owes us back, what the sales team earned, and what we owe (or are owed by) the customer. Today that story is scattered across six files owned by different people, and the same truck disagrees with itself between files on **1 money figure in 4**.

**What stays the same.** The team keeps their habits: type straight into cells, paste blocks from Excel, drag-fill, filter, freeze columns, colour-code rows, leave little notes on cells — all of it works. Dates are typed `dd/mm/yy`, no fiddly calendars. And the daily "filter it, hide a few columns, copy the result into a mail" move has a dedicated button — **Copy for mail** — that copies exactly what's on screen as a proper table that pastes cleanly into Outlook or WhatsApp.

**What gets better than Excel:**
- *One truth.* A truck's price exists once. No more "which file is right?"
- *Instant find.* Type the last 6 digits off a gatepass, the row appears.
- *One-click paperwork.* The RTGS refund instruction that's currently rebuilt in Word every time becomes a button. Refunds and collections for the same customer can be netted in one batch — even when some trucks are owed and some owe (a third of multi-truck customers are like this).
- *Undo.* A bad paste or a bad import can be reversed. In Excel it can't.
- *Memory.* Every change records who/when/what — quietly, in the background.
- *The month-end grind shrinks.* Retention, TDS, totals compute themselves the moment the inputs land — using the exact formulas verified against all 4,672 rows of this year's books.

**What we found in the real files (and are handling):**
- Some cell values carry their reasoning only in Excel comments ("CTC 17.50 if 25 qty"). All 124 comments migrate into the portal as cell notes — none are lost.
- An informal side-sheet was quietly tracking **₹3.4 crore** of pending customer payments on trucks that aren't in any main file. That money comes into the tracker too.
- Incentive figures are sometimes hand-zeroed (house accounts). The portal computes the standard slab but lets an authorised person override it — visibly.
- A cancelled-and-rebilled truck keeps **both** histories — the first sale isn't erased.

**Who sees what.** Only admin plus a hand-picked back-office list can open the page at all. Staff-incentive columns are hidden from everyone except admin and HR. Downloading the full book to Excel needs its own permission and leaves a log entry. Nobody can grant themselves access — the switch lives where only admin can flip it, and flipping it off logs the person out everywhere.

**How the switchover works — try it before we clean anything.** We build the tool first and load a copy of the real data into it as a **practice sandbox**. The back-office uses it for a week and tells us what's wrong or missing. We fix that. *Then* we produce the report showing where the six files disagree, and the back-office corrects those in Excel (they know which number is right — we don't guess). Then we import the clean files, the computer re-checks every formula on every row against the originals, and on an agreed date the Excel files go read-only and the portal becomes the book.

Doing it in this order means nobody is asked to clean up hundreds of disagreements before they've seen what they get for it — and by then they'll have watched the disagreements on screen themselves, which explains the problem better than any report could.

⚠️ **The sandbox is practice, and it gets erased.** It will carry a permanent on-screen warning and an agreed wipe date. Anything typed into it during the trial is exported and handed back before the wipe, so no real work is ever lost — but nothing entered there should be treated as the real record.

**Time: about 8–9 weeks**, with the first hands-on version in front of the back-office at roughly week four.

---

## PART 2 — Technical execution outline

### 2.0 STEP ZERO — DURABILITY COMMIT ✅ DONE (this commit)

*Kept as the record of what was rescued and why. Everything below is now in the repo.*

**State before this commit (2026-08-11) — every Phase 10 artifact was at risk:**

| Artifact | Lives at | Risk |
|---|---|---|
| Consolidated handoff (all round-2 merges) | `~/.claude/plans/proud-brewing-flute.md` | 🔴 ephemeral — this folder has lost files before |
| Round-2 review, 39.6 KB of evidence | main checkout `docs/backlog/phase10-review-round2.md` | 🟠 **untracked** (`??` in git status), never committed |
| This execution plan | `~/.claude/plans/close-the-loop-on-ethereal-walrus.md` | 🔴 ephemeral |
| Re-derivation scripts (inventory/a_claims/b_it_formulas/c_sale_g/d_followup) | session scratchpad | 🔴 dies with the session |
| Repo's `docs/backlog/phase10-vehicle-tracker.md` | `origin/portal` | ⚠️ **15-line stub whose "single source of truth" pointer is `~/.claude/plans/let-s-start-phase-10-eventual-dragon.md`** — a durable file pointing at an ephemeral one. This is precisely how the last plan was lost. |

**The rescue commit — what was done (docs-only, zero code risk):**

1. `git pull --rebase`, branch off latest `origin/portal` (e.g. `10a-plan-docs`). ⚠️ The **main checkout is currently on `claude/erp-login-17d`**, not `portal`, and another session may share the tree — stage **specific files only**, never `git add -A`, never stash.
2. **`docs/backlog/phase10-vehicle-tracker.md`** — replace the 15-line stub with the full consolidated handoff (contents of `proud-brewing-flute.md`, which already carries every round-2 merge and the six owner decisions). Delete the `~/.claude/plans/…` pointer; nothing in the repo may cite a plans-folder path as a source of truth again.
3. **`docs/backlog/phase10-review-round2.md`** — commit the untracked evidence file as-is.
4. **`docs/backlog/phase10-execution-plan.md`** — this file (both halves: layman's explanation + technical outline).
5. **`scripts/phase10/*.cjs`** — the five SheetJS re-derivation scripts, so every empirical number (26.5% CTC conflict, 266/266 TCS, 124 comments, ₹3.43 Cr Sheet5) can be re-run by anyone against the real workbooks instead of trusted on faith.
6. Cross-link the four docs to each other; add a Phase 10 line to `CLAUDE.md`'s current-state section and a `MEMORY.md` hook.
7. Push → CI green → merge to `portal`. After merge, tell the owner the other session must `git pull --rebase`.

**Memory to save the same day:** `feedback_excel_parity` — the owner's two principles: (1) closer-to-Excel-is-better; (2) don't reinvent the wheel — the current solution works, it is just scattered and unstructured, so replicate the existing process in one structured home rather than redesigning it. Applies to all future portal grid/table work, not just Phase 10.

### 2.1 Database (Supabase PG17, migrations via psql session pooler)

**`vehicle_units`** — one wide table (~88 signed-off columns + additions):
- Surrogate `id uuid` PK; `UNIQUE (chassis_no) WHERE superseded_at IS NULL`; `superseded_at`/`superseded_by_id` for rebills (decision above). Migration lands the 5 known duplicate groups as superseded pairs (~6 rows, owner-reviewed).
- `ctc_basis` (`inclusive|exclusive`) — derived once on import (exclusive when any of AMC/DSA/AdBlue populated; 530/2050 rows), then user-editable, never re-inferred (N1).
- The four text-money columns stored as text + parsed `{amount, kind}` — `kind` may differ from the column (AD-BLU column demonstrably carries DSA/URIYA deals — R2-17).
- Three retention columns: `retention_dealer` + `retention_internal` (computed), `retention_al_claim` (**raw input** — it's a negotiated ₹500-step number, 265/265 empirical) with `app_amt` generated as `claim − computed diff` (R2-18).
- `qty` (default 1 — zero ≠1 rows in 4,672 but cheap insurance), `notes` long-text, `user_field_1..5` admin-labelled scratch columns (F3), `source_file`/`source_row` provenance, per-cell comments table (`unit_cell_notes`: unit_id, column_key, author, text — seeded from the 124 Excel comments), and `unit_cell_formats` (unit_id, column_key, highlight `yellow|red|green`, actor, ts — seeded from the ~148 existing Excel fills; **rule-driven** colour is computed at render, never stored).

**Derived-column trigger** — one `BEFORE INSERT OR UPDATE` trigger computes row-local math with the round-2-verified formulas: `tcs = tally_bill × 1%` (**not** ctc — R2-14), `total = ctc + tcs`, `retention = IF(ctc=0,0, ctc−ctd−amc−dsa−adblue)`, `tds = payment × 0.1%`, `total_payment_to_al = payment − tds`, `diff_tds = diff_amount × 0.1%`, receivable chain (`total_recd = margin+finance_recd+subvention`; `total_receivable = total+insurance+cretem+full_tax`; `net_refund = total_recd − total_receivable`). Import-mode skip keyed on an **explicit importer-set flag** — never on `source_file` (R2-25: post-migration edits must always recompute). `ageing_days`/`interest_on_ageing` are **client-side at render** (TODAY()-dependent; interest clamps negative→0 — verified formula).

**Settlements** — `customer_settlements` (header: settlement_id `{TYPE}-{INITIALS}-{SEGMENT|MIX}-{YYMM}-{SEQ}`, SEQ from a transactional counter — G6; status Pending/Cleared; signed `total_amount`) + `settlement_items` (child → unit rows). Mixed-sign batches allowed (G1: ~30% of multi-chassis customers), ±₹1 dead-band on eligibility (G2), eligibility gated on "financially closed" (G4). **Cleared is immutable**: trigger rejects UPDATE/DELETE on Cleared; corrections go through **Void + reissue with reason** (F9); a *second* user must clear (maker-checker, D4).

**`tracker_audit`** — slim field-level rows (unit_id, actor, column_key, old_value, new_value, batch_id, ts ≈ 240 B) — **never** `to_jsonb(OLD/NEW)` (E8 growth + D1 PII); admin-only SELECT (D2); `import_batch_id` enables "revert import" (F2).

**RLS discipline (from the first migration):** every policy function call wrapped `(select f())` (C7 — the portal currently has 0/116 wrapped; the ERP paid 4598 ms for this); restrictive `is_active_user()` policy on all new tables (D6); every new RPC: `revoke … from anon, authenticated, public` + explicit grants (burned twice before). Per-user allowlist is NOT expressible in RLS (C6) — RLS grants admin + back-office dept reads at most; the EF enforces the allowlist.

**Post-migration:** refresh `docs/db/schema-current.sql` (scrub webhook Authorization headers — PR #75 lesson).

### 2.2 Backend — new EF `admin-vehicle-units` (the 11th function)

- Standard portal EF shape: raw-fetch `callEdge(fn, action, payload)` contract, own `verify()`, deploy `--no-verify-jwt` (no config.toml — flag only), `_shared/keys.ts`. Update CLAUDE.md's EF roster (it says 9; reality is 10 + this one — R2-9).
- **Access:** `app_metadata.tracker_access` + `tracker_export` flags (decision 14). EF checks via fresh `getUser()` (not the JWT claim — R2-8). New `admin-users` action `setTrackerAccess` (single field, no joins) that **also revokes sessions** via existing `admin_revoke_user_sessions` RPC so revocation is immediate. Incentive columns: server-side — `list` omits incentive fields unless the caller is admin or HR (dept code from the caller's profile; today's decision; client hiding is cosmetics only).
- **Actions:** `list` (paginated per `fetchAllRows` pattern with `.order()` tiebreak — E1; returns only the active view's ~25 columns — E7), `createUnit` (quick entry, F1), `bulkUpdateCells` (server-side `EDITABLE_FIELDS` allowlist rejecting computed/system fields — D3; grouped per-row writes; cap 500/call; `client_request_id` idempotency — E2), `supersedeUnit` (rebill), settlement actions (`createSettlement`/`clearSettlement` [second-user check]/`voidSettlement`), `importBatch`/`revertImportBatch`. **No `exportUnits`** — export is client-side like `Catalog.jsx:2407` (E3), but gated on `tracker_export` and audited (today's decision).
- **Rate limits:** per-action overrides on the 60/60 default (a 200-row paste = 1 call after batching, so defaults mostly hold — E9 noted fail-open).
- **PII discipline:** audit writes record field-level values but the auditLog helper must redact `payee_account_no`-class fields; `log-error` context must never receive row objects (D1).
- **Realtime:** none of `postgres_changes` (net-new tech, E4/E6 costs). Instead: polling-refresh + an `import_in_progress` flag and a single completion broadcast; presence indicator deferred.

### 2.3 Frontend — `/tracker`

- **Grid — decided by a 1 d comparative spike against the EXCEL-PARITY CHECKLIST** (owner principle 2026-08-11): (a) `react-data-grid@7.0.0-beta.48` (pinned; peer `^18||^19`; DOM-based, easy custom editors; NO built-in range selection — copy-out via buttons, paste/fill via `onCellPaste`/`onFill` reducers we write) vs (b) `@glideapps/glide-data-grid@6.0.3` (MIT; peer `^16||17||18`; canvas-based; **native Excel-grade multi-cell range selection, drag-copy out, paste in, fill handle**; trade-off: custom cell editors and accessibility are harder, dropdown/date editors need overlay work). Checklist: range select + Ctrl+C out as table · paste block in · fill handle · Enter/Tab/F2/Esc/Ctrl+Arrow keyboard behaviour · frozen cols · filter UX · 2000×88 perf · dropdown+date editor feasibility · dd/mm/yy typed dates. Winner ships; if Glide wins, note it caps at React 18 (flips the later React-19 story: grid swap or Glide's React-19 support by then — record at decision time). Either way: memoized column defs, constant `rowHeight` (E10).
- **Routing/access:** ONE flat route `/tracker` (canAccess is exact-pathname — R2-7); row-detail drawer and settlement panel are in-page state/query params, never path params. `navConfig` entry; `canAccess` gains the per-user `app_metadata` branch (10h) alongside the existing 4-axis rules.
- **Excel-feel core (10d):** keyboard nav, typed `dd/mm/yy` dates, paste with append-rows-at-bottom, Ctrl+D respecting the active filter (F10), **sticky filters** — a live filter never re-evaluates mid-edit (F12), global chassis search incl. last-6-digits (F5), views = named column subsets + time-range with per-view anchor date + "All columns" escape (F14), pinned `chassis_no`/`model`/`customer_name`.
- **"Copy for mail" (owner request, 2026-08-11):** one button copies the CURRENT result — filtered rows × the visible columns of the active layout — to the clipboard as `text/html` (real table) + `text/plain` TSV, so pasting into Outlook/Gmail/WhatsApp yields a formatted table, exactly replacing the Excel filter→hide→copy→mail habit. Rationale: react-data-grid beta.48 has no built-in multi-cell range selection, so free-form drag-copy out of the grid is NOT assumed — the button is the reliable path (the spike verifies what range selection is feasible). Copy is available to every tracker user but **audited** (rows/columns logged); full-workbook export remains gated by `tracker_export` per today's decision — owner can tighten copy to the same flag later if wanted.
- **Layout creator (owner request, 2026-08-11):** an in-app editor for views — searchable column picker (grouped by lifecycle stage), drag-to-reorder, freeze toggle, choice of anchor-date column and default filters, save as a **named layout**; personal layouts per user + admin-published shared layouts (the 3–4 starter views ship as shared). Backing: a `tracker_views` table (owner_id, name, is_shared, columns jsonb, filters jsonb, anchor_col). Adds ~0.5–1 d to 10d.
- **Cell formatting — scoped to what they actually use (owner question, 2026-08-11; census below).** The workbooks were measured, not guessed: **zero bold, zero italic, zero font-colour changes** on any data cell across all four sheets. Formatting in real use is exactly two things:
  1. **Rule-driven column colour** — `#C6EFCE` (Excel's "Good" green) on `AL Payment Status` × **2049 cells** = the whole column, driven by its value. ⇒ the **colour-rules engine** (F6) covers this; ships as a starter rule.
  2. **Manual highlight** — `#FFFF00` yellow (≈118 cells) and `#FF0000` red (≈30 cells) used as "look at this" / "this record is wrong". In FY the counts pair up (17 Delivery Location + 17 Chassis; 13 CRETEM + 13 Full Tax) = **row-level flagging**; in INVOICE TRACKER one row has all four leading columns red = a whole record flagged. ⇒ **highlight gesture**: select cell(s) or a row → small fixed palette (yellow / red / green / clear), stored per cell in a `unit_cell_formats` table, applied over the rule layer. Keyboard-reachable, one click, no toolbar.
  - **Deliberately NOT built** (owner principle 2 — don't reinvent the wheel): bold/italic/font/size/borders/merge/per-cell number formats. There is no evidence of any of it in a full year of books, and a formatting toolbar would be a wheel nobody spins. Number formats stay **per column** (currency, `dd/mm/yy`), as they are today.
  - **Migration requirement (new, same class as the cell comments):** those ~148 manual highlights are **live operational state** — "these 17 rows need attention". The importer must carry them across, or the team loses working information on day one. Highlights also travel into **Copy for mail** (as `bgcolor` in the HTML table) and the xlsx export.
- **Adoption essentials (10d3, non-negotiable):** quick-entry form + "repeat last gatepass × N" (F1); **Ctrl+Z undo** replaying audit inverses + "revert import batch" (F2); notes + 5 scratch columns (F3); **colour rules + the 4-swatch manual highlight gesture** (F6, scoped by the formatting census above); per-cell comments displaying the migrated Excel comments (F7/N4); row-detail drawer for the 20-field sale entry (F14).
- **Save path (E5):** localStorage pending-write queue, dirty-cell styling until server-ack, aggregated error banner (never 200 toasts), refetch-reconcile on reconnect.
- **Reporting (F4):** 3 server-side summary views + grid group-by so daily pivots don't require export; incentive summary computes the slab (`<5→0, <9→1200, <13→1500, else 1800`) as **default with visible per-row override** (R2-19: house accounts are hand-zeroed).
- **Settlement UI (F8):** batch builder netting signed rows per customer; RTGS/collection instruction PDF through the existing `pdfGenerator`; payee master (bank+IFSC saved per customer) to kill retyping (F14).
- **Mobile:** read-only cards reusing an existing pattern (`Employees.jsx:690` `.only-mobile .mobile-cards` or Catalog's `vc-mobile-cards` — both confirmed, E11); the phone "search chassis → update 4 delivery fields" flow (F15) is a stretch goal, not core.

### 2.4 Import & migration (10e/10g)

- **Import wizard:** saved column templates; per-row layout detection for `2025-26.xlsx` (≥3 interleaved layouts — R2-4); hard-coded corrected column map for the DEALERS sheet (chassis lives under "Model" — R2-5); one date format per file; rejected-rows download; blank ≠ overwrite (the 9.7 null-erase lesson).
- **Conflict report to back-office (10a, decision 16), scope:** cross-file value conflicts (CTC 26.5%, CTD ~20%, customer 22%), the 3-file inter-dealer overlap (R2-27), stray-sheet sweep — explicitly including `Sheet5`'s ₹3.43 Cr prior-FY receivables (R2-24) — the 124-comment census, the ~148 manual cell highlights, the ~221 deviant input-formula cells (R2-11), the refund-status normalization map (11 variants — R2-26), and the ~6 duplicate rows.
- **Cutover:** back-office corrects Excel → import → **full recompute-and-diff of every formula on all rows** (not spot-checks — A5/R2-22) → dual-run window → hard "Excel goes read-only" date (set by back-office in 10a).

### 2.5 Build order — PILOT-FIRST (owner decision, 2026-08-11) ≈8–9 weeks

**The sequencing changed.** The original order did data-cleaning first (conflict report →
back-office fixes Excel → build → migrate). The owner reversed it: **build the capability → let
the back-office play with it on real data → collect their feedback → then clean the data → then
migrate.**

**Why this is right — three reasons, the third being the one that decides it:**
1. **Adoption is the success metric**, and the original order deferred first contact until week 6.
   If the feel is wrong, that is the worst possible moment to find out.
2. **The conflict report is a large, boring ask.** Reconciling 473 CTC disagreements before seeing
   any benefit is pure cost with no payoff yet. After they want the tool, it becomes worth doing.
3. **Dirty data in the sandbox makes the conflicts self-evident.** A clerk who sees the same truck
   showing two different prices on screen understands the problem instantly — better than any
   report we could write. The pilot doesn't just delay the cleanup; **it is the best possible
   briefing for it.**

**Cost, stated honestly:** this adds roughly a week (feedback → rework) and risks some rework of
already-built screens. That is the correct trade when adoption is the thing being bought.

| Stage | What | Est |
|---|---|---|
| **0** | Grid spike: react-data-grid beta.48 vs glide-data-grid 6.0.3 on the Excel-parity checklist | 1 d |
| **1 — Foundation** | DB (tables, triggers, RLS `(select …)`-wrapped, audit, grants) · EF `admin-vehicle-units` · **access control moved UP from last** (see below) | 8.5–9.5 d |
| **2 — Playable slice** | Grid core (keyboard, paste, fill, frozen cols, filter, search) + adoption essentials (quick entry, undo, notes/scratch, colour + highlight, cell comments, row drawer) + a **one-off scripted sandbox load** (not the full import wizard) | 11–14 d |
| **3 — SANDBOX TRIAL** | Back-office uses it on a real snapshot. Watch what they do; collect feedback. **This is the gate — do not proceed while they still prefer Excel.** | ~1 wk (their time) |
| **4 — Iterate** | Act on the trial feedback | 3–5 d |
| **5 — Data cleanup** | Conflict report (widened scope) → back-office corrects in Excel → cutover date agreed. **Runs in parallel with stage 6** | 2.5 d ours |
| **6 — Remaining features** | Import wizard + comment/highlight extraction · layout creator · copy-for-mail · client export · summary views · settlement UI + RTGS PDF | 8 d |
| **7 — Cutover** | Migration of the 6 files + prior-FY open items + full recompute-and-diff → dual-run → Excel goes read-only | 3.5 d |

**Two consequences of the reversal that must not be missed:**

- **Access control moves from last to first (stage 1).** The sandbox holds *real* cost prices,
  margins and incentive figures — "test data" only in the sense that it is disposable, not in the
  sense that it is harmless. Staging is INACTIVE, so the pilot realistically runs on prod behind the
  access flag. The gate has to be real before anyone is invited in.
- **The sandbox must be unmistakably a sandbox, and disposable.** The danger is that it quietly
  becomes the real book: someone enters a genuine new truck during the trial, we wipe the sandbox
  for the real migration, and their work vanishes. That is precisely the F2 failure mode — *one bad
  wipe in week two and the team never trusts it again.* Mitigations, all required: a permanent
  on-screen banner ("PRACTICE DATA — will be erased on <date>"), an explicit reset button, a
  stated wipe date agreed up front, and — before the wipe — an export of anything they entered, so
  no work is lost even if they ignored the banner.

### 2.6 Appendix — load-bearing facts (so this file alone can rebuild the rest)

*Every number re-derived 2026-08-11 with Node + SheetJS 0.20.3 (`cellFormula`/`cellComments`) against the six real workbooks. If the other three documents are lost, these are the findings that cost the most to rediscover.*

**Money formulas — verified against every row, not sampled:**
| Formula | Match | Note |
|---|---|---|
| `retention = IF(ctc=0, 0, ctc − ctd − amc − dsa − adblue)` | 2050/2050 = 100% | naive `ctc − ctd` scores only 69.3% |
| **`tcs = tally_bill × 1%`** | 266/266 PTB RETAIL · 94.6% FY | ⚠️ round 1 "corrected" this to `ctc × 1%` and was **wrong** (65.8%) — the two agree only where tally = ctc |
| `total = ctc + tcs` | 266/266 and 2104/2104 | sheet formula is literally `T2=Q2+S2` |
| `diff_tds = diff_amount × 0.1%` | 2050/2050 | not `diff_base` (18.5%) |
| `tds = payment × 0.1%` · `total_payment_to_al = payment − tds` | 2050/2050 both | |
| `total_recd = margin + finance_recd + subvention` | — | `finance_paymt_rec` is a **DATE**, never sum it |
| `total_receivable = total + insurance + cretem + full_tax` · `net_refund = total_recd − total_receivable` | — | |
| `interest = ageing × total_payment × 10%/365` | — | **clamped at 0 when negative**; uses `TODAY()` so it can never be a stored/generated column |

**Structural facts that shape the schema:**
- CTC disagrees across files on **473/1783 = 26.5%** of joined chassis; CTD 19.8%; customer 22.4%. Last-file-wins would corrupt ~1 money cell in 4.
- Derived columns are **100% formula-uniform** (0 deviants across 24,856 formula cells). Hand-editing lives only in **input** cells: AD BLUE (21 patterns) + CTD (10 patterns), ~221 cells. ⇒ import input *values*, recompute derived, and the book reproduces exactly.
- **124 Excel cell comments** total (IT 95, OTHER DEALER 15, FY 14) — all on input columns; they carry quantity-slab pricing (`CTC 17.50 IF 25 QTY`) that exists in no other system.
- `ctc_basis` split: **530/2050 rows (25.9%)** exclusive.
- `retention_al_claim` is a **raw negotiated number** — 265/265 rows are multiples of ₹500, and `app_amt = claim − computed diff` holds 265/265. Never compute it.
- DSE incentive slab (`<5→0, <9→1200, <13→1500, else 1800`) matches only **193/268 = 72%** — all 60 rows of DSE `SRS` are hand-zeroed. Needs a visible override.
- `qty = 1` on **all 4,672 rows** across all four transactional sheets.
- VIN pos-10 (year) is solid: S→2025 ×1410, T→2026 ×640, zero contradictions. Pos-12 (month) has **15 distinct letters for 12 months** — informational only, never financial.
- Mixed-sign customers: **12/43 (PTB RETAIL)** and **91/313 (FY)** — ~30%, so settlement batches must allow both directions.
- FY refund status has **11 distinct strings** (`PENDING×742, REFUNDED×323, NA×144, TO COLLECT×82, TO␣␣COLLECT×13, pending, na, P, to, n`).
- **`INVOICE LIST` `Sheet5` holds ₹3,42,60,755 of pending payments on 10 chassis that appear in NO main sheet** (prior-FY receivables) — outside the six-file scope as originally written.
- `2025-26.xlsx` mixes **≥3 row layouts**; 186 non-date values in the invoice-date column. `DEALERS` sheet: chassis numbers sit under the **"Model"** header (206 rows); the "Chassis No" column holds engine numbers.
- Platform limits confirmed from current docs: EF 256 MB / **2 s CPU** / 150 s wall (breach = HTTP 546); Realtime free **100 msg/s** + one RLS check **per subscriber per change, single-threaded**; PostgREST **1000-row** default cap; PG17 has **no** virtual generated columns and forbids INSERT into `GENERATED ALWAYS … STORED`.
- **Cell formatting census** (all four data sheets, `cellStyles:true`): **0 bold, 0 italic, 0 font-colour** on data cells. Fills: `#C6EFCE` × 2049 = one whole rule-driven column (`AL Payment Status`); `#FFFF00` × ~118 and `#FF0000` × ~30 = manual attention/problem flags, often row-level. ⇒ build the rule engine + a 4-swatch highlight gesture; do **not** build a formatting toolbar. Import must preserve the ~148 manual highlights.
- Codebase: `canAccess` is **exact-pathname** match; **0 of 116** RLS policies use the `(select f())` initplan wrapping (80 call `current_user_role()` bare); `callEdge(fn, action, payload)` has **no** AbortController; `app_metadata` is client-readable in the JWT and service-role-only writable, but **stale until token refresh**.

### 2.7 KNOWN LIMITATIONS — what this does NOT do, and what could surprise you

*Required by the blast-radius rule: state these in the repo, not just in chat. Read this before
approving the build, not after.*

**Blast radius — what Phase 10 sits inside.** Mostly additive, but four shared chokepoints are
touched: (1) **`canAccess()`** (`AuthContext.jsx:391`) gains a per-user branch — it gates *every*
route in the portal, so a mistake here can blank other pages, not just `/tracker`; (2)
**`admin-users`** gains a `setTrackerAccess` action — the EF that manages all employees; (3) the
**`users` table** has a `sync_erp_users` webhook trigger firing a full ERP reconcile **per row
written**, so any tracker work that writes to `users` has ERP consequences (this is why the access
flag lives in `app_metadata` instead); (4) a **new 11th Edge Function** joins the roster that must
be redeployed together at the next key cutover.

**Self-failure modes.** If the recompute trigger is wrong, it writes wrong money silently to every
row it touches — there is no user-visible error. If the access flag write succeeds but the session
revoke fails, a removed user keeps reading cost prices for up to ~1 h. If `bulkUpdateCells`
partially completes at the EF CPU limit, some cells save and some don't, with one error for the
whole batch. If the audit table is used for undo and an audit write is ever skipped, undo silently
replays an incomplete inverse.

**What this plan does NOT cover.** Indents (no 1:many chassis link) · cancellation/rebill *workflow*
(the schema keeps both histories; there is no guided flow) · e-invoice IRN · e-way bill · telematics
· tyre/battery serials · first-service/warranty · driver training. Mobile is **read-only** —
the phone "update 4 delivery fields" flow is a stretch goal, not core. There is **no realtime
multi-user presence**; two people editing the same cell is last-write-wins with an audit trail, not
a merge. Reporting is summary views + group-by, **not** a pivot builder.

**Noise sources — what will look wrong on first use.** `ageing_days` and interest change **every
day** (they read today's date), so yesterday's screenshot never matches today's screen. The
conflict report will look alarmingly long — 473 CTC disagreements is real, and most are stale rows
in the losing file, not errors. The three "retention" columns legitimately disagree; that is the
finding, not a bug. And `make_month` decoded from the VIN is informational only — it will be wrong
for some rows and nothing financial depends on it.

**Verified vs inferred.** *Verified empirically:* every money formula, all conflict rates, the
comment and formatting censuses, platform limits (from current official docs), and all codebase
claims (read from `origin/portal` @ `85c2c90`). *Inferred, not proven:* the E7 browser-heap
estimates (40–90 MB at 2000 rows — no browser measurement was taken), the E8 audit-growth volume
(the 41k-writes/month input is an assumption), the grid's real-world feel on 2000×88 (that is what
the spike is for), and the ~7–8 week estimate. *Unverifiable until built:* whether the back-office
actually adopts it — the one thing that decides success.

### 2.8 Verification

- **Spike:** paste/fill/frozen-cols proven on React 18 before 10d starts.
- **10b:** RLS probed with the documented read-only techniques (impersonation sweep, self-aborting `DO` block — `reference_rls_probe_techniques`); `EXPLAIN` confirms initplan (One-Time Filter) on wrapped policies. ⚠️ Staging is INACTIVE (D9) — DB verification runs against prod read-only or a restored staging; decide at 10b start.
- **10c:** per-action EF smoke tests; negative tests on `EDITABLE_FIELDS` (attempt to write `net_refund`, `created_by`, computed cols → 400); idempotency double-fire test; non-allowlisted-user direct-POST test (C3).
- **Formulas:** the recompute-and-diff harness re-runs the round-2 scripts' logic against migrated data — every derived column must match the source workbooks row-for-row before cutover; edge cases exercised explicitly (ctc=0 ×101 rows, negative-ageing clamp, mixed-sign batches, ±₹1 dead-band, sub-rupee rows ×40).
- **Pre-ship:** owner screen-by-screen review (9.6/9.7 pattern) + clean-room red-team lanes against the built schema/EF/grid — the point where a red team earns its keep.
- **Every push:** CI all-green + Vercel `portal` READY before calling it done; EF deploys watch the upload list for all `_shared/*` assets.

---

## SCOPE CHANGE — 2026-08-20: "replace Excel entirely" (owner decision)

**Asked and reaffirmed.** Reviewing the spike the owner listed: formatting toolbar,
right-click menu, filters, formulae, bold/italics, cell borders, pivots. I flagged that
this describes Excel itself, that a 6-month-plus rebuild would still be a weaker Excel,
and that it collides with the owner's own "don't reinvent the wheel" principle. **The
owner reaffirmed: replace Excel entirely.** That is the decision; this section scopes it
honestly rather than re-arguing it.

### The same conversation made it far cheaper than the raw list implied

Asked what the formatting is actually *for*, the owner answered: **flagging rows needing
attention.** That resolves three of the seven items at a stroke — bold, italics and cell
borders are not needed as a formatting toolbar. Coloured highlighting plus rule-based
colouring covers the real need, and does it better: filterable, structured, survives
export, and consistent with the measured evidence (0 bold / 0 italic / 0 borders across
all six workbooks; the only formatting in use is one rule-driven column and ~148
yellow/red flags). **Already in the plan — no new work.**

### What genuinely remains

| Ask | Verdict | Cost |
|---|---|---|
| Formatting toolbar, bold/italic, borders | **Resolved** → highlight + colour rules, already planned | — |
| Filters | Already core | — |
| Right-click context menu | **NEW — build it.** Copy, paste, insert row, clear, freeze, highlight. Glide supports `onCellContextMenu` | ~3 d |
| Ctrl+F | **Cannot work on canvas** — browser search cannot see canvas pixels. In-app search was already planned (F5, find by last 6 digits) and must now also cover all columns | already planned, widen ~1 d |
| Formulae | **Build — but column-level, not cell-level.** See below | ~5 d |
| Pivots | **Build a group-by + aggregate panel**, not a full pivot builder | ~7 d |

**Revised estimate: ~12 weeks** (was 8–9). Sequencing stays pilot-first.

### Formulae: column-level, and why that is better here — not a compromise

Cell-level formulas stay **cut** (decision 17), and the spike reinforces why: a formula
bound to a grid position silently computes the wrong number the moment a view sorts or
filters, and every one of these columns is money.

The replacement is strictly stronger for this book: **a formula belongs to a COLUMN**, e.g.
`retention = ctc − ctd − amc − dsa − ad_blue`, defined once and applied to every row.
It cannot drift, cannot be half-copied down, cannot break under sorting, and it is exactly
how the six workbooks already behave — the variance scan found **zero** hand-edited
formulas in any derived column across 24,856 formula cells. Excel forces you to copy a
formula down 2,050 rows and then hope nobody breaks row 1,400. A column formula removes
that class of error entirely while giving the same expressive power.

Admin-editable, versioned, with a preview of affected rows before it applies.

### Pivots: group-by panel, and the honest limit

Pick group-by columns, a measure and an aggregate (sum / count / average); get a summary
table, drillable back to the underlying rows. That covers the recurring month-end
questions. It is **not** a full pivot builder — no drag-and-drop field wells, no calculated
fields inside the pivot, no slicers. If a genuinely ad-hoc analysis is needed, the
one-click current-view export to xlsx remains, and Excel does what Excel is good at.

**Stated plainly so it is not a surprise later:** "replace Excel entirely" will hold for
the daily book — entry, tracking, flagging, month-end summaries. It will not hold for
open-ended analysis. Anyone who wants to build an arbitrary model will still reach for
Excel, and the export exists for exactly that.

---

## ⏸️ PARKED — 2026-08-20 (owner: "put this on the back burner again")

**Planning is complete and approved. Nothing is half-built.** No schema, no Edge Function,
no production code — the only code written is a throwaway spike on a separate branch. Phase
10 can be picked up cold from this file.

### Owner decisions taken this session

| Decision | Choice |
|---|---|
| Scope | **Replace Excel entirely** (reaffirmed after I flagged the cost — see the scope-change section above) |
| Formatting | Resolved to **flagging rows needing attention** → highlight + colour rules, already planned |
| **Budget** | **FREE-TIER ONLY. No paid dependencies.** This rules out the best-fit libraries — see below |
| Trial group | **The entire back-office team** |
| Grid library | **STILL OPEN** — see below |

### Grid library — the one genuinely open question

Verified empirically, not from documentation summaries:

| Candidate | Verdict | Evidence |
|---|---|---|
| **glide-data-grid 6.0.3** (MIT) | ✅ **works, proven end to end** | Range select, block copy/paste, fill handle, F2, Enter-commits-and-moves-down, click-away-commits, editor opens with value pre-selected. First paint **10–13 ms** at 2050×88. Two gotchas found and fixed: it needs `<div id="portal">` in the DOM or the editor silently never opens, and the F2 keybinding must be `"F2"` not `"f2"`. Weaknesses: canvas, so **browser Ctrl+F cannot work**, and dropdown/date editors need overlay work |
| **@silevis/reactgrid 4.1.17** (MIT) | ⚠️ **UNSPIKED — the open question** | Type definitions confirm `enableRangeSelection`, `enableFillHandle`, `onCellsChanged`, **`onContextMenu` (built-in right-click menu)**, `stickyLeftColumns`, virtual scrolling. DOM-based, so **Ctrl+F works** and editors are ordinary React. Risks: last published **April 2025**, and DOM rendering at 2050×88 is exactly where canvas wins — unmeasured |
| ~~react-data-grid 7.0.0-beta.48~~ | ❌ **cannot run on React 18** | Renders contexts as `jsx(Ctx,{value})` — the React 19 shorthand — with **zero** `.Provider` uses. Crashes `TypeError: render is not a function`. Its `peerDependencies` claim `^18.0 \|\| ^19.0`; that is **wrong**. Latest release also has zero range-selection types, so upgrading React would not have helped |
| ~~AG Grid Community~~ | ❌ **no range selection** | `CellSelectionModule` / `ClipboardModule` sit in the package's Enterprise module type-union next to `AllEnterpriseModule`. ⚠️ A web search confidently claimed the opposite — checking the package contradicted it |
| ~~AG Grid Enterprise~~ | ❌ paid | $999/dev **perpetual**. Would have removed ~2 weeks (pivot + context menu built in, DOM so Ctrl+F works). Excluded by the free-tier rule |
| ~~Handsontable 18~~ | ❌ paid | **$999/dev per year**, recurring; free tier explicitly forbids commercial use |
| ~~Univer~~ | ❌ paid + infrastructure | Its own docs: pivot, **xlsx import/export**, print and charts are all Pro, and *"Univer Pro advanced capabilities require the server"*. Unlicensed use gets watermarks and import-size limits. v0.25.x |

**No free library provides pivot tables.** That is a build either way (~7 d), unchanged.

### ⏭️ First action on resume

**Half-day ReactGrid spike** against the same checklist Glide passed — range select, block
paste from Excel, fill handle, F2/Enter/Tab/Esc, frozen columns, and above all **render
performance at 2050×88**. Add it as a third tab in the existing spike.

- If it holds up it beats Glide on Ctrl+F, editors and the built-in context menu, at the same price (zero).
- If it is slow or creaky, **ship Glide** — already proven working, nothing further to prove.

Do not re-litigate the ruled-out options; the evidence is in the table above.

### Still owner-side, unchanged

1. **Un-pause staging** (`klpnhpnlotcbbovwswmq`, hibernated — DNS does not resolve). More
   pressing now that pivots and column formulas are in scope: Stage 1 is schema + RLS +
   permissions with **nowhere to rehearse**, and the pilot sandbox will hold real cost and
   margin data on prod.
2. **The date Excel goes read-only.**
3. Estimate stands at **~12 weeks**, pilot-first.

### Where the code lives

Branch **`10-pre-grid-spike`** (8 commits, pushed) — `src/spike/` plus a dev-only mount in
`src/main.jsx`. Verified stripped from production builds: no chunk, no route string, neither
grid library in `dist/`. **Do not merge it**; `package.json` there carries both grid
libraries. Delete `src/spike/` once the grid is chosen.

⚠️ Run the spike at **`http://[::1]:3000/grid-spike`** — vite binds IPv6 only on this
machine, so `localhost` and `127.0.0.1` both fail from tooling.
