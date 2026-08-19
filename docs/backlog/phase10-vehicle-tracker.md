# Phase 10 — Vehicle Tracker · CONSOLIDATED HANDOFF

> **Design reference — the full record of WHY every decision is what it is.**
> Self-contained; a new session needs only the four Phase 10 docs, all in this repo:
>
> | Doc | What it is |
> |---|---|
> | **`phase10-execution-plan.md`** | ⭐ **START HERE** — the approved plan: layman's explanation + build order + the appendix of load-bearing facts |
> | `phase10-vehicle-tracker.md` (this file) | The design reference — decisions, formulas, full findings register |
> | `phase10-review-round2.md` | The round-2 evidence: every number independently re-derived |
> | `scripts/phase10/*.cjs` | The SheetJS scripts that produced those numbers — re-runnable against the real workbooks |
>
> ⚠️ **Nothing here may cite a `~/.claude/plans/` path as a source of truth.** Those
> files are ephemeral and a Phase 10 plan has already been lost that way once. The repo
> is the record. (Superseded ancestors of this file lived at
> `let-s-start-phase-10-eventual-dragon.md` and `proud-brewing-flute.md`; both are
> fully absorbed here — do not go looking for them.)
>
> **Status: PLANNING COMPLETE — register RESOLVED, plan APPROVED by owner 2026-08-11.**
> Two independent review rounds are merged. Round 2 re-derived every numerical claim
> empirically. Verdict tags below: **[R2✓]** confirmed · **[R2±]** corrected ·
> **[R2✗]** overturned or stale · new round-2 findings in **§5H**. Three round-1 items
> were overturned — one of them a money formula (**TCS**, §4) — and all fixes are merged
> in place. §7's open questions are **answered** (see the execution plan's decision
> table). Next: the 1 d comparative grid spike, then stage 1 (foundation). ⚠️ Build order is **pilot-first** since 2026-08-11 — see the execution plan §2.5.

---

## 1. Context

Paras Trucks & Buses (Ashok Leyland commercial-vehicle dealership) runs an internal
portal at team.parastrucks.in (React 18 + Vite + Supabase, repo
`D:\PTB\Website\portal_phase1a_setup\portal`, prod branch `portal`).

The back-office tracks the full commercial life of every vehicle across **six
fragmented Excel workbooks**, each owned by a different team. Phase 10 replaces them
with one Excel-feel, database-backed grid at `/tracker` where **one row = one chassis
number**, covering: OEM purchase → payments to AL → sale → finance → delivery →
retention/rebate → staff incentives → refunds/collections.

**Success metric is ADOPTION.** If the team finds the portal slower or more annoying
than Excel and quietly reopens Excel, the project failed regardless of code quality.

### The 6 source workbooks

| File | Sheet | Rows | Lens |
|---|---|---|---|
| `INVOICE TRACKER 2025-26.xlsx` (D:\PTB\Finances\2025-26\) | `INVOICE TRACKER` | 2050 | OEM gatepass, AL payment, supplier-invoice diffs |
| same | `OTHER DEALER` | 251 | Inter-dealer purchases |
| `INVOICE LIST - MAR 26.xlsx` (C:\Users\dhruv\Downloads\PAYMENT TRACKER LIST 2025-26\…) | `PTB RETAIL` | 266 | Retail sale, delivery, refund |
| same | `DEALERS`, `canc rebill` | 479 / 87 | Transfers; cancellations |
| `2025-26.xlsx` (same folder) | `Sheet1` | 2105 | Full-year retail |
| `RETENTION TRACKER - MAR'26 -INTERNAL.xlsx` (D:\PTB\Finances\2025-26\2026-03 - MARCH\) | `MAR'26` | 268 | DSE/DSM/GM incentives |
| `RETENTION TRACKER - MAR'26 -AL.xlsx` (same) | `MAR'26` | 265 | Retention claim to AL |
| `AL Balance Sheet -0326.xlsx` (same) | `AL Balance Sheet` | 327 | AL ledger |

Pivot tabs (AO Figures, FINANCE DATA, SUMMARY) are derived reports, not data.

---

## 2. Decisions locked

| # | Topic | Decision |
|---|---|---|
| 1 | Grid library | `react-data-grid` (verified: virtualizes both axes; paste/fill/sort/frozen cols). **[R2±] MUST PIN `7.0.0-beta.48`** — every later version requires React 19.2 and the portal is React 18 (React 19 upgrade was rejected in the router WONTFIX). Paste/fill are event hooks (`onCellPaste`/`onFill`) — we write the clipboard-parse + fill reducers, not zero-code. **[SUPERSEDED 2026-08-11 — owner principle "closer to Excel is better"]** The library is no longer pre-decided: a **1 d comparative spike** scores `react-data-grid@7.0.0-beta.48` against **`@glideapps/glide-data-grid@6.0.3`** (MIT, React 18, ships native Excel-grade range selection / drag-copy-out / paste / fill; trade-off is canvas rendering, so custom editors and accessibility are harder). Winner = highest score on the Excel-parity checklist in the execution plan §2.3. React 19 stays deferred either way |
| 2 | URL + menu | `/tracker` + "Vehicle Tracker" top-level |
| 3 | Row identity | One row per chassis; customer stays free-text |
| 4 | Table shape | One wide table (~88 cols); unique on `chassis_no` |
| 5 | Access | Admin + hand-picked back-office allowlist |
| 6 | Date input | `dd/mm/yy` typed text, no picker |
| 7 | Views | Column subset + time-range filter, per-view anchor date |
| 8 | Import | One-time bulk migration, then named templates monthly |
| 9 | Make year/month | Computed from VIN pos 10 (year) / pos 12 (month) via AL's 30-yr chart. **[R2±]** Pos-10 is solid (S→2025 ×1410, T→2026 ×640, **zero** contradictions vs the `Make` column). Pos-12 is NOT proven: **15 distinct letters occur — more than 12 months** — so a single 12-letter table can't be the whole chart; empirical letter→gatepass-month mapping is strong for most letters (P→Mar 97%) but noisy for `N` (51%). Treat `make_month` as informational only, validate decoded month ≤ ~4 months before gatepass date on import, flag outliers. Never let money logic depend on it |
| 10 | AL purchase status | `Cash Invoiced` / `IBND` (Invoiced But Not Delivered = credit, pay next month) |
| 11 | Hypothecation | Implicit — the FINANCE bank column is the hypothecation entity |
| 12 | Refunds/collections | `customer_settlements` batch table; refund always to customer; statuses **Pending / Cleared**. **[R2±]** Import must normalize the wild vocabulary first — FY has **11** distinct refund-status strings (`PENDING×742, REFUNDED×323, NA×144, TO COLLECT×82, TO␣␣COLLECT×13, pending, na, P, to, n`) via an owner-reviewed mapping; and confirm in 10a that collections (`TO COLLECT` = money owed TO us) are also settlements (§7 Q6) |
| 13 | Settlement ID | `{TYPE}-{INITIALS}-{SEGMENT\|MIX}-{LATEST_TALLY_YYMM}-{SEQ}` e.g. `REF-KISH-HAU-2604-001` |
| 14 | **Access flag location** | **`auth.users.app_metadata`** — same pattern as PR #94's `must_change_password`. NOT a column on `users` (self-grantable). **[R2✓ + rider]** Pattern verified end-to-end (client-readable in JWT via `AuthContext`, service-role-only writable). Rider: **the JWT is a snapshot** — grant/revoke lands only on token refresh (up to ~1 h). `setTrackerAccess` must also call `admin_revoke_user_sessions` (exists since PR #87) on every flag change, and the EF-side gate should use fresh `getUser()` (as `erp-sso/index.ts:83` does), not the JWT claim |
| 15 | **Adoption essentials** | **In scope for Phase 10** (new step 10d3): single-row create, undo, notes/scratch cols, colour rules, cell comments |
| 16 | **Source-data conflicts** | **Back-office resolves in Excel BEFORE migration** (they know which number is right; we never guess). We produce the conflict report; they correct; we import clean files. **[SEQUENCING CHANGED 2026-08-11 — owner]** The report is produced **AFTER the sandbox trial**, not before the build: pilot first → feedback → *then* clean. Rationale: cleaning is a large ask with no visible payoff until they want the tool, and a clerk who has *seen* one truck showing two different prices on screen needs no report to explain the problem. See the execution plan §2.5. **[R2±] Conflict-report scope additions:** (a) the inter-dealer population overlaps THREE files (FY Sheet1 embeds dealer-layout rows; INVOICE LIST `DEALERS`; IT `OTHER DEALER`) — reconcile that trio or transfers import twice/zero; (b) stray live side-sheets — `INVOICE LIST` `Sheet5` holds **₹3.43 Cr** of pending payments on **10 chassis absent from every main sheet** (prior-FY receivables): ask which stray sheets are live, add a prior-FY open-items import; (c) the 124-comment census + ~221 deviant input-formula cells (§3) go in the same report |
| 17 | Per-cell formula bar (HyperFormula) | **CUT permanently** — binds to grid position, silently writes wrong numbers into money columns when a view reorders/sorts |
| 18 | Out of scope | Indents (no 1:many link to chassis), cancellation/rebill, e-invoice IRN, e-way bill, telematics, tyre/battery serials, first-service/warranty, driver training |

---

## 3. 🔴 CRITICAL — CTC basis varies per row; the reasoning lives in Excel cell comments

**Owner:** *"In some cases CTC is inclusive of the other values, in other cases it is
exclusive. We are handling this by manipulating the formulae and mentioning these
things in excel comments."*

Why this is the most important finding in the file:

1. **It explains the round-1 numbers.** The real formula `IF(P=0,0, P−Q−SUM(M:O))`
   scored 100% only *because blank AMC/DSA/AdBlue cells sum to zero*. The sheet
   encodes inclusive-vs-exclusive **implicitly, via whether those columns are
   populated**. There is no explicit flag anywhere.
2. **"Manipulating the formulae" means the sheet is not uniform.** Hand-edited cells
   mean the column has no single definition — any per-column migration formula is
   silently wrong for those rows.
3. **Excel cell comments are load-bearing business data.** They are the only record of
   why a row deviates. A normal xlsx import reads values and formulas and **discards
   comments entirely**.

### Required actions

| # | Action |
|---|---|
| N1 | Add explicit **`ctc_basis`** column (`inclusive` \| `exclusive`), derived on import (exclusive when any of AMC/DSA/AdBlue is populated), thereafter user-editable. Never re-infer at read time |
| N2 | **Extract every Excel cell comment during migration** → portal cell note on the same chassis+column. SheetJS exposes them via `cell.c` when read with `cellComments: true`. Hard requirement |
| N3 | **Formula-variance scan pre-migration**: read every formula cell, group by normalised pattern per column, flag every deviation from the column's dominant pattern. Each is a hand-manipulated row needing review. Ship this inside the conflict report (decision 16) |
| N4 | Per-cell notes become **required day-one**, not an adoption nice-to-have |
| N5 | `retention_dealer = IF(ctc=0, 0, ctc − ctd − COALESCE(amc_to_al,0) − COALESCE(dsa_paid,0) − COALESCE(ad_blue,0))` — correct under both bases, but store `ctc_basis` so intent is explicit |

**Round-2 refinement (good news — narrows the work):** the full variance scan over all
24,856 formula cells in INVOICE TRACKER found **every derived money column perfectly
uniform (zero deviant patterns)** — the hand-manipulation lives entirely in **input**
cells: `AD BLUE` (233 formula cells, 21 patterns — inline arithmetic like `1310*8`) and
`CTD` (22 cells, 10 patterns like `2055000/1.28*1.18`), **~221 deviant cells total**. So:
import input VALUES + recompute derived reproduces the book 100.0%; N3's scan targets
input columns only; what must survive from input formulas is their *provenance* (`1310*8`
= 8 buckets @ ₹1310), which pairs with the comments. Comment census: **124 total across
all six workbooks** (IT 95 — all on input cols M/N/O/P — OTHER DEALER 15, FY 14, zero
elsewhere), incl. quantity-slab price ladders (`CTC 17.50 IF 25 QTY`) recorded nowhere
else. That is a one-page owner-reviewable artifact, not an unbounded extraction problem.
Empirical `ctc_basis` split under N1's rule: 530/2050 rows (25.9%) exclusive.

---

## 4. Corrected money formulas (verified against the real workbooks)

Round 1 extracted the **actual Excel formulas** and tested every planned formula
against every real row. Round 2 re-derived every number below independently; verdicts
tagged. **⚠️ One round-1 "correction" (TCS) was itself wrong and is fixed here.**

| Originally planned | Match | **Correct formula** |
|---|---|---|
| `retention = ctc − ctd` | 69.3% | `IF(ctc=0,0, ctc − ctd − amc − dsa − adblue)` — see N5. **[R2✓ 2050/2050 = 100.0%; simple form 1420/2050 = 69.3% reproduced exactly]** |
| `diff_tds = diff_base × 0.1%` | 18.0% | `diff_amount × 0.1%` (gross, not base). **[R2✓ 2050/2050; base form 18.5%]** |
| `total = tally_bill + amc + tcs` | 65.8% | `ctc + tcs` (amc NOT added). **[R2✓ 100% in BOTH sheets: 266/266 PTB RETAIL, 2104/2104 FY.** Sheet formula is literally `T2=Q2+S2`. Note tally_bill IS still used — inside TCS, next row.) |
| ~~`tcs = ctc × 1%`~~ | — | **[R2✗ ROUND-1'S CORRECTION WAS WRONG — the ORIGINAL plan formula is correct: `tcs = tally_bill × 1%`.** Empirical: tally basis matches **266/266 = 100%** (PTB RETAIL) and 1973/2086 = 94.6% (FY); round-1's `ctc × 1%` matches only 65.8%/59.2% — it scored high solely on rows where tally = ctc (the §3 uniformity trap, again). TCS is tax collected at source on the **customer bill**. Eyeball the FY 5.4% residual during migration diff |
| `cretem = ₹1500 constant` | 35.8% | **Raw entry** — 11+ distinct values (7000×86, 6600×29, 9000×24…). **[R2✓ exact triple reproduced; 1500×93 = 35.0%; FY has 33 distinct]** |
| `gross = ctd + parts_pkg + credit_note + amc` | — | `gross_al = (ctd + amc_to_al) × qty` — parts_pkg/credit_note **excluded**. **[R2? COULD NOT VERIFY — no "gross" column exists in any sheet of the six files. Re-locate the source of this formula before implementing it; do not build from this row as-is]** |

**Verified correct as planned:** `total_recd`, `total_receivable`, `net_refund`,
`total_payment_to_al`, `total_difference`, `ageing_days`, `interest_on_ageing` (99.6–100%).
**[R2✓ + exact chain extracted from cells]:** `total_recd = margin_money + finance_recd +
subvention` · `total_receivable = total + insurance + cretem + full_tax` · `net_refund =
total_recd − total_receivable` · `tds = payment × 0.1%` (2050/2050) · `total_payment_to_al
= payment − tds` (2050/2050) · interest = ageing × total_payment × 10%/365 **clamped at 0
when negative** (the trigger must reproduce the clamp). ⚠️ `finance_paymt_rec` is a **DATE**
column, not money — never sum it.

**Also:**
- **`qty` column was missing entirely.** Keep the column (cheap insurance) — but
  **[R2± urgency down]:** qty = 1 on **all 4,672 rows across all four transactional
  sheets** (IT 2050, OTHER DEALER 251, PTB RETAIL 266, FY 2105); a full year contains
  zero Qty≠1 rows. Fleet deals are recorded one-row-per-chassis with the quantity
  ladder living in CTC cell comments (`CTC 17.50 IF 25 QTY`), not a qty cell.
- **"Retention" is THREE different concepts** — must be three columns. **[R2± mechanics
  sharpened]:** `retention_internal` vs `retention_dealer` agree 132/266 = **49.6%**
  (round-1's 50.4% ✓); the "81.9%" figure did NOT reproduce under any pairing — discard it.
  What round 2 found instead: RET-INTERNAL's retention ≡ RET-AL's *computed diff*
  (`ctc−ctd−other_ded`, same formula both files, 258/265 = 97.4% agree, rest is data
  drift), while RET-AL's "Retention" column — the claim to AL — is **not computed at
  all**: a raw negotiated number, **265/265 rows a multiple of ₹500**, with
  `app_amt = claim − computed diff` holding 265/265. So only `retention_internal` is
  derivable; **`retention_al_claim` must be an editable input column** with `app_amt`
  as the generated variance.
- **`dse_incentive` is not a row formula** — it's a monthly slab on that DSE's count in
  that month: `IF(COUNTIF<5→0, <9→1200, <13→1500, else 1800)`. Compute in a monthly
  view keyed on `date_of_retail`. **[R2± + override requirement]:** formula confirmed
  verbatim in the sheet, but values match it only **193/268 = 72.0%** — all 60 rows of
  DSE `SRS` (a house/institutional account) carry a **raw 0 pasted over the deleted
  formula**. A computed-only column would silently pay the house account ₹1800×60.
  Design = slab-as-default + per-row editable override + per-DSE eligibility flag, with
  override state visible on screen.
- **Four "money" columns are actually text**: `amc_charged_to_customer` (99.4%
  non-numeric in FY — 323/325 **[R2✓]**; 26/26 in PTB RETAIL), `parts_pkg_cashback`
  (58/58 text **[R2✓]**), `endhan_amount_given` (114/114 text in PTB RETAIL **[R2✓]**;
  **but FY is 832/916 = 90.8% — 84 numeric rows exist [R2±]**), `ad_blue_buckets_given`
  (**[R2±] majority-NUMERIC**: only 46.3% text in PTB RETAIL / 58.8% FY — and the text
  values include `5K-DSA`, `35K-DSA`, `10K-URIYA`: **the AD-BLU column demonstrably
  carries DSA and URIYA deals**). Store as text + parsed `{amount, kind}` — the parsed
  *kind* must be allowed to differ from the column name.
- **Column-letter corrections**: `delivery_status` = PTB RETAIL **AF** (not AE — AE is
  Refund Status); `payment_status` **AH** (not AG); `endhan` **AL** (not AM).
- **Drop `subvention_status`** — 100% blank in both sheets.
- `al_purchase_status` is `Cash Invoiced` on 2050/2050 sample rows — zero IBND observed.

---

## 5. Findings register — RESOLVED (round 2, 2026-08-11)

> **Resolution summary** (full evidence: repo `docs/backlog/phase10-review-round2.md`):
> **Confirmed as written [R2✓]:** A2-CTC(473 rows exact), A3(186 exact), B1, B2, C2, C3,
> C4, C6, C7(quantified: 80/116 policies bare, 0 wrapped), D1, D3–D7, D8, D9, E1, E3–E10,
> F1–F15 (F3 now evidence-backed), G1(12/43 & 91/313), G2(40), G3(71/310 exact), G4, G5(worse:
> 11 variants), G6. **Corrected [R2±]:** A1, A2(CTD 19.8% not 22.2%; customer 22.4% not
> 30.1%; "143 STOCK" not reproducible), A4(206 not 54 — but chassis recoverable), D2, E2
> (mechanism), E11(half). **Overturned/stale [R2✗]:** A5(arithmetic), C5(fixed by #89/#93,
> moot under decision 14), §4-TCS. **Unreproducible — discard:** the 81.9% retention figure,
> the 4 whitespace-colliding chassis. **New findings: §5H below.**
> Individual entries below are annotated only where round 2 changed them.

### A · Migration will hard-fail
- **A1 MEDIUM [R2± downgraded from BLOCKER]** Duplicate `chassis_no` is a ~6-row manual
  review, not systemic: INVOICE TRACKER has exactly **one** dup group (`MB1XEVHD1SRHK1555`
  r777+780 — VPart differs by one digit, likely a typo'd row; interest ₹18,680 vs ₹15,806 ✓);
  FY has **4** groups, 2 with different customers (`MB1PEECDXSAJU4480` −19.8L vs +1.41Cr ✓).
  The claimed whitespace-colliding chassis do **not** exist (0 groups collide only after
  trim). The dup groups are cancel/rebill artifacts — see §5H R2-3: **rebilled chassis
  genuinely have two commercial histories**, so keep the design: staging table with
  surrogate PK; `UNIQUE(chassis_no) WHERE superseded_at IS NULL`.
- **A2 BLOCKER [R2✓ direction, ± numbers]** Same chassis holds different values across
  files (IT↔FY join = 1789 chassis): CTC disagrees **26.5% (473/1783 — reproduced to the
  row)**, CTD **19.8% (353/1779**, not 22.2% — and text-polluted rows are silently skipped
  by any numeric diff, see A3), `customer_name` **22.4% (400/1789**, not 30.1%; exactly-`STOCK`
  rows = 3, not 143 — that sub-claim is unreproducible). Last-file-wins still silently
  corrupts ~1 money cell in 4. → conflicts raise a review row.
- **A3 HIGH [R2✓ count, ± geometry]** `2025-26.xlsx` mixes **at least THREE row layouts
  in one sheet** — 186/2105 non-date values in the invoice-date column (exact ✓), but the
  break is not a clean one-left shift at r1443: r1443+ rows carry ADBLU-text in AH, the
  date in AI, CTD in AJ, while r1440–1442-style rows are **inter-dealer-layout rows**
  (dealer names in the CTD column — the OTHER-DEALER extra `DEALOR` column) interleaved
  mid-sheet. Positional mapping cannot import it; per-row layout detection or decision-16
  cleanup required. See also §5H R2-27 (three-file overlap).
- **A4 MEDIUM [R2± downgraded]** The `DEALERS` sheet's header row is stale, not the data
  corrupt: "Chassis No" holds **206** engine numbers (not 54), but the **real chassis
  numbers are present under the "Model" header** (206 `MB1…` matches) + 19 subtotal rows.
  → hard-code the corrected column map for this one sheet in the migration script; no
  back-office restructuring needed, no data loss.
- **A5 [R2✗ arithmetic overturned — conclusion survives for rare classes only]** A 20-row
  spot-check would catch a 26.5%-frequency defect with P = 1−0.735²⁰ ≈ **99.8%**, not 0.4%.
  Where sampling actually fails: rare classes — the 6 duplicate rows (P(catch) ≈ 5.7%) or a
  single bad row (≈1%). → full recompute-and-diff stands, because it's nearly free and
  rare classes are what finance cares about.

### B · Schema not implementable as specified
- **B1 BLOCKER** Cannot INSERT into `GENERATED ALWAYS … STORED`. The plan's "import
  historical values as-is" is impossible with generated columns — every row would error
  or be silently recomputed, the exact history-rewrite the rule exists to prevent.
- **B2 BLOCKER** Six computed columns are **illegal** as generated: `ageing_days` /
  `interest_on_ageing` (use `today`); the `diff_*`→`total_difference` chain, `total`,
  `total_receivable`, `net_refund`, `total_payment_to_al` (reference other generated
  cols); `make_year`/`make_month` (read a lookup table); settlement `chassis_count` /
  `total_amount` (aggregate a child table). PG17 has no virtual generated columns.
  → one `BEFORE INSERT/UPDATE` trigger for row-local math, **skipping when
  `source_file IS NOT NULL`**; `ageing_days`/`interest_on_ageing` computed
  **client-side at render** (they change daily — storing makes every row stale tomorrow).

### C · Access control unenforceable as designed
- **C1 BLOCKER** `users_update` RLS includes `or id = auth.uid()` → **any user could
  grant themselves `tracker_access`** via one PATCH. *(Resolved by decision 14.)*
- **C2 BLOCKER** `canAccess()` matches only `permission_level × entity × department ×
  designation`. A per-user boolean is consulted by **nothing**. Step 10h ("0.5 d, Low")
  is fiction — needs a real per-user branch.
- **C3 CRITICAL** The gate is client-side only. A non-allowlisted user can POST to the
  Edge Function directly and read cost prices, margins, incentives, bank details.
- **C4 HIGH** `admin-users` has a hard field whitelist (`index.ts:506-515`) — unknown
  keys are dropped with **no error**, so the tick-box would appear to save and do nothing.
- **C5 [R2✗ STALE]** The wipe scenario is closed on both sides since #89/#93 (frontend
  never sends bare `[]` for applicable slots — `Employees.jsx:415-417`, `userShape.js:141-149`;
  server shape-gate 400s an explicit `[]` for required slots before `replaceJoin` runs) —
  and moot anyway under decision 14 (flag lives in `app_metadata`, not `users`). The
  dedicated `setTrackerAccess` action remains right for blast-radius reasons.
- **C6 HIGH** `current_user_role()` returns `'admin'` or `departments.code` — RLS can
  only say "admin OR back_office", never a hand-picked subset. No allowlist helper
  exists in the portal; Phase 10 would be the first.
- **C7 HIGH** The documented `(select f())` initplan trap is repeated by omission —
  `git grep` shows **zero** wrappings across all 24 migrations. The 4598ms-vs-73ms
  regression will recur. Wrap from the start.

### D · Security of the crown jewels
- **D1 HIGH** Customer bank account numbers land in **three plaintext sinks**: audit
  (`_shared/auditLog.ts:19-24` writes before/after jsonb verbatim), `log-error`
  (`index.ts:76-78` inserts arbitrary context unfiltered), and the `.xlsx` export. No
  PII-encryption pattern exists in the repo.
- **D2 HIGH [R2± precedent overstated]** `tracker_audit` RLS unspecified. (Correction:
  `service_job_events` RLS is actually scoped — admin OR same-entity + service/accounts/
  manager+, plus a restrictive `is_active_user()` policy — not blanket authenticated
  SELECT.) The risk itself stands: audit rows survive access revocation. → admin-only
  SELECT, and see §5H note — do NOT copy `security_audit_log`'s verbatim before/after
  jsonb pattern (hits both D1-PII and E8-growth).
- **D3 HIGH** `bulkUpdateCells` is mass-assignment **by design** — `{id, field, value}`
  lets a caller set `settlement_id`, `created_by`, `net_refund`, or any computed column.
  → server-side `EDITABLE_FIELDS` allowlist.
- **D4 HIGH** No maker-checker on money. Nothing prevents editing `net_refund` after a
  batch clears, changing `payee_account_no` minutes before RTGS, or deleting a Cleared
  settlement. → trigger rejecting UPDATE/DELETE on `status='Cleared'`; second user to clear.
- **D5 MEDIUM** Export is unbounded, unpermissioned, unaudited — one click walks out
  with the year's cost/margin/incentive book.
- **D6 MEDIUM** Plan silent on the `is_active` restrictive-policy loop (Phase 9
  enumerates 16 tables; Phase 9.5 correctly re-ran it) and on **RPC grants** (burned
  twice already — Supabase grants EXECUTE to `anon` AND `authenticated` on creation).
- **D7 MEDIUM** Incentive data has no precedent — every allowlisted clerk would see the
  GM's earnings per sale. Compounds open issue C1 (entity-wide PII in `users_select`).
- **D8 GOOD NEWS** VAPT M-1 is **already fixed** (`admin-catalog/index.ts:326-330`,
  `:349-352` both whitelist). The plan's note and `known_issues.md` are both stale.
- **D9** Staging is INACTIVE/paused → 10b's RLS verification cannot be rehearsed
  anywhere but prod.

### E · Runtime & scale
- **E1 HIGH** `listUnits` will **silently truncate at 1000 rows** — `src/lib/fetchAll.js`
  documents this exact prior bug; the plan mentions no pagination on a 2050-row dataset.
  Verbatim repeat of the 9.7 bug. → `fetchAllRows()` with an `.order()` tiebreak.
- **E2 HIGH [R2± mechanism corrected — fixes unchanged]** `bulkUpdateCells` per-cell loop
  → ghost success + double-write, but NOT via a "~8 s browser timeout" (none exists —
  Chrome's fetch default is ~300 s; `callEdge` confirmed to have no AbortController/timeout).
  Real paths: (a) user navigates/closes tab mid-call — fetch aborts, EF keeps writing;
  (b) EF hits the 150 s wall / 2 s CPU limit mid-loop — partial write + 546; (c) impatient
  user re-clicks a 16 s spinner. → group by chassis, cap 500/call, extend
  `client_request_id` idempotency (all still required).
- **E3 HIGH** `exportUnits` hits the Edge Function **2 s CPU limit** (256 MB / 2 s CPU /
  150 s wall). 2000×88 = 176,000 cells ≈ 0.6–1.8 s pure CPU before parsing a 6 MB
  payload; 5000 rows exceeds it → `546 WORKER_LIMIT`. → **delete `exportUnits`**, export
  client-side as `Catalog.jsx:2407-2414` already does.
- **E4 HIGH [R2✓ + new aggravator]** Bulk import trips the Realtime limit (**100 msg/s**
  free; documented behaviour is *"disconnect connections and log errors"* — confirmed
  current). A 2000-row import emits 2000 events **per client** — 5 users = 10,000 msgs =
  **100 s of saturation**. Aggravator from current docs: postgres_changes runs **one RLS
  authorization check per subscriber per change, single-threaded** — the import also costs
  10,000 serialized RLS evaluations. → `import_in_progress` flag; one "reload" broadcast
  on completion (Broadcast, not postgres_changes, is also what Supabase recommends at scale).
- **E5 HIGH** Silent data loss in the save path: navigating away inside the 500 ms
  debounce loses edits; a network drop leaves the optimistic value on screen until a
  refetch reverts it; 200 conflicts = 200 toasts. **Most likely cause of "they reopened
  Excel".** → localStorage pending-write queue, dirty-cell styling, aggregated banner.
- **E6 MEDIUM** Realtime is **net-new** — `git grep "postgres_changes"` returns zero
  hits. No pattern, no reconnect handling, yet folded into 10d's estimate.
- **E7 MEDIUM** Heap, not wire, is the payload problem: ~3 KB/row JSON → 5.8 MB for 2000
  rows (fine gzipped) but 6–10 KB/row in V8 with 88 props × source + optimistic snapshot
  → **40–90 MB at 2000 rows, 100–220 MB at 5000**. Desktop copes; iPad doesn't.
  → `list` returns only the active view's ~25 columns.
- **E8 MEDIUM** `tracker_audit` growth: correct design ≈ 240 B/row → ~41k rows/month ≈
  **118 MB/yr** vs a 500 MB shared free tier (~2.5–3 yr). But the common
  `to_jsonb(OLD), to_jsonb(NEW)` trigger stores 6 KB/write → **246 MB/month → dead in
  ~2 months.** Never store row jsonb.
- **E9 MEDIUM** `rateLimit` defaults **60 req/60 s** — a 200-row paste trips it instantly;
  raising it also raises the exfiltration ceiling. It **fails open** on RPC error.
- **E10 LOW** The grid itself is the least risky part (~300 cells in DOM regardless of
  row count). Two traps: a *function* `rowHeight` processes all rows upfront; an
  unmemoized 88-entry `columns` array re-renders on every keystroke. Bundle cost is a
  non-issue (`App.jsx` lazy-loads every heavy route).
- **E11 LOW [R2± half-wrong]** `Catalog.jsx` **does** have a mobile-card pattern
  (`vc-mobile-cards` at :375/:1617/:3146 — round 1 grepped the wrong class names), and
  `Employees.jsx:690` (`.only-mobile .mobile-cards`) is confirmed. **Two** reusable
  precedents.

### F · Adoption — the failure mode that decides success
- **F1 BLOCKER** **No way to create a single new row.** All planned operations are
  bulk/import-shaped. "One truck arrives" is the most frequent action in the building
  (~30 keystrokes in Excel). The fastest path into the portal becomes *type it in Excel
  first, then paste* — **cementing Excel rather than replacing it.** → quick-entry form,
  "repeat last gatepass × N", append-rows-on-paste.
- **F2 BLOCKER** **No undo anywhere; imports cannot be reverted.** A misaligned 200-row
  paste, or a bad mapping noticed at row 900, is unrecoverable except from backup. **One
  bad import in week two and the team never trusts it again.** The audit data to undo
  already exists. → Ctrl+Z (replays audit inverse) + "Revert import batch".
- **F3 BLOCKER** **No ad-hoc/scratch columns.** They keep informal notes in spare columns
  daily ("held for finance", "call Ramesh"). With nowhere to put a thought they open a
  side Excel — **and once a side Excel exists, it grows.** → free `notes` long-text +
  5 admin-labelled `user_field_1..5`.
- **F4 BLOCKER** **The pivot gap makes the value proposition circular.** All reporting
  deferred to "export and pivot in Excel" = **a step added, not removed** — and the
  export becomes a second editable copy that gets corrected and WhatsApp'd, re-creating
  the fragmentation Phase 10 exists to kill. Managers who consume pivots may have no
  access at all. → 3 server-side summary tables + grid group-by; export all-columns.
- **F5 HIGH** No global search — the #1 daily action is "find this chassis" by last 6
  digits off a gatepass.
- **F6 HIGH** No colour coding / conditional formatting — their informal status system
  *is* colour and carries operational meaning.
- **F7 HIGH** No cell comments *(now promoted to required — see §3/N4)*.
- **F8 HIGH** No settlement print output. The owner showed a real RTGS instruction
  document; without a PDF they rebuild it in Word every time. `pdfGenerator` already
  exists — **cheapest, highest-leverage adoption hook in the phase.**
- **F9 HIGH** A Cleared settlement has no correction path (bounced RTGS, wrong IFSC,
  14-of-15 chassis). → "Void + reissue with reason", never edit-in-place.
- **F10 HIGH** Bulk column update has no gesture. Excel: filter → select → type →
  Ctrl+Enter. Plan offers only paste and Ctrl+D. Does Ctrl+D respect the active filter?
- **F11 HIGH** A toast is not enough for a lost edit; no presence indicator, so you
  can't tell anyone else is in the sheet.
- **F12 HIGH** Rows vanish under the cursor when a live filter re-evaluates on edit.
  Excel doesn't do this. → sticky filters until explicitly re-applied.
- **F13 HIGH** Cutover has no dual-run, no reconciliation, no rollback — finance will
  not accept a 1% spot-check. → full-column automated diff + a hard "Excel goes
  read-only on DD/MM" date.
- **F14 MEDIUM** No "All columns" escape hatch; freeze unspecified (pin `chassis_no` +
  `model` + `customer_name`); a 20-field sale entry as horizontal scrolling (→ row-detail
  drawer, where the portal can *beat* Excel); chassis-typo correction undefined (it's the
  PK); import wizard first-run mapping of 40 columns; one date-format per file; no
  rejected-rows download; monthly re-import silently overwriting hand-corrections; no
  find-and-replace; no offline queue; no payee master (bank+IFSC retyped per batch).
- **F15 LOW** Mobile read-only is fine for desks, wrong for delivery — `delivery_date`,
  `delivery_status`, `pdi_outcome`, `rto_registration_no` are recorded next to the
  vehicle. → phone-only "search chassis → update 4 fields".

### G · Settlement logic
- **G1** The sign constraint blocks ~30% of real customers. Multi-chassis customers with
  **mixed-sign** net_refund: **12/44 (27%)** in PTB RETAIL, **92/310 (30%)** in FY (e.g.
  `RAMAN ROADWAYS` = −28L, +31L, +16L, −28L). Constraints as written make netting one
  customer **impossible**. → allow mixed-sign batches with a signed total.
- **G2** 40 rows have sub-rupee net_refund (₹0.237) that sign-based eligibility calls a
  refund. → ±₹1 dead-band.
- **G3** 71/310 AL Balance Sheet rows have **no chassis at all** (`INDENT - AXIS`×11,
  `PRICE SUPPORT`) — nothing to fold onto.
- **G4** Gating settlement eligibility on "financially closed" is **mandatory, not
  optional** — `net_refund` flips sign as data trickles in.
- **G5** Real refund statuses in the wild are `PENDING / TO COLLECT / NA / na /
  REFUNDED`, not Pending/Cleared. `delivery_location` contains `DELIVERED`×22 (dirty).
- **G6** Settlement SEQ must be generated in a DB transaction (concurrent collision).

### H · Round-2 new findings (2026-08-11 — full evidence in `docs/backlog/phase10-review-round2.md`)
- **R2-3 MEDIUM — rebills are already in the data; §7 Q1 is not hypothetical.** FY has 2
  dup-chassis groups with different customers, and the `canc rebill` sheet has 87 rows. A
  plain-overwrite unique-chassis model **erases a real sale on day one of migration**. →
  superseded-rows mechanism ships in 10b, not later.
- **R2-6 HIGH — react-data-grid needs React 19.2; portal is React 18.** Pin
  `7.0.0-beta.48` (last React-18 version) or reopen the React 19 upgrade. Merged into
  decision 1; owner decision in §7 Q5. 0.5 d spike before 10d.
- **R2-7 MEDIUM — `canAccess` is exact-pathname match** (`ProtectedRoute.jsx:67`;
  `rule.route === route`). `/tracker/:id`-style sub-routes bounce non-admins to `/`. No
  param-route precedent exists in the portal. → keep everything under the single `/tracker`
  path (drawer via query params/state), or teach `canAccess` prefix matching in 10h.
- **R2-8 MEDIUM — app_metadata flag staleness.** Grant/revoke lands only on token refresh
  (~1 h). → `setTrackerAccess` also revokes sessions (`admin_revoke_user_sessions`, exists
  since PR #87); EF gate uses fresh `getUser()`. Merged into decision 14.
- **R2-24 HIGH — the six-workbook scope misses live money.** `INVOICE LIST` `Sheet5` (an
  informal side-sheet) tracks **₹3,42,60,755 of pending payments**, and **10 of its chassis
  exist in NO main sheet** (pos-10 'R' = 2024 = prior-FY sales still being collected). →
  add a prior-FY open-items import + a stray-sheet sweep to 10a's scope; strongest
  real-world proof of F3.
- **R2-25 HIGH — B2's own fix has a landmine.** Skipping the recompute trigger on
  `source_file IS NOT NULL` means migrated rows **never recompute after post-migration
  edits** — correcting `ctc` on an imported row silently keeps stale retention/total. →
  key the skip on an explicit importer-set flag (e.g. `import_mode` session setting or a
  `recompute` boolean the importer alone clears), so ordinary edits always recompute.
- **R2-27 MEDIUM — inter-dealer transfers overlap THREE files** (FY Sheet1 embedded
  dealer rows · INVOICE LIST `DEALERS` · IT `OTHER DEALER`). The conflict report must
  reconcile that trio or transfers import twice/zero. Merged into decision 16.
- **R2-15 (schema note)** — exact receivable chain extracted (see §4); `finance_paymt_rec`
  is a **date**, not money.
- **R2-9 LOW (ops)** — there are now **10** EFs (`erp-login` exists); CLAUDE.md says 9.
  Update the roster when `admin-vehicle-units` lands, and deploy ALL on any key change.
- **Good news found on the way:** resetPassword failure path is now audited
  (`admin-users/index.ts:723-732`) + tier-guarded — the known_issues remnant is stale;
  `security_audit_log` precedent exists but must NOT be copied for tracker_audit (PII +
  growth); comments/variance are small reviewable artifacts (§3 refinement).

---

## 6. Build order — ⚠️ SUPERSEDED 2026-08-11

> **The live build order is in [`phase10-execution-plan.md`](phase10-execution-plan.md) §2.5.**
> The owner reversed the sequencing to **pilot-first**: build the capability → back-office
> trials it on a real sandbox → collect feedback → *then* produce the conflict report and clean
> the data → then migrate. Access control also moved from last to first, because the sandbox
> holds real cost and margin figures. Total ≈8–9 weeks, first hands-on version ~week 4.
>
> The table below is the **per-step effort estimate** that fed those stages and is kept for
> that purpose. **Ignore its ordering (10a → 10h); it is no longer the sequence.**

| Step | What | Orig | Reality |
|---|---|---|---|
| 10-pre | **NEW (R2)** — react-data-grid spike on React 18 (beta.48: paste/fill/frozen) | — | **0.5 d** |
| 10a | Column sign-off + conflict report to back-office (scope: + 3-file dealer overlap, stray-sheet sweep, prior-FY open items, comment census, status-vocab map) | 0.5 d | **+2 d** |
| 10b | DB migration: tables, triggers (not generated cols), RLS, audit, grants | 1.5 d | **+2 d** |
| 10c | EF `admin-vehicle-units` — `EDITABLE_FIELDS`, per-row batching, pagination, no `exportUnits` | 1.5 d | **+1 d** |
| 10d | Grid `/tracker` — RDG, keyboard, paste, dropdowns, views, realtime, search | 4–6 d | **+3–4 d** |
| ~~10d2~~ | ~~HyperFormula formula bar~~ | ~~5–7 d~~ | **CUT** |
| **10d3** | **NEW — adoption essentials** (F1–F3, F6, F7) | — | **+4–5 d** |
| 10e | Import wizard + comment extraction + conflict review | 2 d | **+2 d** |
| 10f | Client-side export, views, summary tables, settlement RTGS PDF | 2 d | **+2 d** |
| 10g | Migration of 6 files (gated on clean data) + full recompute-diff + **(R2) prior-FY open items + DEALERS column re-map** | 1.5 d | **+2.5 d** |
| 10h | Access control via `app_metadata` + `canAccess` per-user branch | 0.5 d | **+2–3 d** |

**[R2±] ~7–8 weeks realistic** (the table's own numbers sum to 34.5–39.5 d ≈ 7–8 wk at
5 d/wk; "~6–7 weeks" was the optimistic edge even before the round-2 additions). Growth
is almost entirely un-optional: security enforcement, schema legality, and the four
adoption blockers that decide whether anyone uses it.

---

## 7. Open questions still to resolve

1. **Re-sale overwrite — [R2: answered by the data, needs owner ratification only].**
   Rebills already exist (2 dup-customer chassis in FY + the 87-row `canc rebill` sheet);
   plain overwrite would erase a real sale during migration itself. Recommendation:
   superseded-rows day one (`UNIQUE(chassis_no) WHERE superseded_at IS NULL`), a rebill
   creates a new row. Owner: confirm.
2. Should incentive columns sit behind a second permission flag (D7)? (R2 adds weight:
   the sheet itself hand-hides incentives for the house account — R2-19.)
3. Should export be separately permissioned from read (D5)?
4. What is the hard cutover date for "Excel goes read-only" (F13)?
5. **NEW (R2-6):** pin `react-data-grid@7.0.0-beta.48` on React 18, or take the React 19
   upgrade (which also unlocks the clean react-router version)? Decide before 10d.
6. **NEW (R2-26):** are collections (`TO COLLECT` — customer owes us) also settlements in
   the `customer_settlements` model, or a separate flow? Decision 12's Pending/Cleared enum
   assumes yes — confirm with back-office in 10a.

## 8. Next action

~~A second independent design review is queued.~~ **Done — round 2 landed 2026-08-11 and
is merged into this file** (evidence + scripts: repo `docs/backlog/phase10-review-round2.md`).
Order of work now:
1. Owner resolves §7 (Q1 ratify, Q2–Q6).
2. 0.5 d react-data-grid spike on React 18 (decision 1 / Q5).
3. Start 10a with the widened conflict-report scope (decision 16).
Copy this file into the repo (`docs/backlog/phase10-vehicle-tracker.md`) per the header
note when planning closes.
