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
| Grid library | ✅ **Univer 1.1.0 (free presets), decided 2026-10-21** — see "DECIDED" in the RESUMED section. Original text: React 19 deferred (own later project). **Grid choice now settled by a 1 d comparative spike** (owner principle, see below): `react-data-grid@7.0.0-beta.48` (pinned candidate) vs `@glideapps/glide-data-grid@6.0.3` (MIT, React 18, ships Excel-grade range selection/copy/fill natively; canvas-based — editors and a11y are the trade-off). Winner = highest score on the Excel-parity checklist |
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

## 🔬 RESUMED 2026-10-21 — the grid comparison (owner: "I will need to try both options")

**Still no production code, schema or EF.** Everything below is spike code on branch
**`10-pre-grid-compare`** (from `portal` `f914e62`, pushed; supersedes `10-pre-grid-spike`, which
is 37 commits behind). Commits `e1f63c3` · `22a46a8` · `c1f930d` · `b7b855d`. Not for merging.

Run it: `preview_start {name:"portal"}` (or `npm run dev`) → **`http://localhost:3000/grid-spike?strict=0`**
(`?strict=0` drops React StrictMode's dev-only double render so timings are fair). Four tabs:
**ReactGrid | Glide | Univer | FortuneSheet**, same synthetic 2,050 × 88 book (`src/spike/trackerData.js`).

### What the owner asked, and what was built

| Owner said | Built |
|---|---|
| "react looks better, but I need undo / text and cell formatting" | ReactGrid tab: one undo/redo stack for values AND formatting (`{rowId,colId,before,after}` — the `tracker_audit` shape, so production undo = replay of the audit), a paste is one step; B/I/U (Ctrl+B/I/U), fill, text colour, border, clear |
| "will fill and text colour have just limited options?" | Excel's own colour menus: theme row + 5 shade rows + 10 standard + No fill/Automatic + More colours…, plus the three fills the workbooks use. Custom picker applies on `change` only (`input` would be dozens of undo steps) |
| "a smaller default view, a default view for each user" | Opens at one month × 25 columns, remembered per browser (stands in for the per-person `tracker_views` layout); amber warning above 50,000 cells |
| "something like Google Sheets with open-source access" | Gemini + ChatGPT answers checked against the packages, then two **spreadsheet-engine** tabs: Univer and FortuneSheet |

### Measured (owner's Chrome, dev build, median of 3 — upper bounds on production)

| | Glide 6.0.3 (MIT, canvas) | ReactGrid 4.1.17 (MIT, DOM) | Univer 1.1.0 (Apache-2.0, canvas, free presets) | FortuneSheet 1.0.4 (MIT, canvas) |
|---|---|---|---|---|
| One action, whole book 180k cells | **3–7 ms** | **970 ms** (~80 ms + ~12 µs per cell — reprocesses every cell on each change) | **17–18 ms** edit/bold · 83 ms undo · 92 ms 20×8 block | **85 ms** edit · 93 bold · 104 undo · 98 20×8 block · 92 block undo |
| One action, month × 25 cols | — | 85 ms | — | — |
| Load | 10–13 ms first paint | — | 180–290 ms | 760–1,010 ms |
| Undo/redo, toolbar, formatting | ours to build (built on ReactGrid tab) | ours to build (built) | **built in** | built in |
| Filter, find, comments, dropdowns | ours | ours (browser Ctrl+F works — DOM) | **built in** (free presets) | built in |
| Pivot | ours (~7 d) | ours | **Pro only (paid)** → ours | none → ours |
| Every edit reaches us? (real UI) | yes (our code) | yes (our code) | typed ✅ paste ✅ fill-drag ✅ undo ✅ redo ✅ | typed ✅ paste ✅ fill-drag ✅ undo ✅ redo ✅ |
| A paste = one undo step | ours (built) | ours (built) | ✅ | ✅ |
| Lock on computed money | ours | `nonEditable` cells | typing refused (`BeforeSheetEditStart`) · paste/fill caught by our put-back | typing refused · overlapping paste refused whole · ⚠️ **fill goes past the hook** → our put-back restores it (300 ms, once) |
| Data-quality catches | — | — | ⚠️ paste leaves a **trailing space** (see rules) · ⚠️ fill sends **blank-then-value** | clean paste · source label is a guess (one-cell fill shows "typed") |

### Univer vs FortuneSheet — evaluation (2026-10-21, owner: "both look quite good")

Checked, not recalled: npm registry, GitHub API, the lockfile's licence for every package each pulls
in, an esbuild size estimate, and the live page's network log.

| | Univer 1.1.0 | FortuneSheet 1.0.4 |
|---|---|---|
| Speed per action, full book | 17–92 ms | 85–105 ms (both under the ~100 ms "feels instant" line) |
| Opening the tab | 0.2–0.3 s | 0.8–1.0 s |
| Download added (gzip, estimate) | **~2.9 MB** (12 MB raw) | ~0.6 MB (3.6 MB raw) — cached after the first open |
| Free features | undo, formatting, filter, sort, find, notes, dropdowns, conditional formatting, formulas; also drawing, hyperlinks, tables presets | the same everyday set |
| Paid / missing | pivot, charts, print, **xlsx import/export**, live collaboration = Pro | pivot none; xlsx via a community add-on (`@corbe30/fortune-excel`, MIT, untested) |
| Every edit reaches us | ✅, labelled exactly from its command names | ✅, labels guessed |
| Catches | formatted `getValue` · trailing space on paste · blank-then-value fill | fill skips its lock hook · async API, rebuilt handle · one unexplained blank |
| React 19 | declared supported | `>= 18.2`, open-ended, untested |
| Licence | Apache-2.0; 137 packages, all permissive, **0 Pro packages**; "telemetry" is an empty interface; no outside calls seen | MIT; 14 packages, all permissive (`jstat` MIT) |
| Upkeep | **39 releases in 12 months, last 2026-10-17**; 22.7k stars, 79 contributors, company-backed (DreamNum); 0.10 → 1.1 this year = breaking changes | **last release and commit 2025-11-06 (~11.5 months)**; 3.7k stars, 25 contributors, 96 open issues |
| Supply-chain surface | 137 packages → more `npm-audit` hits likely | 14 packages |

Excel export does not depend on the engine: the tracker's data lives in our database and the portal
already ships SheetJS (`xlsx` 0.20.3). **Recommendation: Univer**, pinned to exact versions and
upgraded on purpose, with trim + before-vs-final collapse in the save layer. FortuneSheet would be the
pick only if download size or package count mattered more than active upkeep.

### Rules learned (do not re-learn them)

- ⚠️⚠️ **Univer: read values with `range.getRawValues()`, NEVER `getValue(s)`** — those return the
  FORMATTED text ("2,462,200"). It would have written commas into money fields, and it made the
  locked-cell put-back loop forever (1,673 → 1,790 put-backs). Fixed + guarded (`reverting` flag).
- Univer undo/redo emit mutations with **no COMMAND around them** — clear the "last command" on
  `CommandExecuted`, treat a no-command change as undo/redo, and use the key pressed to say which.
- ⚠️ **Univer takes Ctrl+Z before the grid's element sees it, and undoes inside its own window
  listener.** To know undo from redo, listen on the window (capture phase) and register BEFORE
  `createUniver`, or each change carries the PREVIOUS key's label (measured). A hint expires in 1 s.
- ⚠️ **Univer paste from a plain-text clipboard with Windows line endings leaves a trailing space**
  (char 32) on the last cell of every row but the final one ("ENG1 "). FortuneSheet stored it clean.
  A real Excel copy also carries HTML, which may avoid it — **unchecked**. Trim on save regardless:
  a trailing space in a chassis or engine number breaks every lookup.
- ⚠️ **Univer fill-drag blanks each target first, then writes**: 3 real changes arrived as 10 events.
  The audit must collapse one command's events to before-vs-final, or it fills with fake blanks.
- FortuneSheet names no commands: the source of an edit is inferred (paste hook / undo keys / cell count)
  and is labelled "inferred" on screen. A one-cell fill shows as "typed".
- ⚠️ **FortuneSheet: its fill skips `beforeUpdateCell`** — a fill into a locked column wrote 0 there;
  the put-back (diff against our copy) restored it. With Fortune the put-back is part of the lock.
- **FortuneSheet's API is asynchronous** (it queues into React state): a synchronous timer reads 0 ms.
  Time to the moment the change is visible, yielding via `MessageChannel` (not throttled like frames).
  And its ref object is **rebuilt** as state changes — read `ref.current` each time, never a saved copy
  (the copy saved at mount answered "sheet not found").
- FortuneSheet paste only runs after its own Ctrl+V keydown (`isPasteAction`), so a synthetic paste
  event is ignored. Test paste with a real Ctrl+V; PowerShell `Set-Clipboard` sets the contents.
- Once, early on, a FortuneSheet cell went blank straight after Enter. It followed calls through the
  stale API copy and did not recur in two clean tries on the user path. Not explained; watch for it.
- **Take click coordinates from a screenshot of the CURRENT layout.** The page above the grid changes
  height (tab row wrapping, capture bar), so an older screenshot's y lands rows off — it looked like
  a FortuneSheet bug until a zoom showed the pointer on the selected cell.
- **Never trust a frame-timed number in a hidden pane or throttled window** — rAF ran at ~1/s, so a
  do-nothing double-frame wait measured ~2,000 ms and made Univer look like 2 s per action. Time the
  work itself, and always measure a do-nothing baseline.
- **Measure the cost of an UPDATE, not just of drawing.** ReactGrid virtualises (468 of 180k cells in
  the DOM) yet takes ~1 s per action at full size — the first check ("draws little") missed it.
- AI/web answers were wrong in checkable ways (Univer pivot "free", FortuneSheet "virtual DOM",
  "OpenSheets"); MIT vs Apache-2.0 is not a real difference for internal commercial use.

### ⏭️ Next on resume

✅ Done 2026-10-21 (`0858dc1`): FortuneSheet loaded, timed and checked; Univer paste, fill-drag and
lock through the real UI. `getRangePermission().protect()` was not tried — the lock already works
without it (edit-start refusal + put-back), so it is not needed for the choice.

### ✅ DECIDED 2026-10-21 — the grid is **Univer** (owner: "go with univer")

Univer 1.1.0, Apache-2.0, **free presets only** (nothing from `@univerjs-pro`, nothing unlicensed such
as `preset-sheets-advanced`), **pinned to exact versions** and upgraded on purpose. Reasons in the
evaluation table above. This closes the "grid library" question in the PARKED section below.

**The last check, done with a REAL Excel copy** (Excel 16 driven over COM, a hidden blank workbook,
closed unsaved): Excel puts XML, HTML, RTF, CSV and text on the clipboard; Univer reads the HTML.
- ✅ No trailing space — that only happens with a plain-text clipboard (Notepad, WhatsApp, a browser).
- ⚠️⚠️ **Money arrives as TEXT with the PC's grouping: "12,34,567"** (Indian lakh grouping from the
  Windows locale), not the number 1234567. A money column would receive a string.
- Undo can change a cell's type (Qty `"1"` came back as the number `1`) — same value, so the capture
  correctly ignored it, but the save layer must compare per column type.

**The save-layer adapter — the one new piece Univer brings (do not skip any line):**
1. Read with `getRawValues()` only.
2. **Money columns: strip grouping commas (lakh and Western), convert to a number, refuse anything
   else** with the cell named. Text columns: trim.
3. Collapse each command's events to before-vs-final per cell (fill sends blank-then-value).
4. Lock: refuse edit-start on computed columns + put back anything that arrives there anyway.
5. Undo/redo labels from a window capture-phase key listener registered before `createUniver`.
6. **Refuse `=` formulas typed into data cells** — cell formulas stay cut (decision 17); formulas are
   column-level and ours.
7. **Persist formatting** (bold, colours, borders) — Univer holds it in memory only; it needs a store.
8. Every write goes through our Edge Function with the row's before-value (the audit shape).

**What this does to the "What genuinely remains" table above:** the right-click menu (~3 d) and the
in-app find (~1 d) come with Univer; undo/redo, the formatting toolbar, filter, sort, dropdowns and
conditional formatting are its, not ours. New: the adapter above (rough guess ~5 d) and the
formatting store. Pivot (group-by panel) and column formulas stay ours. **Re-estimate at build start**
— the net is roughly even with ~12 weeks, not obviously shorter.

## 🔨 STAGE 1 — FOUNDATION, STARTED 2026-10-21 (owner: "yes start stage 1")

Branch **`10b-foundation`**, cut from `portal` `f914e62` (the spike branch is not built on; its
`src/spike/` and grid libraries never reach this branch). **Staging only — prod untouched.**

### Step 1 ✅ — the column map, from the real headers (`5ac9646` → `a88365e`)

⭐ **`docs/backlog/phase10-column-map.md`** — 88 stored business columns + 3 screen-only, each with
type, role, source headers and the workbook's own formula. Built by `scripts/phase10/columns.cjs`
(read-only, prints shapes, never values). The spike's 88 columns were synthetic and are NOT the list.

Found while building it:
- The "gross to AL" formula round 2 could not locate is INVOICE TRACKER's **Payment Amount =
  (CTD + AMC) × Qty** (2,050/2,050).
- Checked against the data instead of asked: the retention files' **CBN = V-part** (265/266);
  **Other deductions is its own figure** (equals AMC + DSA + Ad Blue on 0 of 167 rows).

Owner decisions 2026-10-21 (do not re-ask):
| Topic | Decision |
|---|---|
| GST | **28% if the PTB invoice is before 22 Sep 2025, else 18%; unsold stock 18%.** Every GST step on the row uses it (CTC and CTD alike). Data agrees: last 28% row 20 Sep, none after. Override column for the odd row |
| Road tax | **basic × rate**, rate default 6% (**0** for staff buses / where we do not pay lifetime tax; 8% seen on 3 rows). The RTO moved from invoice value to MRP — **the data dates it: bill value to 31 Jul 2025, MRP from 1 Aug 2025** (5 rows break it → overrides). Visible override column |
| HSRP / CRTM constant | is the **CRETEM** column (added in Total Receivable) |
| RET-INT columns T, U, V | lookups from other tables → **dropped** |
| Subvention Status | **dropped** |
| Cancel/rebill | **keep** vehicle location + delivery columns; old→new chassis = superseded rows |
| AL Balance Sheet | ✅ **2026-10-23: stays in Excel; the final sheet is uploaded monthly and checked against the tracker** (column map → G). Earlier: **its own ledger, outside the tracker.** Proposed (owner asked "what is this?" — explained in plain words; answer pending): per-truck credit lines generated from the tracker (measured: every credit = CTD × 0.999, some split 95/5), payments typed, running balance, monthly tie-out with AL. **Stage 6, not Stage 1** |

Still open with the owner:
1. ❓ **Tippers and GST** — 63 TIPPER rows (+1 tractor) were billed at 18% before 22 Sep 2025. Were
   tippers always 18%? Until answered: date rule + per-row override.
2. ❓ The AL ledger proposal above — yes or no (not blocking). Owner asked 2026-10-23 "have we decided
   on this yet?" — **no; re-explained, still open.**
3. ❓ Stray cells — the owner was given exact addresses to look at (see the column map, last section):
   2025-26 `AL`/`AM`, PTB RETAIL `AN92/125/143/144`, DEALERS `J`–`L`.

### Step 2 ✅ — the schema, on STAGING and proved (`cca8904`)

`supabase/migrations/20261021_phase10_tracker_foundation.sql`:
- `vehicle_units` (102 columns = 88 business + system); unique chassis among non-superseded rows;
  last-6-digit indexes on chassis and gatepass.
- One BEFORE trigger computes every derived column (formulas and switch dates as above);
  `recompute = false` lets the importer write history as-is, and the next edit recomputes (R2-25).
- Side tables: `vehicle_unit_incentives` (separate on purpose), `unit_cell_notes`,
  `unit_cell_formats` (Univer's formatting store), `tracker_views`, `tracker_audit` (field-level, input
  columns only; one `*` row per insert, so an import does not write 180k audit rows),
  `tracker_requests` (idempotency), `tracker_import_batches`.
- **`tracker_apply_changes(actor, batch, changes, request_id, source)`** — the only cell write path:
  one transaction per paste/fill; editable-column allowlist; **before-value check** (a stale value is a
  conflict, never an overwrite — compared as text, because Univer's undo can turn `"1"` into `1`); a bad
  type aborts the whole batch; a repeated request id replays the first result; audit carries the
  source (typed/paste/fill/undo/redo/delete/revert). ⚠️ **Corrected in step 3:** two changes to the
  same cell in one batch do NOT conflict — every before-value is checked before anything is written,
  so both pass and the later one silently wins. The Edge Function now refuses the batch ("the same
  cell twice in one save"); the save adapter still collapses each command first (adapter duty 3).
  `tracker_create_unit()` for quick entry.
- ⭐ **DEVIATION FROM §2.1/§2.2 — stricter, on purpose:** no grant to `anon`/`authenticated` on ANY
  tracker table or function; RLS on with no policy. RLS hides rows, not columns — a direct read grant
  for back-office would have exposed the incentive columns to every tracker user. **Every read and
  write goes through the Edge Function** (service role), which checks `tracker_access` per call.
- Not yet: settlements (`customer_settlements` + items, counter, maker-checker, immutability) — their
  own migration with the settlement UI. Text-money parsing (`5K-DSA` → amount + kind) deferred until
  owner-reviewed patterns exist; the text is stored as-is.

`scripts/phase10/probe-foundation.sql` — self-aborting, expected values worked out by hand: **42 checks**
(every formula on both sides of both switch dates, overrides, write path, identity, import mode,
grants + RLS).
- Local PGlite (Postgres 18.6): 42/0. **Three planted bugs each caught at their own check** (TCS on CTC
  → 3 fail; GST switch a day late → 1; road-tax switch removed → 3).
- **STAGING (Postgres 17.6): 42/0, 0 rows left.** Staging had no name clashes beforehand.
  `vehicle_units_compute` md5 `eac05427…`, `tracker_apply_changes` md5 `0b693345…` (LF text).
- ⚠️ PGlite 0.3.4 crashed in its WASM runtime on the probe's exception blocks ("setTempRet0"); 0.5.11
  runs it. Not a SQL bug — do not chase it.
- ⚠️ Apply the **LF** text on prod (git may check the file out as CRLF; the md5s above are LF).
- How it ran: `supabase link` + `db query --linked -f` from a scratch workdir (memory
  `reference_portal_sql_workflow`); PGlite rig = `run.mjs` creating the three roles, then migration,
  then probe.

### Step 3 🔨 — the Edge Function + the access switch: BUILT, ON STAGING, PROVED LIVE 2026-10-22 (`8d036bb` → `12e23df`)

**`supabase/functions/admin-vehicle-units/`** (the 11th function; staging only, `--no-verify-jwt`):
- `authority.ts` — `ROLE_GATES`, asked once before any payload is read (the payments pattern). Only
  **admin or the per-person switch** opens the tracker — rank and department never do (a GM or HR
  without the switch is refused). Incentives: admin + HR. Download: admin or `tracker_export`.
  Shared layouts: admin; a personal layout is its owner's only (admin cannot edit or delete it).
- `columns.ts` — the 102-column catalogue (type, editable, computed, NOT NULL, CHECKs). `validate.ts`
  — every refusal names the cell and the reason: lakh commas, `₹`, formulas (decision 17), bad or
  impossible dates, Excel date serials, CHECK ranges, integers beyond Postgres' range, text > 2000,
  the same cell twice. Strict on purpose: converting what Excel pastes is the save adapter's job.
- `index.ts` — fresh `getUser()` per call, so the switch is read from GoTrue, not the token. Actions:
  `list` (layout columns + id/updated_at/superseded_*, incentives merged only for admin + HR and
  reported as `hidden` otherwise; superseded rows hidden unless asked; 1000/page) · `history` ·
  `listNotes`/`addNote` · `listFormats`/`setFormats` (`{}` = cleared, so no delete) ·
  `listViews`/`saveView`/`deleteView` (incentive columns stripped from layouts for non-HR) ·
  `applyChanges` (≤500, request id **namespaced per person**, returns the recomputed rows) ·
  `createUnit` (blank = table default) · `supersedeUnit` · `logExport` (export needs the flag; copy
  is open and logged). Rate limit 240/min (a grid saves every edit). Errors mapped to plain words;
  unknown database errors are not echoed.
- **Migration `20261021_phase10_tracker_supersede.sql`** — `tracker_supersede_unit()`: close the old
  row, open the new (same chassis allowed — the live-row unique index forces close-before-insert),
  link them, one transaction, one audit batch. Nothing carried over but the chassis: which figures a
  rebill keeps is a Stage 2 screen decision. **PGlite 19/0** and **STAGING 19/0, 0 residue**, body md5
  `6b89c377…` (LF); planted bugs caught (no link → 2, wrong audit source → 1, no already-rebilled
  guard → 1). Foundation probe still 42/0 alongside it.

**`admin-users`** (staging): `setTrackerAccess` + `listTrackerAccess`, **admin only**. Writes
`auth.users.app_metadata` read-then-spread (so `must_change_password` survives), never `public.users`
(its `sync_erp_users` webhook would reconcile the ERP per flip). Export needs access; inactive
accounts cannot be granted; admin needs no flag. **Taking anything away revokes sessions; granting
does not** (shows at next sign-in / token refresh). Audited both ways, failures included.

**Client:** `canAccess('/tracker')` answers from `session.user.app_metadata.tracker_access` only —
`access_rules` rows for `/tracker` are ignored, so no department rule can open it. Employees: an
admin-only "Tracker" button per row (desktop + phone; adds no rows) → a two-switch dialog. No
`/tracker` route or nav entry yet (Stage 2).

**Proof so far:**
- `scripts/phase10/selftest-vehicle-units.mjs` **528/0** offline — imports the function's own
  modules; checks the catalogue against the migration (102 columns, types, NOT NULL, the SQL editable
  allowlist, the audit trigger's computed list, CHECKs); 13 people × 13 actions by hand. Four
  authority mutants each fail it (GM by rank → 28 · any manager sees incentives → 1 · inactive check
  dropped → 2 · export flag alone opens it → 14).
- `deno check` (Deno 2.5.6, installed in a scratch dir via npm) clean for both functions; build and
  `no-undef` clean. Deployed source downloaded back = repo for all five files; unauthenticated → 401.
- ✅ **Live probe `scripts/phase10/probe-ef-tracker.mjs`, run by the owner 2026-10-22: 133 passed, 5
  failed — all five the PROBE's mistake**: it expected an unknown action from a user without the
  switch to get 403, but the gate answers "Unknown action" (400) first for everyone — exactly what
  the offline self-test specifies. Probe corrected; the function was right. Everything else held as
  real logins: only admin flips the switch; **the same token got in once switched on and was refused
  on its very next call once switched off**; incentives hidden; export vs copy; the whole write path.
  Left on staging (dummy, Stage 2's first rows): chassis `DEMO-PROBE-202610220945` (original +
  rebill), one note, one colour; svc.exec@ signed out; switches back to nobody.
  Re-run: `$env:PROBE_PASSWORD = '…'; node scripts/phase10/probe-ef-tracker.mjs; Remove-Item Env:\PROBE_PASSWORD`.
- ✅ Employees button + dialog seen by the owner signed in as admin (2026-10-22): two switches, the
  download one disabled until access is ticked.

Not built here, on purpose: editing incentive figures (read only so far — needs its own audited
path for admin + HR); deleting a note; the import wizard and revert-import (Stage 6 per the build
order — Stage 2 needs only the one-off scripted sandbox load, which can write with the service role).

**Next:** the owner runs the probe → Stage 2, the Univer grid + the save adapter (its 8 duties above).
Still owner-side: **the date Excel goes read-only**.

## 🔨 STAGE 2 — THE GRID, STARTED 2026-10-22 (owner: "yes start stage 2")

Same branch (`10b-foundation`). Built in slices, each seen working in the owner's Chrome on staging
dummy data and checked in the database.

### Slice 1 ✅ — `/tracker` shows the book in Univer (`6a9455f`)
- Univer **1.1.0 free presets, exact versions** (core, filter, sort, find, notes, conditional
  formatting, dropdowns). Lockfile: 134 added, **0 changed, 0 removed**. Audit: no high (CI gate holds);
  the new `fflate` moderate is jspdf's, not Univer's.
- Lazy route `/tracker` + nav entry (Back Office Tools); shown only by the per-person switch.
  **Univer lives only in the TrackerPage chunk (1.85 MB gzip)** — the entry chunk has none. Its CSS has
  no element/html/body rules (its two `*` rules only define `--univer-tw-*` variables), so visiting
  the tracker cannot restyle other pages.
- Measured in the grid: **money in lakhs** — `18,67,000`, `-1,20,468` (formats allow two conditions,
  so a figure ≥ 1 crore shows as `150,00,000`; four-section patterns are ignored); **dates dd/mm/yy,
  and typing `05/07/25` gives 5 July** (serial 45843 — the column's format steers the parse).
- ⚠️ **React's dev double-mount left a second Univer drawn at 0 × 0** in a shared element; each mount
  now gets its own element (the spike only dodged it with `?strict=0`).
- **2,050 DUMMY rows on staging** (`scripts/phase10/gen-demo-rows.mjs`; chassis `DEMO-*`,
  `source_file = 'DEMO seed'`). ⚠️ Its first random generator cycled (plain-JS LCG losing precision),
  so the load has runs of identical rows — harmless; the generator now uses mulberry32.

### Slice 2 ✅ — the save adapter (`d25d8a1`, `5f38233`)
Each checked in the database on staging:

| Done in the grid | Result |
|---|---|
| typed `20,00,000` into CTC | saved as 2000000; Retention + Total recomputed by the server and shown; audit "typed" |
| Ctrl+Z | saved back, audit "undo" |
| Excel-style 3×2 paste of lakh text | 6 numbers, **one** batch, "paste"; cells keep the lakh format |
| fill-drag over 3 rows | 3 changes, one batch, "fill", **no fake blanks** |
| `5K`, `=1+1` into CTC | refused by name, old value back |
| typing into Retention | refused at edit start |
| a row changed by someone else meanwhile | conflict; the cell shows their value |
| right-click → Insert row / delete row | refused with a notice; the book unchanged |
| sort by CTC, then edit the top row | saved to the right truck; the sort wrote nothing |

- **Migration `20261022_phase10_tracker_numeric_before.sql` (STAGING):** a stored `1310.50` against a
  browser's `1310.5` was a false conflict (before-values compared as text only). Now a conflict needs
  the values to differ as text AND as jsonb values. `probe-numeric-before.sql` **9/0** on PGlite and
  staging; the old function fails 3. LF body md5 `2a215c45…`.
- `src/tracker/lib/savePlan.js` — duties 2, 3, 4, 6 (each cell's LAST value is judged, so a fill's
  passing blank is never refused). `TrackerGrid` — row → id list re-read after every sort (a paste over
  the id column is written back); put-backs and server figures written as a **mutation, off the undo
  stack**; pasted cells get their column's style back (a paste had left money as `2200000`); structural
  commands cancelled. `TrackerPage` — one save at a time, a request id per save (retries replay),
  server rows are the truth, retry 1/3/8 s then a Retry button, leave-page warning while unsaved.
- `scripts/phase10/selftest-tracker-cells.mjs` **88/0**; two planted planner bugs each caught.
- ⚠️ One undo save took three tries (~4 s) once and did not recur; failures now log their reason
  (`[tracker] save attempt N failed: …`) — watch for it.

### Slice 3 ✅ — new rows (`72193d2`, `a54e481`, `fef1334`, 2026-10-22)
Resumed after the PI hotfix (owner: "hotfix is live, let's continue"); `origin/portal` merged in
twice (`6a90051` the code, `5f1652a` its docs — CLAUDE.md + history conflicts were two independent
entries, both kept).

- **Migration `20261022_phase10_tracker_create_units.sql` (STAGING):** `tracker_create_units(actor,
  batch, rows, request_id)` — up to 200 rows, **each in its own savepoint** (a chassis already in the
  book fails only that row, by name: "chassis X is already in the book"), the whole result stored in
  `tracker_requests` so a retry **replays**. `probe-create-units.sql` **18/0** on PGlite and staging,
  0 residue; mutants caught (no replay → the retry aborts; no duplicate wording → 2 fail). Staging
  prosrc md5 `8f4e051d…`; apply the LF text on prod. `tracker_create_unit` (one row) is unchanged —
  rebill still uses it.
- **EF `createUnits`** (same gate as `createUnit`): each row judged on its own (`validateNewRows`,
  cap 200), bad rows reported by position, the rest sent with the caller-namespaced request id; returns
  each created row. `selftest-vehicle-units` **550/0**; deno check clean; deployed to staging.
- **The grid:** 250 spare rows below the book, each carrying its column formats (grown by a
  MUTATION when they run low — never on the undo stack). A spare row becomes a vehicle when its
  **chassis arrives — alone or in the same paste**; anything typed before it is refused and cleared
  (`planNewRows`, pure). The row gets a temporary id (`new:…`) at once; edits typed while it is being
  created queue behind the create and are re-pointed to the real id. A row the server refuses is
  emptied and named. **"+ New vehicle"** = quick entry the Excel way: it opens the chassis editor of
  the first empty row (no form — F1's "form" would be novelty; typing below the book is what the team
  does today).
- Seen in the owner's Chrome on staging, each checked in the DB:

| Done | Result |
|---|---|
| + New vehicle → typed a chassis, Tab, a value | one create, count +1, defaults qty 1 / AL / 6%; the value arrived in the same report, so it was part of the create |
| an edit 50 ms after a new chassis (forced through the grid's own command) | id was `new:…` while creating, then the real one; the edit saved as its own "typed" audit row on the real id |
| Excel-shaped paste of 3 rows, one chassis already in the book | 2 created in ONE batch; the duplicate's row emptied: "Chassis DEMO-NEWROW-0001: already in the book. That row was not added and has been emptied." |
| a cell typed into an empty row before its chassis | cleared: "a new vehicle starts with its chassis number — type that first…" |

- ⚠️ **Without `startEditing()` the "New vehicle" button kept the keyboard** — the cell was selected
  but typing reached nothing (measured). The button now opens the cell's editor.
- `selftest-tracker-cells` **99/0** (11 new; planted "no chassis first" bug fails 3). Build + no-undef clean.
- Staging now also holds DUMMY rows `DEMO-NEWROW-0001…0004` (0001's Engine No reads "DEMO NEW MODEL").
- Not built: "repeat last gatepass × N" (F1) — fill-drag down a column already does it once the
  chassis numbers are in; revisit if the team asks.

### Slice 4 ✅ — colours and notes (`74c9eaa`, 2026-10-22; `portal` #136 merged in first, `8c659fd`)
No server change: `setFormats`/`listFormats`/`addNote`/`listNotes` from step 3 were enough.

- **Measured first (in the owner's Chrome):** a fill change arrives as the SAME `SheetValueChanged`
  event as a value, and so do its undo and redo · a value-only mutation keeps a cell's style · ⚠️
  **Univer leaves a note at its sheet position when the book is sorted** (the truck went from row 2055
  to row 3, the note stayed on 2055) · the note editor reports after each PAUSE in typing (four key
  presses → one update), and `Before…` note events fire from the menu but NOT from facade calls ·
  `silent: true` on the note mutations does not stop the note events.
- **Colours = duty 7.** After any change the grid reads each touched cell's look; what is saved is the
  person's part only — the style minus the column's, **never the number format** (the column owns it)
  — `src/tracker/lib/cellFormats.js` (pure). Only what differs from what was saved goes out (one
  `setFormats`, ≤2000). Undo/redo are covered by the same path. Put-backs now write the value only, so
  a refused value no longer wipes a yellow. A paste keeps only the source's FILL (not Excel's font,
  size, borders on every cell). "Clear format" that strips a money cell's lakh format gets it back.
  A new row's pasted fill is reported when the row gets its id.
- ~~AL Payment Status green as a whole column~~ → **REPLACED 2026-10-23 (`1bd0fee`), owner: "green
  only for the vehicles that have been paid for, that is, cash invoiced. IBND (invoiced but not
  delivered) are invoiced to us but delivered only once the payment is made to Ashok Leyland."** So:
  a conditional-formatting RULE, `=LOWER(TRIM(Y2))="cash invoiced"` → #C6EFCE (Univer's own text
  "equal" is exact; typing differs), shipped in the workbook's own data (`resources`) so no Ctrl+Z
  can remove it, never saved per cell (`cellFormats.paidRule`). ⚠️ The census's "2,049 green cells
  whatever the value" did not match the owner's rule — the census never cross-checked fill against
  value; the owner's fact wins.
  ⭐⭐ **Conditional formatting hooks into Univer's cell READS**: `getCellStyleData()` and even
  `getCellData()` return a paid cell AS green. The colour saver read cells that way, so editing a
  green paid cell would have saved the rule's green as the person's colour (and the number-format
  repair could have written it into the cell). Caught in the DB check, not on screen. **Every style
  read now uses the raw cell (`getSheet().getCellRaw` + `getStyles().getStyleByCell`).**
  Seen on staging: `cash invoiced ` → green; a green paid cell edited → no format saved; `IBND` →
  plain; DB: 0 formats on the truck, 0 saved greens anywhere. Cells test **117/0**.
- **Notes = Excel's model:** one note per cell. Each saved version is a NEW `unit_cell_notes` row
  (add-only — that is its history); the cell shows the latest. Saved 2.5 s after the note settles.
  The grid keeps notes by truck and **redraws them after load and after every sort** (silent
  mutations — off the undo stack; its own flag ignores the events they raise). A note needs a vehicle
  (spare rows refuse); **removing a saved note is refused** — not built (no deletion marker in the
  table yet). ⚠️ `addNote` is not replay-safe: a retry after a lost answer stores the version twice
  (the cell still shows the right text).
- Seen in Chrome on staging, each checked in the DB:

| Done | Result |
|---|---|
| yellow fill on a Model cell | saved as `{"bg":{"rgb":"#FFFF00"}}` only; back after a reload |
| red fill, then Ctrl+Z | saved as `{}` |
| a fill, then "clear format" on CTC | fill gone, lakh money kept |
| `5K` into a yellow CTC | refused, old value back, **yellow kept** |
| Add Note from the menu, typed, clicked away | "Saving…" while it settled, then ONE row with its author |
| sort the book | the note and the yellow both moved with the truck (2055 → 3) |
| Delete Note from the menu | refused: "A saved note cannot be removed yet — change its text instead." |
| AL Payment Status | green from the first row to the last spare row |

- `selftest-tracker-cells` **113/0** (13 colour checks + 1 added when a planted "number format saved"
  bug first survived — the toolbar case was missing). Build + no-undef clean.
- Staging now also holds DUMMY: formats on DEMO-NEWROW-0004 (Model + CTC yellow) and -0003 (`{}`);
  notes "DEMO note: held for finance" (DEMO-NEWROW-0003 Model) and two "hand test" notes on
  DEMO-MB1AR0000517 / DEMO-MB1AT0002049 Model, written by a console test (the event saves are real).

### ⏭️ Still to build in Stage 2
5. **Layouts, search by last 6 digits, Copy for mail, row history** — then the one-off scripted
   sandbox load. ✅ **Owner 2026-10-23: real data on STAGING first, then the trial on the live site.**
   ✅ **Owner 2026-10-23 on the read-only date: no date yet — he sends the UPDATED versions of all the
   files "in a day or two"; we build the full repository and archive all the data from them first,
   then add the rest incrementally until go-live.** So the sandbox load = the first real import, from
   those files, on staging.
Also: a phone view (read-only cards) and the local save queue across reloads (E5) are not built.

### Where things stand (2026-10-23, end of session 2) — resume here
- **Branch `10b-foundation`, pushed and clean** (last code `0a82d80` the importer, docs after). `origin/portal`
  merged in up to `e236912` (#137) — `git fetch` and merge it again after every `portal` release; a hotfix
  still branches from `origin/portal`, never from here.
- **Done in Stage 2:** slice 1 (the book in Univer) · slice 2 (save adapter) · slice 3 (new rows) · slice 4
  (colours + notes) · slice 5 (Find, layouts, Copy for mail, row History — `1c08d05`) · AL Payment Status green
  = Cash Invoiced OR Fresh Offtake (one `PAID_WORDS` list) · RMC = 18% GST · Endhan Date column · MTO Advance
  Yes/No column · fixed-list columns take any case · **the first-load importer, rehearsed offline on the real
  files (`0a82d80`, `scripts/phase10/import/`)**.
- ✅ **2026-10-24 (session 3): two CTCs + ONE CONTINUOUS BOOK of every year.** Owner: "one continuous database
  that has all details about all vehicles that have moved in and out of our dealership … make a good design
  judgment call … such that there is no inconsistency", and CTC is TWO figures — **AL CTC** (told to AL; AL
  pays retention on it) and **PTB CTC** (internal). Built:
  - **Two CTCs** — migration `20261024_phase10_tracker_two_ctc.sql` on STAGING (`vehicle_units.al_ctc`;
    `ctc` stays and is labelled "PTB CTC"; `retention_dealer` and `app_amt` now on AL CTC, `total` and
    `retention_internal` on PTB CTC — each file's OWN formulas checked; a blank AL CTC = the PTB figure).
    `probe-two-ctc.sql` 9/0 (PGlite + staging); 3 planted mutants each fail (not editable 2 · Retention on PTB
    CTC 3 · App Amt on PTB CTC 3). Staging prosrc md5: compute `ee1a22a6…`, apply `08ff1a12…` = file. EF
    redeployed. ⚠️ First draft was named `…_al_ctc.sql` and sorted BEFORE `…_al_retail_date.sql`, which then
    re-created the apply function without it — the probe caught it; renamed `…_two_ctc.sql`. **Migration
    file names must sort after the one whose function they extend.**
  - **The importer reads every year** (`run.cjs` with no files = all of `D:/PTB/Finances/20xx-yy` + the
    2025-26 lists): the older layouts are read INTO the same families (`read.cjs` `as` + `alias` + `drop`):
    2022-24 sales books ("Chassis No", Sheet1…7 copies never read) · AL's DBM claim export 2023-10 → 2024-06
    ("Vin No."; Nett ORC = the claim, Adjustment = App Amt — both checked by formula; its Model is a material
    code → not read) · the old AL RETENTION SHEET (DBM = AL's view, its RETENTION is CTC − CTD so NOT the claim;
    TALLY = internal) · old purchase books' "AMC" header. Files are named with their year folder.
  - **No inconsistency, by design:** one row per chassis for ever (a truck bought in March and sold in April
    is one row) · files ordered by financial year then month (a year book last in its year) · inside a family
    the later file wins and **an earlier file's different figure is kept as a note**, never dropped; an
    earlier file fills a cell no later one has · **two copies of one year's purchase or sales book are
    REFUSED** (>50% shared trucks, same year — proved on a copy, exit 3; `ALLOW_OVERLAP=1` overrides) ·
    claim age/interest = latest month only (they grow by design) · "M/S … PVT LTD" = the same customer ·
    the financial year is never stored (it follows from the dates).
  - **Rehearsed on all years (offline, PGlite, all 10 tracker migrations): 89 files → 5,974 trucks · 8,425
    notes (6,258 disagreements) · loads in one transaction (12 MB, ~14 s) · probe-foundation 42/0.**
    Per year (by PTB invoice date): 2022-23 440 sold · 2023-24 1,226 · 2024-25 1,453 · 2025-26 2,101 ·
    2026-27 138 · ~470 bought but no invoice date · 149 only in retention files. Purchase data is complete
    every year; **the sales book is MISSING for 2023-24 (112 of 1,226 have one) and all of 2024-25** — not on
    this PC. `import/recompute-by-year.sql`: the sheets' formulas are the SAME every year (checked per
    year: Retention, Payment, Diff, TCS, Total, Full Tax) — 2022-23 Payment left AMC out on 362 rows; old-year
    differences are inputs (AL CTC from AL's file vs the purchase sheet's own CTC: Retention 250 / 460).
  - **Found: the DSE incentive.** Every year's sheet adds a **₹1,000 bonus** (retention ≥ ₹60,000 for a
    tipper, else ≥ ₹40,000) to the slab, and the slab's steps were **<4 / <7 / <11 until 2024-25**, <5 / <9 /
    <13 from 2025-26. The tracker's screen formula has only today's slab, no bonus (R2-19 read the slab
    "verbatim" and missed the "+IF"). Not changed — owner question.
  - Tests: `selftest-import-read` **12/0** (new; 4 mutants caught) · `selftest-import-merge` **36/0** (3 new
    mutants caught) · `selftest-vehicle-units` **560/0** · `selftest-tracker-cells` **147/0** · deno check ·
    build clean.
- ⚠️⚠️ **2026-10-24: LOAD TEST at 4× — THE GRID DOES NOT SCALE AS BUILT** (owner: "check for 4 times the
  quantity … the next 3-4 years", "ensure everything falls within Supabase limits"). `scripts/phase10/load-x4.sql`
  on STAGING: 11 copies of the DEMO seed → **24,606 trucks · 34,004 notes · 6,604 colours** (one import batch
  "DEMO LOAD x4"; DB 20 → 53 MB of 500). Measured in the owner's Chrome (dev build), staging free tier:
  | what | 4× result |
  |---|---|
  | open the page | **~100 s** first time, **~270 s** the second (25 sequential pages of 1,000 at 1.5 → 5–27 s each as the free instance slowed; `listNotes` 23 → **61 s** — the EF wall limit is 150 s) |
  | after the data arrives | one **20 s** freeze building the grid; tab memory **365 → 582 MB** |
  | Find (Enter) | ~**2 s** each |
  | type one cell | **2.1 s** freeze before the save starts, saved at ~4.8 s (same on the put-back) |
  | scroll | ~**230 ms** of work per wheel step (≈ 4 frames/s) |
  | sort the book | **never finished** — the tab hung > 4 min, twice; nothing was saved (audit: only the test edit + put-back) |
  | data per open | ~**55 MB** raw JSON (trucks 39 with nulls stripped / 68 with, notes 12.6, colours 1.4) → the free 5 GB/month egress = **~90 opens a month** uncompressed (~900 if gzip ~10:1 — not documented) |
  Supabase free limits (docs, 2026-10-24): EF 256 MB memory, **2 s CPU per request**, 150 s wall clock; egress
  5 GB uncached / month; DB 500 MB. DB size is fine for decades; **the cause is the design: every open loads the
  whole book (all years, ~100 columns, every note) into the browser**, so cost grows with history, not with work.
  ⏭️ Owner decision pending (see the session's reply): load a WORKING SET by default (this and last financial
  year + every truck still open), older years on request; notes/colours only for loaded rows; pages fetched in
  parallel, nulls dropped; then re-measure at 4×. The DEMO LOAD x4 rows stay on staging until the owner says.
- ✅ **2026-10-24 (session 3, last part): THE WORKING SET — the grid no longer loads the whole book.** Owner chose
  **"Current year only"** (this financial year + every older truck still open; other years on request) and to
  KEEP the DEMO LOAD x4 rows for re-measuring. Uncommitted at the start of the compaction → committed with these docs.
  - **DB** `supabase/migrations/20261024_phase10_tracker_working_set.sql` (STAGING; **eleven** tracker migrations
    for prod now): `tracker_still_open(8 plain columns)` IMMUTABLE — stock (no invoice + no retail date, not
    delivered) · AL status filled and not Cash Invoiced/Fresh Offtake · refund pending/to collect (also "p", "to")
    · delivery pending/stock · financed (not CASH) with no finance-received date. Measured on the real 2022-26
    files: **1,491 of 5,832 older trucks** (refund 937 — many since 2022-23, may be stale · finance 249 · stock
    235 · delivery 101 · AL 25) → the real grid would open ~1,630 trucks, not 5,974. **Indexes**
    `vehicle_units_book_date` (expression: coalesce(invoice, retail, gatepass)) + partial
    `vehicle_units_still_open` (created_at, id). `tracker_book(scope, year, cols, inc_cols, ids,
    include_superseded, hidden_keys, offset, limit)` → ONE call: a PAGE of rows (only asked columns, nulls
    stripped), their incentives, notes (+author name), colours, `dse_counts` (the whole book's DSE-month counts
    for the months the page touches), `scope_count`, `fy_start` (India date), `total`. Scopes working / year /
    all / ids; the WHERE is built per scope (EXECUTE) so the indexes are used. service_role only.
    Staging prosrc md5: tracker_book `504093d3…`, tracker_still_open `8d2c7186…` = file.
    `scripts/phase10/probe-working-set.sql` **16/0** (PGlite + staging) — **6 planted mutants each caught** (open
    rule dropped · nulls kept · notes of the whole scope on every page · grant to authenticated · slab counts
    only loaded rows · limit ignored). ⚠️ The first mutant run had a survivor (notes per page) → the probe now
    sums notes across pages.
  - **EF** `admin-vehicle-units` (deployed to staging): actions **`book`** (planRead → POST
    `/rest/v1/rpc/tracker_book` with the secret key, the DB's JSON passed through as TEXT — never parsed, to
    spare the 2 s CPU — wrapped as `{"ok":true,"hidden":[…],"book":…}`; `BOOK_PAGE = 2500`) and **`find`**
    (q 3–40 chars of A-Z 0-9 . / -, ilike on the 11 Find columns, 50 newest, returns id/chassis/customer/model/
    the three dates/superseded_at). Both on `hasTrackerAccess`. `list`/`listNotes`/`listFormats` still exist
    (unused by the page now).
  - **Client**: `trackerApi.loadBook(columns, scope, onProgress)` — page 1 says scope_count, the rest ONE AT A
    TIME (AT_ONCE = 1), each tried 3× (1.5 s, 3 s back-off), every asked column re-filled as null;
    `findAnywhere(q)`. `TrackerPage`: scope state ({scope:'working'} default; year / all), `slabBase` = server
    dse_counts − this page's trucks of that month → `withScreenColumns(rows, today, base)` (new 3rd arg in
    screenColumns.js; `dseMonthKey` exported), `changeScope` refused while anything waits to save, grid
    remounts per scope (`key`), header "3,688 vehicles · 2026-27 + still open" (title = whole book total),
    "Loading … x of y vehicles". `TrackerTools`: **Year** select ("2026-27 + still open" · each year 2022-23 →
    now "only" · "All years (slow)" with a confirm); Find "not in this view" → **Search all years** → list of
    hits (year shown) → opens that year and goes to the truck (`goAfterLoad`). `src/tracker/lib/bookYear.js`
    (FIRST_YEAR 2022 — the books start Nov 2022, owner · fyLabel · fyOfTruck). CSS `.trk-elsewhere*`.
  - **Grid hardening** (TrackerGrid.jsx): `BOOK_ID = 'tracker'`; every lookup by id, never "the active
    workbook"; ALL 7 Univer listeners return unless the event is ours (`mine(p)`: p.workbook / **p.payload.params.unitId**
    (SheetValueChanged carries the command as payload) / p.params.unitId) and `ourRanges(p)` filters
    effectedRanges by `range.getUnitId()`. ⭐ Found because a TEST workbook created in the same engine fired the
    tracker's save path with 380k cells (stack overflow; nothing saved — the copy held identical values; DB
    checked twice). A sort no longer runs the value/format scan (`/sort|reorder/` on lastCmd → return).
  - **Measured at 4× (24,606 trucks, 34k notes) in the owner's Chrome, dev build** — before → after:
    | | whole book (before) | working set, pessimistic (9,074) | working set, steady (3,688) |
    |---|---|---|---|
    | open | 100–270 s | **18–19 s** | **9.5 s** (21–25 s when the instance was cold/busy) |
    | freeze after load | 20 s | 0.5–0.6 s | **0.2 s** |
    | tab memory | 582 MB | 202–256 MB | **154 MB** |
    | edit: freeze / saved | 2.1 s / 4.8 s | 0.8 s / 2.6 s | **0.18 s / 1.2 s** |
    | scroll (work per wheel step) | 230 ms | 110 ms | **< 50 ms** |
    | sort the grid | never finished | — | ⚠️ **31 s** (see below) |
    | data per open | ~55 MB | ~19 MB | ~7 MB |
    Pessimistic = 26% of all history stays open for ever (the real share today); steady = only about today's
    open count stays open (`scripts/phase10/load-x4-shape.sql`: copy 1 → this year, copies 2–11 back one year
    each, share 0.35 → pessimistic / 0 → steady; staging is in the STEADY shape now). In the DB a 2,000-row page
    = 0.37–0.6 s once indexed (was 1.6 s, 1.46 s of it deciding the scope; filter 1,459 → 6 ms).
  - ⚠️ **Free-tier limits found:** PostgREST calls run under the **authenticator's 8 s statement_timeout**
    (service_role has none of its own; anon 3 s, authenticated 8 s) — a 9,000-row single call took 5–14 s →
    "The book could not be read"; pages of 5,000 (≈10 MB) also failed → 2,500. Three pages at once overloaded the
    free instance (~13 s each, some over the limit) → one at a time. Each EF call costs ~1.1–2.5 s fixed (sign-in
    check, profile, rate limit). The instance's speed varies a lot under sustained load (the same page 1.9 s,
    later 12 s) — re-measure on a quiet instance. Supabase docs (2026-10-24): EF 256 MB, 2 s CPU/request, 150 s
    wall; egress 5 GB uncached/month free; DB 500 MB (staging 53 MB at 4×).
  - ✅ **2026-10-25 — SORTING FIXED (`6303234`): ~31 s → 1.9–2.3 s at 3,688 trucks** (undo 2.0 s, redo 1.7 s).
    Found on a throwaway bench (the same presets, column styles and paid rule on made-up rows, no login) by
    switching each ingredient off: the paid rule alone = 6–19 s, column styles / freeze / other plugins ≈ 0.
    Not the formula — a plain TEXT rule was as slow. Cause, in Univer's own code: on a sort every
    conditional-format range is moved row by row (`sheets` `handleReorderRangeCommon` →
    `Rectangle.subtractMulti` of the rule's range against EACH sorted row), and the notes plugin moves every
    note (3,000 notes another ~18 s). Neither needs moving: the rule covers the whole column whatever the order,
    and our grid redraws notes on their trucks after every sort anyway. So `TrackerGrid` takes the rule and the
    notes off SILENTLY (mutations, off the undo stack) in `BeforeCommandExecute` of `sheet.command.reorder-range`
    and puts them back after it (a timer too, in case a sort is refused). Undo/redo replay only the reorder
    mutation, so they never take the slow path. Also fixed on the way: notes were redrawn THREE times per sort
    (the generic `/sort|reorder/` match fired for the command, its mutation and the outer sort-range) → once;
    and an undo of a sort (a bare mutation, no command) went through the change check as an edit of every cell
    → skipped like a sort. Checked on the real page (owner's Chrome, staging): colours right on all 3,688 rows
    after sort, undo and redo (1,383 green); all 2,053 notes on their trucks; nothing sent to the server.
    "All years" at 4× (24,605): a sort 28 s (it never finished before) — rare, labelled slow.
  - ✅ **The edit freeze is NOT the rule** (bench at 9,074 rows: 0.45–0.83 s with it, 0.35–0.83 s without) —
    Univer's own redraw; 0.18 s steady. Left as is.
  - ✅ **2026-10-25 — browser check of the working set (`eb198a6`):** Year picker 2024-25 = 2,050 trucks (= the
    database's count; every one dated in that year), back to 3,688. "Search all years" found a closed 2022-23
    truck and opened it in its year with the cursor on it. "All years" at 4×: **47 s** to open (was 100–270 s),
    20 s worst freeze, 760 MB. It found three defects, all fixed and re-checked (0 errors over 5 switches,
    including sort + switch at once):
    - ⭐ **an undo of a sort CRASHED the formats path** (`Maximum call stack size exceeded` in `onFormats`):
      `list.push(...list)` passes every item as an argument. Every `push(...)` / `Math.max(...)` in `src/tracker`
      is now a loop (a big paste or colouring could hit it too) — `selftest-tracker-cells` checks the source
      (155/0; the planted old line fails it). Nothing had been sent (it crashed before).
    - **switching the year threw inside Univer**: `dispose()` ran inside React's unmount ("synchronously unmount a
      root", `SheetsScrollRenderController` not found), and the formula engine's 1 s progress timer — never
      cleared by `dispose()`, restarted by every calculation, so waiting does not help — fired into the dead
      engine ("Locale not initialized"). Disposal now waits a tick and first switches the dying engine's
      `TriggerCalculationController._startProgress` off (internal API, guarded). On prod each would have reached
      the Error Log.
    - **"Search all years" only showed when nothing here matched** — two chassis can end alike → offered whenever
      the search is long enough ("2 here · 10 in other years").
    An edit still saves (`applyChanges`, audit rows "typed", value put back on a DEMO truck).
  - ✅ **`selftest-load-book` 19/0** (`4aa826c`): the pages in order, one at a time, merged (empty cells → null,
    notes, colours, DSE counts), progress, retry after 1.5 s then 3 s, the third failure reported. Planted bugs
    (three at once · no retry · one page too many) fail it 2 / 6 / 1.
  - Tests: `selftest-tracker-cells` **153/0** (+6: slab base, fyOfTruck) · `selftest-vehicle-units` **587/0** (+the
    still-open rule's paid words = PAID_WORDS; a planted "cash invoiced only" fails it) · import-merge 39/0 ·
    import-read 12/0 · probe-working-set 16/0 · deno check · build · no-undef lint clean.
  - ⭐ **Lessons:** a mutant run on an UNTRACKED file cannot be undone with `git checkout` (it silently did
    nothing and left the planted bug in the migration — caught by re-reading; restore by hand and re-test).
    A probe must not page through the real table on a big book (3-row pages over 9,000 rows hit the timeout) —
    page through its own rows. Univer events are ENGINE-wide. Measure the DB alone, the EF alone and the page
    to find where time goes — each had a different bottleneck.
- **Next, in this order:**
  0. ✅ **Working set finished 2026-10-25** (sort fixed, browser-checked, paging test). Owner answers the same day:
     **DEMO LOAD x4 rows: "wait right now"** — they stay on staging, do not ask again until the real load ·
     **the 2023-24 + 2024-25 sales books: "we'll share in a little while"** · the AL Balance Sheet upload: agreed ·
     **prod: "we will go live when I give the command"** — never propose a date, wait for the command.
     Left, optional: re-measure steady + pessimistic open times on a quiet instance.
     ✅ **2026-10-25 — the monthly AL Balance Sheet check BUILT on staging (10g, `b705bea` → this commit):** reader
     (`src/tracker/lib/alSheet.js`, 12 real sheets read: every month ties, carry-over chains) · migration
     `20261025_phase10_tracker_al_sheet.sql` on STAGING (**twelve** tracker migrations for prod; LF) · EF actions
     alUpload/alReview/alSettle (staging) · "AL sheet" panel on /tracker. Browser-checked with DUMMY Sep + Oct 2026
     sheets (`scripts/phase10/write-demo-al-sheets.mjs`): every planted problem listed, nothing else; Go to truck;
     It is right + reason remembered across a replace; same file again = no-op; tracker untouched (0 audit rows).
     Tests: al-sheet 25/0 (+--real 47/0) · probe-al-sheet 21/0 (5 mutants) · vehicle-units 653/0 · review 0.48 s for a year.
     ⚠️ Staging keeps the 3 DUMMY uploads (al_sheet_*) — deleting needs owner approval. Not live-tested: Go to truck
     for a truck in another year (same path as Search all years).
     Ports: staging also allows `localhost:3001` since 2026-10-25 — tracker on :3000, invoices on :3001, both sign in.
  0b. ⏭️ **The team's file pile** (2026-10-25): `D:PTBFinancesBackup data` (~4.6 lakh files, 129 GB) → `inventory.cjs` →
     owner checks → copy into `Backup data_Sorted` by kind + year (see CLAUDE.md 2026-10-25 "THE TEAM'S FILE PILE"). The
     sorted purchase / sales / retention / AL books then feed step 1. Only that folder may be read.
  1. **When the owner's UPDATED files arrive: run the importer onto STAGING** (the repository/archive) — now
     ALL years at once (`run.cjs <scratch>` with no files, or the owner's folders):
     `node scripts/phase10/import/run.cjs <scratch> [files/folders]` → `node scripts/phase10/import/sql.cjs
     <scratch> <admin uuid>` → rehearse on PGlite (all 12 tracker migrations, then `import.sql`, then
     `recompute-diff.sql` + `probe-foundation.sql`) → staging `db query --linked -f <scratch>/import.sql` →
     `recompute-diff.sql` on staging → open `/tracker` and MEASURE how the grid draws ~5,000 notes (only ~10
     so far). ✅ The DEMO rows STAY (owner 2026-10-24) — the real trucks load beside them (their chassis all
     start `DEMO-`, so nothing clashes). Importer answers: see "Owner, 2026-10-24" below; two still open.
  2. ✅ **AL Balance Sheet monthly upload BUILT on staging 2026-10-25** (see step 0). After the real load: upload the
     owner's REAL 2025-26 sheets on staging and read the review with him (the 23-Oct rehearsal predicts ~172
     CTD differences, 43 trucks on no sheet, 51 unfinished splits, 55 spellings — the first month will be long;
     "It is right" makes it shrink). Staging keeps 3 DUMMY uploads (Sep, Sep v2, Oct 2026) until the owner says.
  3. Not built: phone view (read-only cards) · a save queue that survives reloads (E5) · removing a saved
     note · incentive editing (admin + HR) · layout column ORDER and saved FILTERS · the import wizard/revert
     (Stage 6).
- **On staging now (klpnhpnlotcbbovwswmq):** migrations `…_foundation`, `…_supersede`, `…_numeric_before`,
  `…_create_units` (md5 `8f4e051d…`), `…_rmc_gst` (md5 `714d9b5d…`), `…_endhan_date`, `…_mto_advance`,
  `…_import_notes` (note source 'import'), `…_al_retail_date`, `…_two_ctc` (compute md5 `ee1a22a6…`, apply
  `08ff1a12…` = file), `…_working_set` (tracker_book `504093d3…`, tracker_still_open `8d2c7186…` = file), `…_al_sheet`
  (2026-10-25: tracker_al_upload `a1c93d3d…`, tracker_al_review `f28f533b…`, tracker_al_settle `d3833fae…`,
  tracker_al_mode `8b459ecb…`, tracker_al_kind `45f5974c…` = file; 3 DUMMY uploads, 435 lines, 1 settled line); Edge Functions
  `admin-vehicle-units` (endhan_date + mto_advance + al_retail_date + al_ctc; actions `book` + `find` + `alUpload` /
  `alReview` / `alSettle`, BOOK_PAGE 2500) and `admin-users` (tracker actions) as in
  this branch. **2,056 tracker rows, all DUMMY** (2,050 `DEMO seed` + `DEMO-PROBE-202610220945` original and
  rebill + `DEMO-NEWROW-0001…0004`). Test edits left on dummy rows: slice 2 (CTC/CTD on a few DEMO trucks,
  Segment → TIPPER on three, "DEMO AFTER SORT" on DEMO-MB1AS0000345, CTC 21,11,111 on DEMO-MB1AT0002049);
  slice 3 (DEMO-NEWROW-0001 Engine No "DEMO NEW MODEL"); slice 4 (yellow on DEMO-NEWROW-0004 Model + CTC,
  `{}` on -0003 Model; notes "DEMO note: held for finance" on -0003 Model, two "hand test" notes on
  DEMO-MB1AR0000517 / DEMO-MB1AT0002049 Model); 10-23 (DEMO-NEWROW-0002 AL Payment Status → IBND; audit rows
  only, values put back: Endhan Date set+cleared on DEMO-PROBE-202610220945, AL Payment Status "fresh OFFTAKE"
  set+cleared on DEMO-NEWROW-0001, MTO Advance Yes+cleared on DEMO-NEWROW-0003). Layout "DEMO layout test"
  DELETED 2026-10-24 (owner: "Sure"; by SQL, by id — so the Delete BUTTON is still unexercised); no layouts
  left. Audit:
  one `tracker_copy` (196 rows × 39 columns). No RMC rows. Nobody has the tracker switch on; admin always has it.
- **Tests:** `selftest-tracker-cells` **147/0** · `selftest-vehicle-units` **560/0** · `selftest-import-merge`
  **36/0** · `selftest-import-read` **12/0** · probes foundation 42 · supersede 19 · numeric-before 9 · create-units 18 · rmc-gst 9 · endhan-date 6 ·
  mto-advance 6 · al-retail-date 6 · two-ctc 9 (all 0 failed, PGlite and staging) · `gst_rmc.cjs` / `al_balance_check.cjs` / `e_sources.cjs`
  re-measure from the workbooks (counts only). Build + no-undef clean.
- **Checking in a browser:** the owner's Chrome (Claude in Chrome, tab on `http://localhost:3000/tracker`) is
  signed in as `admin@parastrucks.test`. ⚠️ **The app stops the dev server at the end of each turn** ("stopped
  by the app") — `preview_start {name:"portal"}` again at the start of any turn that needs it, or Chrome shows
  ERR_CONNECTION_REFUSED. ⚠️ **Chrome screenshots time out while the Claude window is hidden** — drive and read
  the page through `javascript_tool` instead (the grid is `window.__trackerUniver` in dev; the page's own
  modules import as `await import('/src/tracker/lib/…')`, so a check can go through the real save path).
  Staging SQL: `npx --yes supabase@2.109.1 db query --linked --workdir <scratch>/sb -f <ABSOLUTE path>` (a relative
  path is read from the workdir and fails). Several statements in one `db query` print only the last result.
  Real workbooks: `D:/PTB/Finances/2025-26/` (INVOICE TRACKER + monthly folders with the RETENTION and AL
  Balance Sheet files; ⚠️ `2025-10 - OCTOBER/` holds an OLDER copy of the INVOICE TRACKER — never feed both) and
  `C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/…` (2025-26.xlsx + 12 INVOICE LISTs).
- **Univer lessons that must not be relearned** (each measured): `getRawValues()` never `getValue(s)` ·
  put-backs/redraws as MUTATIONS (off the undo stack) · each mount its own element · a page button keeps the
  keyboard → `startEditing()` · a style change arrives as `SheetValueChanged`, undo included · a value-only
  mutation keeps the style · notes stay at their sheet POSITION on a sort → redraw by truck · `silent` note
  mutations still fire note events · `Before…` note events fire from the menu, not from facade calls ·
  ⭐ conditional formatting leaks into `getCellStyleData()`/`getCellData()` → read styles RAW
  (`getSheet().getCellRaw` + `getStyles().getStyleByCell`) · a CF rule formula can use `OR(…)` · columns
  shown/hidden as mutations `sheet.mutation.set-col-visible` / `set-col-hidden` ({unitId, subUnitId, ranges}) ·
  `getSheet().getColVisible(c)` / `getRowVisible(r)` (false for a filtered-out row) · the facade
  `sheet.hideColumns(i, n)` is what right-click → Hide does (a command) · `getMaxColumns()` = business
  columns + the hidden id column.
- **Tooling lessons (this session):** a backslash inside a `node -e` string or a Bash heredoc can reach the
  file as a control character (`\r` `\n` `\b` became real CR/LF/backspace) — write such code with the
  Write tool, or build backslashes with `String.fromCharCode(92)`; check edited files with `cat -A`. A test
  that passes first time is not yet a test: plant the bug and watch it fail (two of this session's
  self-tests let a planted bug through until their data was widened).
- **Prod: nothing.** The prod rollout, ONLY on the owner's command (2026-10-25): the **twelve** tracker migrations (LF text, in file-name order — `…_al_sheet` last), both functions
  (`--no-verify-jwt`; `admin-vehicle-units` joins the key-cutover roster), then the frontend.
- **Owner questions — answered 2026-10-23:** AL Payment Status green = Cash Invoiced only · only RMC is
  always 18% GST · sandbox = real data on staging first, then the trial on the live site · read-only
  date: none yet — updated files in a day or two → repository + archive, then incremental top-ups.
  **Answered later on 10-23:** (a) the 59 dates beside ENDHAN = the day the Endhan was given — "I believe
  so" → ✅ **"Endhan Date" column BUILT** (below) · (b) DEALERS column L dates — "not sure" → they go in
  as a **cell note on their truck** (the default: nothing lost, nothing guessed) · (c) rows 720 / 948 —
  "not sure" → imported **as billed** (`gst_rate_override` = the rate Excel used), so the archive
  matches what was actually invoiced; flagged in the import report. ✅ **AL ledger DECIDED (owner, option D):** keep the
  Excel file; each month the final sheet is uploaded and the portal lists discrepancies. Rehearsed on the
  12 real 2025-26 sheets (`scripts/phase10/al_balance_check.cjs`): arithmetic ties every month; 78 CTDs
  differ by exactly the GST change, 172 by 1–10%, 43 AL-invoiced trucks on no sheet, 72 unfinished
  splits, 55 mode spellings. Built AFTER the first real load (column map → section G "DECIDED").
  ✅ Owner: FRESH OFFTAKE = Cash Invoiced (green rule accepts both, seen on staging) · MTO = the 5% advance
  before a chassis exists · GST by the PTB invoice date for CTC and CTD → re-run: 75 of 78 GST CTDs follow
  the rule, 3 do not; 21 MTO advances pair to 95% trucks (splits 72 → 51); 172 + 43 remain the review list.
- ✅ **10-23: "MTO Advance" Yes/No column** (owner chose it over an orders list — **"keep the table as flat as
  possible"**, now a standing rule) — migration `20261023_phase10_tracker_mto_advance.sql` on STAGING, EF
  redeployed, probe 6/0, vehicle-units 556/0, cells 127/0 (fixed lists case-forgiving). Prod rollout is now
  **seven** migrations.
- ✅ **10-23: SLICE 5 — Find, layouts, Copy for mail, row history** (`1c08d05`, no server change — the EF
  actions existed since Stage 1). ONE toolbar line above the grid (the grid gives up one line of height):
  · **Find**: the last digits of a chassis / engine / gatepass (ends-with on those three ranks first, then
  contains, then ODN, V-part, invoice numbers, customer, dealer, model; ≥3 characters); Enter goes to the
  next; a row hidden by the person's filter is named, not unfiltered. Univer's own Ctrl+F still searches
  every cell. · **Layouts** = the columns left showing: hide as in Excel (right-click → Hide), "Save layout"
  with a name (same name = update); admin may tick "Shared with everyone"; applied as MUTATIONS (Ctrl+Z
  does not undo a layout choice); remembered per browser; chassis always shows. NOT in a layout yet: column
  ORDER (the book's order) and FILTERS. · **Copy for mail**: the rows the filter leaves × the columns
  showing, as an HTML table (colours: the person's fill + the paid green; money in lakhs, a crore shown
  properly; dd/mm/yy) + tab-separated text; asks first above 20,000 cells; logged `tracker_copy` (rows,
  columns, incentives yes/no). · **History**: the selected cell's truck — who, when (IST), what, old →
  new, how (typed / pasted / filled / undone / added / imported), latest 200; "Only <column>" filter.
  Pure logic in `showValue.js` / `findRows.js` / `mailTable.js` / `historyText.js`; "paid" is now ONE list
  (`PAID_WORDS`) for the grid rule and the copy. `selftest-tracker-cells` **147/0**; build + no-undef clean.
  **Seen on staging in the owner's Chrome:** Find "001374" → "1 found" → Enter landed on DEMO-MB1AS0001374 ·
  hid 60 columns → saved "DEMO layout test" (39 columns) → All columns (all back) → the layout (same 60
  hidden) → reload: the layout came back · with Segment = TIPPER filtered, Copy gave **196 rows × 39
  columns = the 196 TIPPER trucks exactly**, HTML + text, logged on staging (196 / 39 / incentives true) ·
  History on DEMO-MB1AS0000345: "Customer Name: DEMO CUSTOMER 426 → DEMO AFTER SORT" (Staging Admin, typed)
  + "Vehicle added" (imported), IST times, "Only Model" left the added line. **Not exercised:** the layout
  Delete button (deleting a row needs the owner's OK — the test layout "DEMO layout test" is still on staging),
  a shared layout seen by a non-admin, a real paste into Outlook.
- ✅ **10-23: THE FIRST-LOAD IMPORTER, built and rehearsed OFFLINE on the real 2025-26 files** (`0a82d80`;
  nothing loaded on staging — that waits for the owner's UPDATED files). `scripts/phase10/import/`:
  **read.cjs** (a file is recognised by its sheets + headers, never its name) → **merge.cjs** (pure: one record
  per truck) → **run.cjs** (writes `import.json` OUTSIDE the repo — it refuses a folder inside it — counts only)
  → **sql.cjs** (one transaction, `recompute = false`, one import batch id) → **recompute-diff.sql**
  (self-aborting: what the database's rules would give vs the workbook, per worked-out column).
  ⭐ **The sources are 38 files, not six:** INVOICE TRACKER (2 sheets) · the year file 2025-26.xlsx · 12 monthly
  INVOICE LISTs (PTB RETAIL — bill column "TALLY BILL" in 8 months, "CUSTOMER BILL" in 4 — + OTHER DEALER
  retail + DEALERS + canc rebill in 5) · 12 + 12 RETENTION TRACKERs (data on the month's sheet, not SUMMARY;
  7 internal months have no DSM column). Out: each list's Sheet5 (prior-year receivables, R2-24), FINANCE DATA,
  the Pending Reco sheets, AL Balance Sheet (its own monthly upload, section G).
  ⭐ **A HOME FILE PER COLUMN, measured** (`scripts/phase10/e_sources.cjs`, counts only): engine numbers agree
  everywhere (0 of ~1,900) → the join is sound · the purchase file is the odd one out on **CTC** (~25%, mostly
  within 2% — settled again at sale) and the **customer** (~18%) while retail, the lists and retention agree →
  **retail is home for both** · **CTD**: purchase ↔ retention agree best → purchase is home · the year file ⊇ the
  12 monthly retail lists and agrees with them on every sale column EXCEPT invoice date (188) and AD-BLU (186) —
  its mixed layouts (R2-4) → **the monthly list is home for those two** · segment: retention's "MDV BUS / ICV
  BUS" refines retail's "BUS" (not a conflict) · DSE: retention is home (it pays the incentive; 162 differ) ·
  identity (model, V-part, HSN, gatepass, ODN) from the purchase file. **Every other file's different value is
  kept as a note on that cell** (source `import`, naming the file and row) — migration
  `20261023_phase10_tracker_import_notes.sql` on STAGING (constraint + 'import').
  Also carried: 140 Excel comments → notes · 984 hand-typed input formulas → notes (`excel_formula`) · 250 flag
  colours → `{bg}` (the paid green is the rule, not imported) · GST overrides (rows 720 / 948 — exactly 2) ·
  road tax read from the FULL TAX formula (321 at 0% ≈ the 322 measured, 2 at 8%) · 68 full-tax overrides ·
  59 Endhan dates · stray cells as notes · DSM / GM incentives + 60-odd typed DSE overrides (1,387 rows) ·
  "Bought from" (the list's DEALOR column) as a note · cancel/rebill: 8 pairs, **4 real links** (the other 4
  re-billed the SAME chassis) + remarks typed into its new-chassis column as notes.
  **Result: 38 files → 2,523 trucks · 5,154 notes (4,030 disagreements) · loads in ONE transaction on PGlite
  with all 8 tracker migrations (~6 MB of SQL, seconds); probe-foundation still 42/0.**
  **Recompute-and-diff** (rows where the database's rule gives another figure): diff base / GST **1,304** (the
  purchase sheet divides by 1.28 on EVERY row, also after the GST change — the rule corrects it) · retention
  (dealer) 488 (retail's CTC vs the sheet's own) · app amt 551 · retention internal 295 · receivable / net
  refund 202 · TCS 126 / total 130 (the year file's TCS breaks tally × 1% on ~5%) · dealer basic/TDS/net
  61–70 (also /1.28) · payment amount / TDS / to-AL 10 · payment status 14 · **full tax 0**. History stays as
  the workbook holds it (recompute = false) until a row is edited — then the WHOLE row is reworked by the
  rules (the figures above change on the first edit; the audit logs the typed cell, not the reworked ones).
  `selftest-import-merge` **28/0** (made-up rows; 3 planted bugs — CTC home, history compared, paid green
  imported — each caught). ⚠️ **Not yet known:** how the grid draws ~5,000 notes (only ~10 so far); 224 trucks
  sold in 2025-26 have no purchase row (bought in 2024-25 — last year's INVOICE TRACKER would give it).
  **To load (when the updated files arrive):** `node scripts/phase10/import/run.cjs <scratch> [files/folders]`
  → `node scripts/phase10/import/sql.cjs <scratch> <admin uuid>` → PGlite rehearsal → staging
  `db query -f import.sql` → `recompute-diff.sql`. ⚠️ Ask first whether the DEMO rows stay.
  ❓ **Owner:** (1) AL's retail date differs from the internal one on 961 trucks (days to weeks, never a typo
  pattern) — its own column "AL Retail Date"? (2) retail as home for CTC and the customer — OK? (3) DSE from
  retention — OK? (4) send last year's INVOICE TRACKER too (224 trucks)? (5) ~4,000 disagreement notes for
  the pilot — OK, or a separate list instead?
  ✅ **Owner, 2026-10-24:** (1) **Yes** → `al_retail_date` BUILT (migration `20261024_phase10_tracker_al_retail_date.sql`
  on STAGING, probe `probe-al-retail-date.sql` 6/0 + a planted "not editable" mutant fails 3; EF redeployed;
  `date_of_retail` now reads ONLY the internal retention file, `al_retail_date` ONLY the AL one). Re-run on
  the real files: filled on 1,980 trucks, differs on 961, so **notes 5,154 → 4,193 (disagreements 4,030 →
  3,069)** · (2) "I guess, not sure why you ask" → kept (retail home); the reason was explained: the purchase
  and sales files disagree on CTC for ~25% and the customer for ~18%, and the grid can show only one ·
  (3) **Yes** · (4) "What year? The full year has ~2,000 vehicles" → asked back: 2024-25's INVOICE TRACKER, of
  which only the 224 rows for trucks SOLD in 2025-26 would be used (or all of it, if 2024-25 should be in the
  archive too — then its lists and retention files are needed as well) · (5) "What is this?" → explained in
  plain words (one value shown, the other file's value pinned to the cell as a note, like an Excel comment)
  and asked again: notes on the cells, or a separate review list. · Test layout deleted · DEMO rows stay.
  ✅ **Owner, later 10-24:** (4) "one continuous database … all vehicles" → every year, built (above) ·
  (5) **notes on the cells** · CTC = two figures → built (above).
  ✅ **Owner, end of 10-24:** (a) the bonus was paid "until last year … not from around November 2025" — the
  sheets agree (bonus formula to Dec 2025, none from Jan 2026). The slab steps are NOT a date rule (they swap
  between 4/7/11 and 5/9/13 sheet to sheet), so: **today's screen rule stays (5/9/13, no bonus — Jan 2026
  matches 140/140); the import keeps each month's PAID figure as `dse_incentive_override` where it differs**
  (`merge.cjs`, using the screen's own `withScreenColumns`, so import and grid cannot disagree; 2,624 kept
  in the rehearsal, 2,306 of them formula figures; `selftest-import-merge` **39/0**, 2 mutants caught) ·
  (b) the 2023-24 + 2024-25 sales books: the owner will send them "shortly" · (c) the books start **Nov 2022**.
- ✅ **10-23: "Endhan Date" column** — migration `20261023_phase10_tracker_endhan_date.sql` on STAGING
  (adds `vehicle_units.endhan_date date`; `tracker_apply_changes` re-created with it on the editable
  list, otherwise byte-identical to numeric_before; staging prosrc md5 `76308fce…` = file, LF) ·
  `columns.ts` + EF redeployed to staging · grid column "Endhan Date" right after Endhan.
  `probe-endhan-date` **6/0** (PGlite + staging; a mutant with the column but not on the list fails 3) ·
  every earlier probe still green · `selftest-vehicle-units` **553/0** — it now reads columns added by
  LATER migrations and the newest allowlist (it read only the foundation file, so it flagged the new
  column at once: a catalogue entry without a migration, or the reverse, fails it). Seen working through
  the deployed EF from the owner's signed-in tab (set → read back → cleared on DEMO-PROBE-202610220945;
  two audit rows left there). ⚠️ **Not seen drawn in the grid** — Chrome's screenshot timed out (Claude
  window hidden); the column comes from `columnMeta.js`. Prod rollout is now **six** migrations.

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
| Grid library | ~~STILL OPEN~~ → **Univer, decided 2026-10-21** (see "DECIDED" above; the table below is the August record) |

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
