# Phase 10 Vehicle Tracker — Design Review, Round 2

> Independent re-review of the Phase 10 design (2026-08-11). Round-1 findings were treated
> as claims to verify, not settled conclusions. Read-only review — no code or data modified.
>
> **This is the evidence file.** The plan it reviews is now
> [`phase10-vehicle-tracker.md`](phase10-vehicle-tracker.md) (design reference) and
> [`phase10-execution-plan.md`](phase10-execution-plan.md) (⭐ the approved plan); the
> scripts behind every number are in [`scripts/phase10/`](../../scripts/phase10/).
> All findings below are merged into those two documents — this file is kept so the
> arithmetic can be audited, not as a to-do list.

## RUN STATE

**Plan of attack:**
1. [x] Environment setup — confirm SheetJS available for Node scripting (worktree may lack node_modules; use main checkout's)
2. [x] Workbook re-derivation (Node + SheetJS, `cellFormula`/`cellComments` on):
   - [x] Row counts per sheet vs plan §1 table
   - [x] A1: duplicate chassis (exact + whitespace-collision counts)
   - [x] A2: cross-file conflict rates (CTC 26.5%, CTD 22.2%, customer 30.1%)
   - [x] A3: 2025-26.xlsx two-layout claim (186 non-dates; col shift at r1443)
   - [x] A4: DEALERS sheet engine-number claim
   - [x] §4 formula claims: retention/diff_tds/total/tcs/gross match rates; qty; three retentions (50.4%/81.9%)
   - [x] §3 CTC basis variance: formula-variance scan + cell-comment census (how many comments actually exist? where?)
   - [x] G1: mixed-sign customers 12/44, 92/310; G2 sub-rupee; G3 71/310 no-chassis
   - [x] VIN decode claim (4406/4406) — spot-verify decode logic
   - [x] Text-in-money-columns claims (99.4% etc.)
3. [x] Codebase verification via `git show origin/portal:<path>`:
   - [x] C2 canAccess() shape; C4 admin-users whitelist :506-515; C5 replaceJoin wipe; C6 current_user_role(); C7 zero `(select f())` wrappings
   - [x] D1 auditLog.ts:19-24 + log-error:76-78; D2 service_job_events RLS; D8 admin-catalog fix :326-330
   - [x] E1 fetchAll.js; E3 Catalog.jsx:2407 client export; E9 rateLimit 60/60 fail-open; E11 Employees.jsx:690 mobile cards
   - [x] callEdge signature/timeout/AbortController claim (E2)
4. [x] Platform limits: EF 2s CPU/256MB/150s; Realtime 100 msg/s free + disconnect behaviour; react-data-grid feature claims; PG generated-column rules (B1/B2)
5. [x] Fresh ground nobody examined: schema width (88 cols) practicality, RLS + app_metadata interplay, settlement ID format, views design, import template drift, multi-session concurrency, anything in the real data the plan missed
6. [x] Final synthesis: verdict on core premises, corrected estimates

**Status: COMPLETE (2026-08-11).** All planned checks done; findings R2-1..R2-28 + scorecard + verdict below.
**Method:** workbook claims re-derived with Node + SheetJS 0.20.3 (`cellFormula`/`cellComments`; scripts in session scratchpad: inventory.js, a_claims.js, b_it_formulas.js, c_sale_g.js, d_followup.js); codebase claims verified against `git show origin/portal:` @ `85c2c90` (subagent, quotes re-checked); platform limits verified against current official docs (subagent with URLs).
**Not verified (explicitly):** E7 heap numbers (no browser measurement — order-of-magnitude only); react-data-grid behaviour on React 18 (needs a spike — see R2-6); the AL 30-yr VIN chart itself (validated empirically instead — R2-20); round-1's `gross_al=(ctd+amc)×qty` formula (no "gross" column exists in any of the six files — could not locate); E2/E3 EF timing figures (limits confirmed, timings not measured).
**Dead ends worth not repeating:** round-1's "81.9%" retention agreement doesn't reproduce under any pairing of the three files (best: 97.4% INT-vs-AL-computed-diff, 49.6% INT-vs-IT, 20.9% AL-claim-vs-IT); the "143 STOCK rows" and "4 whitespace-colliding chassis" also don't reproduce — don't chase them, the underlying risks are covered by R2-1/R2-2.

---

## Findings

Legend: **Verdict** = what this does to the round-1 claim (CONFIRMS / CORRECTS / OVERTURNS / NEW). All workbook numbers below re-derived empirically with SheetJS 0.20.3 (`cellFormula:true`), scripts run 2026-08-11.

### R2-C · Codebase claims — verified against `origin/portal` @ `85c2c90`
All verified by a subagent reading `git show origin/portal:<path>`; quotes and exact lines re-checked. Verdicts on the round-1 register:
- **C2 CONFIRMED** — `canAccess()` (`src/context/AuthContext.jsx:391-397` + `ruleMatches` :28-36) matches only permission_level × entity × department × designation. No per-user mechanism. 10h genuinely needs a new branch.
- **C4 CONFIRMED** (drifted 1 line: `admin-users/index.ts:507-516`) — unknown scalar keys silently dropped; only errors if *nothing* valid remains (`:549-551`).
- **C5 STALE — CORRECTED.** `replaceJoin` (`:150-168`) is still delete-then-insert, but post-#89/#93 the frontend never sends a bare `[]` for applicable slots (`Employees.jsx:415-417`, `userShape.js:141-149`) and the server shape-gate 400s an explicit `[]` for required slots before `replaceJoin` runs. The round-1 instruction "dedicated `setTrackerAccess` action" is still right, but for a different reason (blast-radius minimisation), not because the wipe bug is live. **Moot anyway under decision 14 (app_metadata, not users table).**
- **C6 CONFIRMED** — `current_user_role()` (`schema-current.sql:971-984`) returns `'admin'` | dept code | **NULL** (inactive/no-dept — round 1 omitted the NULL branches; they matter for `if not guard()` logic, the exact ERP 13e trap).
- **C7 CONFIRMED and quantified** — **0** `(select f())` wrappings anywhere; 116 CREATE POLICY in the canonical dump, **80 call `current_user_role()` bare** (+134 bare occurrences across 24 migrations). The 4598ms-vs-73ms ERP regression pattern is fully latent here. On a 2050-row table with per-row RLS re-evaluation this is the difference between a snappy grid load and a multi-second one.
- **D1 CONFIRMED** — `_shared/auditLog.ts:18-24` writes before/after jsonb verbatim; `log-error/index.ts:73-85` inserts arbitrary client context unfiltered (length-truncated only).
- **D2 OVERSTATED — CORRECTED.** `service_job_events_select` (schema:8316) is NOT blanket authenticated SELECT — it's admin OR same-entity + (service/accounts dept OR manager+), plus a restrictive `is_active_user()` policy. The precedent is better than claimed; D2's fix (admin-only SELECT on `tracker_audit`) still right, but the "nearest precedent leaks" framing is wrong.
- **D8 CONFIRMED** — `admin-catalog/index.ts:326-330` + `:349-352` whitelists exist (VAPT M-1 fixed; the plan's stale-docs note is itself confirmed).
- **E1 CONFIRMED** — `fetchAll.js` documents the exact 1000-row trap; `fetchAllRows` exists and throws on page error.
- **E3 nuance** — `Catalog.jsx:2407-2414` is client-side XLSX (template download; import parse also client-side at :2256). Precedent for client-side export confirmed.
- **E9 CONFIRMED** — `rateLimit.ts` defaults 60/60s, documented deliberate fail-open (`:38-51`); some callers override (10/hr, 120/min).
- **E11 HALF-WRONG — CORRECTED.** `Catalog.jsx` **does** have a mobile-card pattern (`vc-mobile-cards` at :375, :1617, :3146); round 1 grepped for the wrong class names. `Employees.jsx:690` also confirmed. Two reusable precedents, not one.
- **E2 support CONFIRMED** — `callEdge(fn, action, payload)` (`src/lib/api.js:29`) has no AbortController/timeout; a hung fetch hangs the caller.
- **known_issues stale, good news** — the resetPassword failure path IS now audited (`admin-users/index.ts:723-732`) and tier-guarded (:689-707); the plan/memory note citing `:499/:503` is obsolete.

### R2-7 · NEW — `/tracker/:id`-style routes will bounce: `canAccess` is exact-pathname match
**Severity: MEDIUM (design constraint to bake in, cheap now, expensive later).**
`ProtectedRoute.jsx:67` gates on `canAccess(pathname)` with exact `rule.route === route` equality. Every existing gated page is a flat single path; there is no param-route precedent in the portal. A row-detail drawer via `/tracker/:chassis` (the plan's F14 suggestion) or a settlement page `/tracker/settlements/:id` would redirect to `/` for non-admins unless each concrete path gets a rule. Fix: keep everything under the single `/tracker` path (drawer state via query params or client state), or teach `canAccess` prefix matching in 10h — decide up front.

### R2-8 · NEW — access-flag staleness: `app_metadata` grant/revoke only lands on token refresh
**Severity: MEDIUM.**
Decision 14 is sound (confirmed: client-readable in JWT, service-role-only writable, `AuthContext.jsx` ~:411 already reads `must_change_password` this way). But the JWT is a snapshot: granting a clerk tracker access does nothing until their next token refresh (up to ~1 h) or re-login, and **revoking** leaves them reading cost/margin data until the same. PR #94's own solution exists in-repo: call `admin_revoke_user_sessions` on flag change. Bake "write flag ⇒ revoke sessions" into the `setTrackerAccess` action from day one; also note the EF-side check must use a fresh `getUser()` (as `erp-sso/index.ts:83` does), not the JWT claim, if instant revocation matters.

### R2-9 · NEW — docs drift: there are now 10 Edge Functions, not 9
**Severity: LOW (operational).** An `erp-login` EF exists alongside the documented nine (CLAUDE.md still says "all 9"). The key-cutover lesson (deploy fewer than all → break the missed one) applies to Phase 10's new EF too: the roster in CLAUDE.md should be updated when `admin-vehicle-units` becomes the 11th.

### R2-P · Platform-limit claims — ALL CONFIRMED against current official docs (checked 2026-08-11)
Verified by doc lookup (URLs in each item):
- **EF limits**: 256 MB / 2 s CPU (per request, excl. async I/O) / 150 s wall (free) — confirmed; breach = HTTP **546** (now titled "WORKER_RESOURCE_LIMIT Exceeded"). E3's arithmetic stands. [supabase.com/docs/guides/functions/limits]
- **Realtime free tier**: 100 msg/s, 200 concurrent connections; breach behaviour is documented as disconnect + log, client auto-reconnects when below limit — E4 confirmed. **NEW aggravator:** docs state postgres_changes runs **one authorization (RLS) check per subscriber per change, single-threaded** — a 2000-row import with 5 subscribers = 10,000 RLS evaluations serialized, on top of the message quota. [supabase.com/docs/guides/realtime/limits, /realtime/postgres-changes]
- **Free DB**: 500 MB — confirmed (per-project). E8's ceiling stands. [supabase.com/pricing]
- **PG17 generated columns**: all four B1/B2 legality claims confirmed verbatim from PG docs (no INSERT into GENERATED ALWAYS STORED; no generated-referencing-generated; immutable-only expressions — `current_date` is stable, so illegal; **no VIRTUAL in PG17** — that lands in PG18). B1/B2 CONFIRMED. [postgresql.org/docs/17/ddl-generated-columns.html]
- **`app_metadata`**: confirmed present in the access-token JWT (client-readable for menu gating) and writable only via service-role admin API — decision 14's design is sound. **Caveat: the JWT is a snapshot — a granted/revoked flag takes effect client-side only on token refresh, and server-side EF checks that trust the JWT claim share that staleness. Revocation should also revoke sessions (the `admin_revoke_user_sessions` RPC from PR #87 already exists for this).** [supabase.com/docs/guides/auth/jwt-fields]
- **PostgREST 1000-row default cap**: confirmed — E1 stands. 

### R2-6 · Decision 1 (react-data-grid) — NEW: current version requires React 19; portal is React 18
**Severity: HIGH (build-blocking surprise if discovered mid-10d).**
npm registry (checked 2026-08-11): latest `react-data-grid` is **7.0.0-beta.61** with peerDeps `react: ^19.2`. React 18 support was dropped at beta.50; **the last React-18-compatible version is 7.0.0-beta.48**. The portal is React 18 (upgrade to 19 was explicitly rejected in the react-router WONTFIX decision — the clean router version needs React 19).
- Consequence: Phase 10 must pin `react-data-grid@7.0.0-beta.48` and forgoes ~13 betas of fixes, OR reopens the React 19 upgrade question (which also unlocks the router upgrade). Either is workable; deciding mid-build is not.
- Also verified: virtualization on both axes and paste/fill/sort/frozen columns are real, **but paste/fill are event hooks (`onCellPaste`, `onFill`) — the consumer writes the row-update logic**, so "ships paste" ≠ zero effort; 10d's estimate should assume writing the clipboard-parsing + fill reducers.
- Fix: pin beta.48 in 10a's column sign-off step; smoke-test paste/fill/frozen-cols on React 18 in a spike before committing to 10d's estimate.

### R2-10 · §3/§4 retention + diff formulas — CONFIRMS round-1's corrections to the digit
Re-derived on all 2050 INVOICE TRACKER rows (value comparison, ±₹0.5 tolerance):
| Formula | Match | Round-1 claim | Verdict |
|---|---|---|---|
| `retention = ctc − ctd` (original plan) | 1420/2050 = **69.3%** | 69.3% | CONFIRMED exactly |
| `retention = IF(ctc=0,0, ctc−ctd−amc−dsa−adblue)` | **2050/2050 = 100.0%** | 100% | CONFIRMED |
| `diff_tds = diff_base × 0.1%` (original plan) | 380/2050 = **18.5%** | 18.0% | CONFIRMED (≈) |
| `diff_tds = diff_amount × 0.1%` | **2050/2050** | corrected formula | CONFIRMED |
| `tds = payment × 0.1%` · `total_payment_to_al = payment − tds` | 2050/2050 both | verified-correct list | CONFIRMED |
Context for the 100%: 530/2050 rows (25.9%) have ≥1 of AMC/DSA/ADBLUE populated (= would derive `ctc_basis=exclusive` under N1); 101 rows have ctc=0. §3's warning that the 100% "works because blanks sum to zero" is structurally right — but see R2-11 for the part of §3 that is overstated.
`AGEING`/`INTEREST` formulas use `TODAY()` (`IF(ISBLANK(W2),0,IF(ISBLANK(X2),TODAY()-W2,X2-W2))`; interest = ageing × total_payment × 10%/365 **clamped at 0 when negative**) — confirms B2 (cannot be stored/generated; compute at render) and adds the negative-clamp detail the plan's interest formula must reproduce.

### R2-11 · §3 "manipulated formulae" — CORRECTS the location of the danger (and shrinks N3's scope)
**Severity: reframing — good news, narrows work.**
The full per-column formula-variance scan (normalize by stripping row digits, group patterns) across all 24,856 formula cells in INVOICE TRACKER:
- **Every derived money column (Retention, TDS, Total-Payment, Diff-*, Ageing, Interest) has exactly ONE normalized pattern — zero hand-edited formula deviants.**
- The hand-manipulation lives entirely in **input** columns: `AD BLUE` (233 formula cells, 21 patterns — inline arithmetic like `1310*8` = price × buckets) and `CTD` (22 cells, 10 patterns like `2055000/1.28*1.18` — back-computing ex-GST). Total deviant-from-dominant cells: **221**, all inputs.
- Consequence: the plan's fear that "any per-column migration formula is silently wrong for those rows" does NOT apply to the derived columns — importing input **values** (not formulas) and recomputing derived columns in the portal reproduces the sheet 100.0%. What must be preserved from the input-cell formulas is the *provenance* (`1310*8` tells you 8 buckets at ₹1310) — which pairs with the comments (below).
- N3 stays, but scoped: scan input columns; expect ~221 flags in IT, not thousands.

### R2-12 · N2 comment extraction — CONFIRMS need; NEW: census + they're richer than "reasons"
Empirical comment census across all six workbooks: **124 total** — INVOICE TRACKER 95 (cols M:AMC=7, N:DSA=13, O:ADBLUE=58, P:CTC=17), OTHER DEALER 15, FY Sheet1 14. Zero in the retention trackers, AL balance sheet, and INVOICE LIST.
- All 95 IT comments sit on the four **input** columns that drive `ctc_basis` — confirming N1+N2's coupling.
- They carry structured business content, not just prose: author prefixes (`DELL:`, `BAPS:`), in-kind deals (`1st & 2nd service free`, `10000 SERVICE & 2 BUCKET URIYA`), and **quantity-slab pricing** (`CTC 17.50 IF 25 QTY CTC 17.75 IF 15 QTY` ×17 cells) — i.e. per-deal price ladders that exist nowhere else in any system.
- NEW: at 124 comments this is a *small, reviewable* migration artifact — round 1 implied an unbounded extraction problem; it's actually one owner-review page. Suggested fix: extract to portal cell-notes verbatim + include the full list in the 10a conflict report so the back-office confirms meanings pre-migration.

### R2-13 · §4 qty column — CORRECTS the urgency
Empirical: `Qty` is non-null on all 2050 IT rows and **equals 1 on 2050/2050**. (Round 1: "all samples are Qty=1" — confirmed, now exhaustively.) The comment evidence (`CTC 17.50 IF 25 QTY`) shows bulk deals are recorded as **one row per chassis anyway** — the fleet deal's quantity lives in the price ladder, not a qty cell. Keep the column (cheap), but it is not a live wrongness risk in this dataset; the multiply-by-qty formulas round 1 found are in the inter-dealer/AL-claim lens (verified next).

### R2-14 · §4 TCS formula — **OVERTURNS round-1's correction (it inverted the truth)**
**Severity: HIGH — a money formula in the corrected-formulas table is wrong.**
Round 1 claimed the fix was `tcs = ctc × 1%` (replacing the "wrong" `tally_bill × 1%`). Empirically (±₹1):
| Basis | PTB RETAIL | FY Sheet1 |
|---|---|---|
| `tcs = tally_bill × 1%` (the ORIGINAL plan formula) | **266/266 = 100.0%** | 1973/2086 = **94.6%** |
| `tcs = ctc × 1%` (round-1's "correction") | 175/266 = 65.8% | 1235/2086 = 59.2% |
The two agree only where `tally_bill == ctc` (the 65.8% overlap — the same uniformity trap the owner warned about). TCS is tax collected at source on the **customer bill** (tally bill), which is also the legally sensible basis. The FY residual 5.4% needs eyeballing but the basis is unambiguous.
- Also empirical: `TOTAL = ctc + tcs` **is** right (266/266 and 2104/2104 = 100% both sheets) — so round 1's *total* correction stands while its *tcs* correction is inverted. The actual sheet formula is `T2=Q2+S2` (CTC+TCS) with `S2` (TCS) computed off tally.
- Fix: `tcs = tally_bill × 1%`; `total = ctc + tcs`. Re-run the recompute-diff after fixing.

### R2-15 · §4 receivable/refund chain — NEW: exact formulas extracted (round 1 never printed them)
From PTB RETAIL cells (uniform patterns): `TOTAL_RECD = margin_money + finance_recd + subvention` (`Y2=U2+V2+X2`); `TOTAL_RECEIVABLE = total + insurance + cretem + full_tax` (`AC2=T2+Z2+AA2+AB2`); `NET_REFUND = total_recd − total_receivable` (`AD2=Y2-AC2`). These match round-1's "verified correct" list; recorded here so 10b's trigger implements the actual chain. Note `finance_paymt_rec` (W) is a **date**, not money — the schema must not sum it.

### R2-16 · §4 CRETEM — CONFIRMS raw-entry
PTB RETAIL: 11 distinct values, top `1500×93` (=35.0% ≈ round-1's 35.8%), `7000×86, 6600×29, 9000×24` — round-1's exact triple reproduced. FY: **33 distinct values**. Raw-entry column confirmed; no formula exists (values only).

### R2-17 · §4 text-in-money columns — CONFIRMS, with two corrections
| Column | Round 1 | Empirical | Verdict |
|---|---|---|---|
| `amc_charged_to_customer` | 99.4% text | FY: 323/325 = 99.4% ✓; PTB RETAIL: 26/26 = 100% | CONFIRMED (the 99.4% is the FY sheet) |
| `parts_pkg_cashback` | 58/58 text | IT "Parts Pkg": 58/58 = 100% | CONFIRMED |
| `endhan_amount_given` | 114/114 text | PTB RETAIL: 114/114 ✓; **FY: 832/916 = 90.8% — 84 numeric rows exist** | PARTIALLY-CORRECTED |
| `ad_blue_buckets_given` | text like `20-BUCKET` | PTB RETAIL 37/80 = 46.3% text; FY 502/854 = 58.8% — **majority-numeric, and text values include `5K-DSA`/`35K-DSA` — DSA data recorded in the AD-BLU column** | CORRECTED |
NEW consequence: the text+parsed-`*_amount` design must not assume the column name implies the deal category — the AD-BLU column demonstrably carries DSA and URIYA entries. Parse `{amount, kind}` and let kind differ from the column.

### R2-18 · §4 three retentions — CONFIRMS the three-concepts conclusion; CORRECTS the mechanics and one number
Empirical joins on chassis (±₹1):
- `retention_internal` (RET-INT) vs `retention_dealer` (IT): 132/266 = **49.6%** agree — round-1's 50.4% CONFIRMED (≈).
- RET-INT.Retention vs RET-AL's **computed diff** (`P2=M2-N2-O2` = ctc−ctd−other_ded): **258/265 = 97.4%** — same formula, both files; the 7 disagreements are cross-file data drift.
- RET-AL's "Retention" column (the claim to AL) is **not computed at all**: raw value, **265/265 rows a multiple of ₹500**, and `App Amt = claim − computed diff` holds **265/265** (`R2=Q2-P2`). Round-1's "81.9%" agreement figure did not reproduce against any pairing I built (best alternative pairings: 18.1%, 20.9%) — treat that number as unreliable.
- Consequence (sharpens the schema): `retention_al_claim` is a **negotiated input**, never derivable — it must be an editable money column with `app_amt` as the generated variance. Three columns confirmed; only one of them (internal) is computable.

### R2-19 · §4 DSE incentive slab — CONFIRMS formula; NEW: business overrides exist (28% of rows)
The slab formula exists verbatim in the sheet (`IF(COUNTIF($B:$B,$B2)<5,0,IF(<9,1200,IF(<13,1500,1800)))`). But values match the slab only **193/268 = 72.0%**: all 60 rows of DSE `SRS` (a house/institutional account spanning 5 segments) carry a **raw 0 pasted over the deleted formula**. So the incentive model is slab-as-default **plus per-DSE eligibility overrides**. A computed-only incentive column would silently pay the house account ₹1800×60. Fix: computed default + editable override + eligibility flag; show override state visibly.

### R2-20 · Decision 9 VIN decode — CONFIRMS pos-10; CORRECTS "decodes cleanly" for pos-12
Empirical on all **4406** chassis (IT 2050 + OTHER DEALER 251 + FY 2105 — matches round-1's 4406 denominator):
- Pos-10 (year): only 4 letters occur (`P×1, R×172, S×3173, T×1060`); cross-checked against IT's `Make` column: S→2025 (1410/1410), T→2026 (640/640) — **zero contradictions**. Solid.
- Pos-12 (month): **15 distinct letters — more than 12 months** — so a single 12-letter month table cannot be the whole story. Empirical letter→gatepass-month histogram is strongly concentrated for most letters (P→March 177/182 = 97%, M→April 108/137) and follows a descending-alphabet wrap (Jan=S, Feb=R, Mar=P, Apr=M, May=L, Jun=K, Jul=J, Aug=H, Sep=G, Oct=D, Nov=C, Dec=T) — but `N` is noisy (36/71 = 51%) and `B`(×35)/`E`(×1) never co-occur with a gatepass date in IT. "4406/4406 decode cleanly" is true for *pattern shape*, unproven for *month semantics*.
- Fix: make_month is informational — compute it, but add a migration validation that decoded month is within ~4 months before gatepass date and flag outliers for the chart to be corrected against AL's actual table; don't let anything financial depend on it.

### R2-21 · §4 qty — CORRECTS urgency: qty=1 on **all 4672 rows across all four transactional sheets**
IT 2050/2050, OTHER DEALER 251/251, PTB RETAIL 266/266, FY 2105/2105 — a full financial year contains zero Qty≠1 rows; fleet deals are recorded one-row-per-chassis with the quantity ladder living in CTC comments (R2-12). Keep the column (cheap insurance), but round-1's "silently wrong the first time Qty≠1" has an empirical frequency of 0/4672 per year. (Round-1's `gross_al=(ctd+amc)×qty` formula could not be located in any sheet — no "gross" column exists in the six files; COULD-NOT-VERIFY.)

### R2-22 · A5 spot-check probability — **OVERTURNS the arithmetic (right conclusion, wrong number)**
A5 claims a 20-chassis spot-check "would catch the 26.5% CTC conflict with ~0.4% probability". Actual: P(≥1 conflicted row in 20 draws) = 1 − 0.735²⁰ ≈ **99.8%** — a 20-row sample would almost *certainly* catch a 26.5%-frequency defect class. Where sampling genuinely fails is **rare** classes: for the 6 duplicate rows, P(catch) = 1 − (1−6/2050)²⁰ ≈ 5.7%; for a single bad row ≈ 1.0%. The recommendation (full recompute-and-diff) survives — because of rare classes and because a diff is nearly free — but the register's stated arithmetic is wrong.

### R2-23 · E2 ghost-success mechanism — CORRECTS: there is no "~8 s browser timeout"
Browsers do not abort fetch at 8 s (Chrome's default is ~300 s; Firefox ~90 s; `callEdge` confirmed to have no AbortController). A 16 s EF loop therefore does NOT get aborted by the browser — the user just stares at a spinner. The *real* ghost-success/double-write paths: (a) user navigates away or closes the tab mid-call (fetch aborted, EF continues), (b) EF hits the 150 s wall / 2 s CPU limit mid-loop (partial write, 546 returned), (c) impatient user re-clicks. Round-1's fixes (group-by-row batching, 500-row cap, `client_request_id` idempotency) are all still correct — for these reasons, not the stated one.

### R2-24 · NEW — the "6 workbooks" scope misses live money: ₹3.43 Cr of pending payments in an informal side-sheet
**Severity: HIGH (migration scope gap + the strongest F3 evidence in the data).**
`INVOICE LIST - MAR 26.xlsx` sheet `Sheet5` (which the plan classifies as derived/scratch) is a hand-built receivables tracker: 41 rows, 11 with `PAYMENT PENDING > 0` summing to **₹3,42,60,755**, and **10 of its chassis appear in NEITHER PTB RETAIL nor the full-year sheet** (serials `RAC…`/`RAS…` = pos-10 'R' = 2024 — prior-FY sales still being collected). Two consequences: (1) migrating only the six named workbooks' main sheets loses live receivables — cutover needs a "prior-FY open items" import; (2) this is F3 happening in the wild: when the main sheet didn't fit the need, a side-sheet grew — in the same file. Fix: add Sheet5 (and a sweep of the other stray sheets) to the 10a conflict-report scope; ask the back-office which stray sheets are live.

### R2-25 · NEW — B2's `skip trigger when source_file IS NOT NULL` creates permanently-stale derived columns
**Severity: HIGH (design landmine in the plan's own fix).**
The plan's B2 remedy: the BEFORE trigger recomputes derived columns "skipping when `source_file IS NOT NULL`" so migrated history imports as-is. But migrated rows will be **edited** after migration (that's the product); with the skip keyed on `source_file`, a user who corrects `ctc` on a migrated row gets **no recompute** — retention/total silently keep the old value, the exact class of wrongness the register fears. And clearing `source_file` on first edit destroys provenance and rewrites 88 columns' derivations at once. Fix: key the skip on an explicit transient flag (e.g. trigger checks a session/user-set `import_mode`, or a `recompute boolean` column defaulting true and set false only by the importer), so post-migration edits always recompute; record per-row `derived_stale` if any input changed while frozen.

### R2-26 · G5 status vocabulary — CONFIRMS and worsens
FY Refund Status has **11 distinct values**: `PENDING×742, REFUNDED×323, NA×144, TO COLLECT×82, TO␣␣COLLECT×13` (double space), `pending×5, na×3, P×2, to×1, n×1` (+blank). PTB RETAIL has 5. Import needs an explicit normalization map with an owner-reviewed unmapped-values report; after cutover the dropdown enforces the enum (Pending/Cleared/…) — decision 12's two-value enum also needs `TO COLLECT`-class semantics (money owed TO the dealer), which "Pending/Cleared on a settlement batch" does cover *if* collections are settlements too — confirm in 10a.

### R2-27 · NEW — FY `Sheet1` contains inter-dealer rows; three files overlap on the same transfers
The FY sheet's broken-layout rows (R2-4) include rows with dealer names (`ASL MOTORS`, `LM AHMEDABAD`) — i.e. the full-year sheet holds **inter-dealer transfers** as well as retail, overlapping INVOICE LIST's `DEALERS` sheet and INVOICE TRACKER's `OTHER DEALER` sheet. The conflict report (decision 16) currently frames conflicts as retail-file pairs; it must also reconcile the transfer population across these three, or transfers import twice (or zero) depending on file order.

### R2-28 · E7/E8 arithmetic — spot-checked
- E8 audit-growth arithmetic is internally consistent: 240 B × 41k rows/mo ≈ 9.8 MB/mo ≈ 118 MB/yr ✓; jsonb 6 KB × 41k ≈ 246 MB/mo ✓ (the 41k writes/mo input is an assumption, not measured — but the conclusion "never store row-pair jsonb" holds at any plausible volume, and D1 independently requires not storing full rows because bank PII would land in the audit table). Note the existing `security_audit_log` precedent stores before/after jsonb verbatim — the tracker audit must NOT copy that pattern (it would hit both E8 and D1).
- E7 heap numbers (40–90 MB @2000 rows) are plausible-but-unverified (no browser measurement was run; V8 per-property overhead varies). The fix (fetch only the active view's columns) is cheap and right regardless; treat the numbers as order-of-magnitude.

### R2-1 · A1 duplicate-chassis claim — CORRECTS (overstated in-file, understated cross-file risk)
**Severity: MEDIUM (down from BLOCKER as stated).**
Empirical: INVOICE TRACKER has 2050 non-blank chassis rows, 2049 unique after trim — **exactly ONE duplicate group** (`MB1XEVHD1SRHK1555`, rows 777+780, raw strings byte-identical). The claimed "4 chassis with trailing whitespace that collide only after trim" is **not reproducible in INVOICE TRACKER: zero** groups collide only after trim. FY `2025-26.xlsx` has 4 dup groups, 2 with different customers; the cited `MB1PEECDXSAJU4480` confirmed (r965 AMIT DAHYABHAI TALATI net_refund −19,83,430 vs r1639 NEPTON MANAGEMANT SERVICE +1,41,31,250).
- K1555 detail confirms the cited example: VPart `CTN482528B0016_YW` vs `…529B…` (one-digit difference — likely one row is a typo, not two vehicles), interest ₹18,680 vs ₹15,806 ✓.
- Consequence: in-file dedupe is a ~6-row manual review, not a systemic hazard. The **real** A1 risk is unchanged: `UNIQUE(chassis_no)` still needs the staging-table design because cross-file the same chassis legitimately appears 2–4 times (purchase file + sale file + retention files) — that's the join key working as intended, not a duplicate.
- Fix: keep the staging + surrogate-PK design; scope the "duplicate resolution" task to ~6 rows (1 IT group + 4 FY groups), owner-reviewed.

### R2-2 · A2 cross-file conflicts — CONFIRMS CTC exactly; CORRECTS CTD + customer numbers
**Severity: BLOCKER (unchanged) — the last-file-wins import remains unsafe.**
Join INVOICE TRACKER→FY on trimmed chassis: **1789 joined**.
- CTC disagree **473/1783 = 26.5%** — matches round 1 to the row. CONFIRMED.
- CTD disagree **353/1779 = 19.8%** (round 1 said 22.2%) — same direction, slightly lower; note FY's CTD column (AJ) holds dealer *names* on inter-dealer-layout rows, which a numeric-only diff silently skips, so the true number is layout-dependent (see R2-4).
- Customer disagree **400/1789 = 22.4%** (round 1: 30.1%), and rows where INVOICE TRACKER says exactly `STOCK` = **3**, not 143 (round 1 likely counted a different pattern or file pair; not reproducible as stated).
- Verdict: the decision (16 — back-office resolves conflicts in Excel first, portal produces the report) survives; the conflict report's column-pair list should be re-derived from this scan, not from round-1's counts.

### R2-3 · A1b/G1-adjacent — FY duplicate groups small; NEW: dup groups are cancel/rebill artifacts
**Severity: LOW.** 4 dup groups in FY, 2 with different customers — consistent with the `canc rebill` sheet (87 rows) recording cancelled-and-rebilled chassis. NEW nuance: a rebilled chassis genuinely has TWO commercial histories (two sales). Plan §7 Q1 ("re-sale overwrite — confirm acceptable") is therefore **not hypothetical — it is already in the data**, twice. The unique-chassis model erases one real sale on day one of migration. Suggest: answer Q1 before schema freeze; the `superseded_at` column already in decision A1 handles it if writes create a new row instead of updating.

### R2-4 · A3 two-layouts-in-one-sheet — CONFIRMS the count; CORRECTS the geometry (it's ≥3 layouts, not 2)
**Severity: HIGH (unchanged).**
Empirical: col AH ("PTB INVOICE DATE") has exactly **186** non-date non-blank values — round-1's number CONFIRMED. But the structure is messier than "shifts one column left from r1443":
- r1443+ rows: AH holds AD-BLU/URIYA-type text (`25K-URIYA`), AI holds the date, AJ holds CTD money — a one-**right** shift of date, one-left of the ADBLU block.
- r1440–1442 (before the claimed break): AJ holds dealer names (`ASL MOTORS`, `LM AHMEDABAD`) with margin-like decimals in AK — these are **inter-dealer-layout rows** (matching INVOICE LIST's OTHER DEALER sheet, which has an extra `DEALOR` column) interleaved in the same sheet.
- So FY Sheet1 mixes at least 3 row-layouts. Consequence unchanged and slightly worse: positional mapping cannot import it; the import wizard needs per-row layout detection (or decision-16 pushes the fix to the back-office). Round-1's "186 rows" is the right magnitude of damage.

### R2-5 · A4 DEALERS sheet — CORRECTS: worse count, but chassis IS recoverable
**Severity: MEDIUM (down from HIGH).**
Empirical: 371 non-blank data rows (sheet ref says 479 incl. blanks/subtotals). "Chassis No" column: **0** chassis-pattern, **206** engine-pattern values (round 1 said 54 — undercounted ~4×). But round 1 missed the useful half: the **actual chassis numbers are present — under the "Model" header** (206 rows match `MB1…` chassis pattern in col D). The header row is stale (one column label missing), not the data corrupt. Also 19 subtotal-style rows (blank SRNO + money).
- Consequence: DEALERS rows CAN be joined to chassis after a fixed re-map (D→chassis, E→engine); no data loss. Fix: hard-code the corrected column map for this sheet in the migration script + skip subtotal rows; don't ask back-office to restructure it.

---

## Scorecard — round-1 register after independent re-derivation

| Round-1 claim | Verdict | Where |
|---|---|---|
| A1 duplicate chassis (whitespace collisions, "conflicting values") | CORRECTED — 1 in-file dup group (not systemic); 0 whitespace collisions; cited examples real | R2-1 |
| A2 conflict rates (CTC 26.5% = 473 rows) | CONFIRMED to the row; CTD 19.8% not 22.2%; customer 22.4% not 30.1%; "143 STOCK" not reproducible (actual 3) | R2-2 |
| A3 two layouts in FY sheet (186 rows) | CONFIRMED count; geometry corrected — ≥3 interleaved layouts | R2-4 |
| A4 DEALERS engine numbers (54) | CORRECTED — 206 not 54, but chassis fully recoverable from the mislabeled column | R2-5 |
| A5 spot-check catch probability (~0.4%) | OVERTURNED arithmetic (actual: 99.8% for a 26.5% class); conclusion survives for rare classes only | R2-22 |
| B1/B2 generated-column illegality | CONFIRMED from PG17 docs; but B2's own fix has a landmine | R2-P, R2-25 |
| C2/C4/C6/C7 access-control claims | CONFIRMED (C7 quantified: 80/116 policies bare, 0 wrapped) | R2-C |
| C5 join-wipe inheritance | STALE — fixed by #89/#93 on both sides; moot under decision 14 | R2-C |
| D1 plaintext PII sinks | CONFIRMED (both quotes verified) | R2-C |
| D2 audit-RLS precedent "broad" | OVERSTATED — service_job_events RLS is scoped; fix still right | R2-C |
| D8 VAPT M-1 already fixed | CONFIRMED | R2-C |
| E1/E9 (1000-row cap; rate-limit 60/60 fail-open) | CONFIRMED | R2-C |
| E2 ghost-success via "~8s browser timeout" | MECHANISM WRONG (no such timeout); fixes still needed for real reasons | R2-23 |
| E3/E4/E8 platform limits | CONFIRMED from docs; E4 has a new aggravator (per-subscriber RLS checks, single-threaded) | R2-P |
| E11 "Catalog has no mobile cards" | HALF-WRONG — `vc-mobile-cards` exists ×3 | R2-C |
| §3 CTC-basis varies per row | CONFIRMED (530/2050 exclusive-basis rows); danger relocated to input columns — derived formulas are 100% uniform | R2-10, R2-11 |
| §4 retention 100% / diff_tds / total / cretem / text columns | CONFIRMED (all reproduced within rounding) | R2-10, R2-16, R2-17 |
| §4 tcs = ctc × 1% | **OVERTURNED — actual basis is tally_bill × 1% (100% match); round-1 inverted it** | R2-14 |
| §4 three retention concepts (50.4% / 81.9%) | CONFIRMED concept + 50.4%; 81.9% unreproducible; AL claim is a raw ₹500-step negotiated input | R2-18 |
| §4 dse_incentive slab | CONFIRMED formula; 28% of rows overridden by hand (house account) — needs override design | R2-19 |
| Decision 9 VIN 4406/4406 | Pos-10 solid (0 contradictions vs Make); pos-12 has 15 letters > 12 months — month decode unproven | R2-20 |
| §4 qty missing | CONFIRMED column should exist; urgency corrected — 0/4672 rows have qty≠1 | R2-21 |
| G1/G2/G3/G5/G6 settlement findings | ALL CONFIRMED (12/43, 91/313, 40 sub-rupee, 71/310, 11-status vocabulary) | R2-17, R2-26, findings above |
| F1–F15 adoption findings | Sound as judgments; F3 now has hard evidence (₹3.43 Cr live in a side-sheet) | R2-24 |

New findings this round: R2-3 (rebills already in data → §7 Q1 is not hypothetical), R2-6 (react-data-grid needs React 19 — pin beta.48 or upgrade), R2-7 (exact-pathname canAccess breaks /tracker/:id), R2-8 (app_metadata staleness ⇒ revoke sessions on flag change), R2-9 (EF roster is 10 not 9), R2-12 (comment census: 124 total, all on input cols — small, reviewable), R2-15 (exact receivable chain; finance_paymt_rec is a DATE), R2-24 (₹3.43 Cr prior-FY receivables outside the six-file scope), R2-25 (source_file trigger-skip = permanently stale derived money), R2-27 (inter-dealer rows overlap three files).

---

## Verdict on the core premises

1. **One row = one chassis** — supported by the data, with one non-negotiable rider: cancel/rebill double-histories already exist (2 in FY + an 87-row canc-rebill sheet), so the superseded-row mechanism must ship in 10b, not later. §7 Q1 is answered by the data: plain overwrite loses a real sale.
2. **Adoption-first framing is correct and now evidence-backed.** The strongest empirical facts this round all point at F1–F4: informal side-sheets carry live crores (R2-24), comments carry deal terms that exist nowhere else (R2-12), statuses are free-text vocabulary (R2-26), and incentives carry hand overrides (R2-19). A tracker that can't hold a note, an override, or an ad-hoc value will be routed around exactly as the plan fears.
3. **The §3 CTC-basis alarm is right but mislocated.** Derived formulas are perfectly uniform (zero deviant patterns across 24,856 formula cells); the hand-manipulation lives in ~221 input cells + 124 comments. Migration = import input VALUES, recompute derived — reproduces the book 100.0%. N1–N5 all stand; N3 shrinks to input columns.
4. **The register is ~80% right and worth trusting — after this pass.** Of its precise numbers: most reproduced exactly; three were overturned (TCS basis inverted — a money formula; A5's probability; E2's mechanism); several were stale against current origin/portal. The pattern the owner flagged (confidence resting on assumed uniformity) recurred once more in round 1 itself: the TCS "correction" scored high only because tally==ctc on 66% of rows.
5. **Estimates:** §6 sums to 33.5–38.5 d ≈ 6.7–7.7 weeks at the plan's own numbers — "~6–7 weeks" is the optimistic edge. Add: RDG React-18 spike (0.5 d), prior-FY open-items import (0.5–1 d), recompute-semantics design (in 10b), settlement print (already in 10f). Realistic: **7–8 weeks**.

**Top actions before 10a** (ranked): fix the TCS formula in the plan (R2-14) · decide React 18 pin vs upgrade after a 0.5 d RDG spike (R2-6) · replace the source_file trigger-skip with explicit import-mode semantics (R2-25) · add prior-FY open items + stray-sheet sweep to the migration scope (R2-24) · answer §7 Q1 as "superseded rows, day one" (R2-3) · design the incentive override + AL-claim-as-input columns (R2-18/19) · wrap every new RLS function call in `(select f())` from the first migration (R2-C/C7).
