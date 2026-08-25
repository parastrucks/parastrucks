# Paras Portal — Project Memory

Internal team portal for **Paras Trucks & Buses** (commercial-vehicle dealer — Ashok
Leyland, Switch Mobility, HD Hyundai CE). Live at **https://team.parastrucks.in**
(Vercel, auto-deploy from the `portal` branch). Supabase project `mmmxvjaavdtwlpcnjgzy`.

> This file is the **always-loaded operational core** — current state, how to work here,
> and a map to everything else. Keep it lean: **never paste completed-phase history back
> in.** Full history and rebuild instructions live in `docs/` (see the Documentation Map).

---

## Documentation Map — how & when to use these docs

*Read top-down; only go deeper when the task needs it.*

1. **This file (`CLAUDE.md`)** — always loaded. Current state · next actions · how to work here. **Start here.**
2. **Memory index (`MEMORY.md`)** — loaded each session as one-line hooks; open a specific memory file only when its hook is relevant:
   - **Current State** → `phase_status.md` (what's live), `known_issues.md` (open gaps), `project_next_session.md` (next actions)
   - **Reference** (how the system works) → `tech_stack`, `terminology`, `project_edge_function_auth`, `entity_data`, `pdf_pt_differences`, `project_overview`
   - **Working preferences** (how the owner wants you to work) → `feedback_*` — honor without being re-told
   - **Pointers** → `phase_6b_plan` + the plan files in `~/.claude/plans/`
   - **ERP (separate repo)** → `project_hd_hyundai_vertical` — only for ERP tasks
3. **Master history → [`docs/history/PORTAL_HISTORY.md`](docs/history/PORTAL_HISTORY.md)** — the full record of every phase, the Phase 9 VAPT programme, and session logs. **Do NOT read at session start.** Open only when you need the backstory of a decision, or to append a new session entry.
4. **Rebuild the system → [`docs/RECONSTRUCTION.md`](docs/RECONSTRUCTION.md)** — step-by-step blueprint to recreate the whole portal from scratch, backed by the canonical DB dumps in [`docs/db/`](docs/db/) (`schema-current.sql`, `seed-reference.sql`).
5. **Repo `docs/`** → `history/` (delivered reports/specs), `backlog/` (tabled ideas + Phase 10).

**When you finish a piece of work:** update `phase_status.md` + `known_issues.md` (if an issue opens/closes) + append a dated entry to `PORTAL_HISTORY.md`. New owner preference → add a `feedback_*` memory. Keep this file short — it points to detail, it doesn't hold it.

---

## Current state (2026-08-25)

- **✅ TIV FORECAST UI/UX — AUDITED, REMEDIATED IN FOUR WAVES, AND COURSE-CORRECTED. ALL LIVE.**
  Eighteen PRs: **#102 `485430e`** (W1 stop the lies) · **#103 `5446ac8`** (W2 atomic upload) ·
  **#104 `868857f`** (W3 shell) · **#105 `bdba3a4`** (W4 value layer) · **#106 `0649493`**
  (simplify) · **#107 `65adccb`** (chart handover) · **#108 `fe517fa`** (KPI month rule) · **#109 `d821b94`** (docs) · **#110** (judgment ghosts) · **#112 `dafa33a`** (Invalid Date) · **#114 `b0ebe31`** (lone Model column) ·
  **#116 `dfe73d7`** (data cadence) · **#117 `50048b3`** (contrast + dead code) ·
  **#118 `0807489`** (prune on upload) ·
  **#120 `ade925c`** (tap-for-detail + previous vintage).
  ⭐ **Full record: `docs/history/PORTAL_HISTORY.md` (2026-08-25 entry).** Findings:
  `docs/backlog/tiv-uiux-audit-2026-08-25.md`. Remaining work: `docs/backlog/tiv-uiux-fix-roadmap.md`.
  - **The parity gate never moved: 21/21 exact (736 / 779 / 850, backtest 26.4%)** before and after
    every change. Engine maths untouched throughout.
  - **⭐ THE LESSON OF THE SESSION — the owner rejected the result of the first four waves:**
    *"All pages have too much information … employees feel intimidated rather than informed."*
    He was right. Every finding was fixed on its own merits and **nothing checked the aggregate** —
    eleven blocks before the first number. `feedback_excel_parity` (*adoption is the metric, novelty
    is a cost*) was violated **by accretion**. Now: **default view answers the question; everything
    else folds one click away** (`.tiv-fold`), tuned for **the GM opening it monthly**.
    **Rule adopted: when adding a UI element, state what it pushes further down the page.**
  - **A1 was live, not theoretical** — trained through Jul-26, the forecast would have rendered
    **bold zeros** from **1 Sep 2026** once the window outran its anchors. Fixed; missing anchor is
    now a red "model out of date" state, never a number.
  - **Upload is atomic, reviewed and revertible.** `tiv_upload_all()` = snapshot + 6 upserts +
    params + history in ONE transaction; pre-commit diff preview; `tiv_forecast_snapshots` table;
    **409 interim guard** against the multi-brand overwrite. `admin-tiv` **tightened to admin-only**
    (it accepted `back_office` while the panel showed only to admins, and it bypasses RLS).
  - **28 rows of corrupt prod data cleared in two passes** (both owner-approved, both snapshotted):
    16 all-zero Aug-26…Mar-27 in `tiv_actuals` + `ptb_actuals`, then **12 all-zero Oct-26…Mar-27 in
    `judgment_tiv` + `judgment_ptb`** (PR **#110**) — the judgment tables carried the same
    2026-08-21 parser defect and the first pass never looked at them. Both prediction sheets in the
    workbook end at **Sep-26** (14 rows); the DB held 20. Both tables now hold 14.
    **The six all-zero 2022 PTB months are GENUINE ramp-up zeros and were kept** — verified as
    *typed zeros* in the workbook, with TIV fully populated for the same months (Apr-22 = 265).
    The rule is "empty AND after the last real month", **never** "value is zero".
  - ⚠️ **`tiv_upload_all()` contains no `DELETE`** — it only upserts, so a month that vanishes from
    the workbook lingers forever and no upload will remove it. That is how the 12 judgment ghosts
    survived. The diff preview surfaces shrinkage; removal is SQL-only. Decision pending — see
    `docs/backlog/tiv-uiux-fix-roadmap.md` §1b.
  - Both data-cleanup migrations are now **committed** (`20260825_clear_ghost_future_months.sql`,
    `20260825_clear_ghost_judgment_months.sql`); they had been applied straight to prod.
  - **Summary tiles lead with next month after the 19th** (IST), falling back if that month is stale.
  - ✅ **The owner ran the first real upload (2026-08-25).** It behaved: *52 months … Judgment 14/14*,
    preview *"0 new · 0 amended · 52 unchanged"*, snapshot #4 named as the rollback point.
    **It also exposed a bug nothing else could** (PR **#112** → `dafa33a`): the status strip read
    **"Model trained: Invalid Date"**, because `handleUploadComplete` shows the params object
    `retrainModel` builds *in the browser*, and `trained_at` is stamped by the DB. A reload cleared
    it, so it lived only in the seconds after an upload — which no probe, gate or self-test renders.
    Fixed at cause (re-read the stored row) and guard (`formatTrainedAt` → "just now").
  - ✅ **Hard refresh confirmed both (2026-08-25):** tile leads with **Sep-26 779 · judgment 830**,
    strip reads **"Model trained: 25/8/2026"**. The Aug-26 tile was a **cached pre-#108 chunk**, as
    the deployed source predicted — not a bug. ⭐ **Method: to date what a user is running, fetch
    the prod HTML → read the hashed asset name → curl the chunk → grep the minified logic.**
  - ✅ **Lone "Model" column labelled** (PR **#114** → `b0ebe31`). Clearing the ghosts left Oct-26
    as an unlabelled number beside two "Model | Judg" pairs — the empty `<td>` was invisible only
    while the ghosts existed. A **removal** changed a header's shape: check the aggregate after
    deleting data, not just after adding UI.
  - ✅ **Owner's four decisions taken and three of four built (2026-08-25 evening).**
    **#116 `dfe73d7`** — the monthly data gap now tells the truth. Market data arrives on the
    **5th–7th**, the model's anchors run out on the **1st**, so a gap opens on schedule twelve
    times a year. Calling that *"Model out of date"* in red was crying wolf. Three states from
    `dataCadence()`: **current** (not due yet) · **due** (5th–10th, neutral `role=status`) ·
    **overdue** (past grace, red `role=alert`). The strip now always states **`Covers: Aug-26 →
    Oct-26`**, read from the anchors, so running out is never a surprise.
    **#117 `50048b3`** — legend label text forced to `gray-600` (7.34:1; it was **1.84:1**, measured)
    while the swatch keeps the series colour; both PTB lines to `gray-500` (4.54:1, clearing the
    3:1 graphical minimum). Superseded `upsertRows`/`insertModelParams`/`insertUploadHistory`
    **deleted** with their 8 client wrappers, plus the now-dead `TABLE_CONFIG` + `injectTivIds`
    (**−133 lines**); `docs/backlog/tiv-multi-entity-brand.md` updated because it told a future
    session to edit `TABLE_CONFIG`.
    **#118 `0807489`** — **upload can now remove months the workbook no longer contains, after an
    explicit tick.** `tiv_upload_and_prune()` **wraps** `tiv_upload_all()` rather than editing it
    (a new argument list makes an overload, not a replacement — 275 lines of verified upserts stay
    untouched). Pruning after the upserts is provably equivalent to before. Three guards: opt-in ·
    refuse on any empty sheet · **refuse when the count differs from what the uploader was shown**.
    **Per table, never global** — actuals hold 52 months and judgment 14, so one global month set
    would have proposed deleting 38 judgment months. Proved on prod with a self-aborting probe
    (off→0 · wrong count→refused · empty sheet→refused · correct→pruned exactly Jul-26), prod
    verified untouched at 52/52/52/14/14/52 with zero probe residue.
- **Test estate (bundle with esbuild first, then run against the gitignored workbook):**
  `parity-gate` **21/21** · `selftest-parser` 13/13 · `selftest-stale-anchors` 14/14 ·
  `selftest-upload-diff` 27/27 · `selftest-quality` 31/31 · `selftest-chart` 22/22 ·
  `selftest-kpi-month` 13/13 · `selftest-trained-at` 14/14 · `selftest-table-header` 18/18 ·
  `selftest-data-cadence` 38/38 · `selftest-removals` 25/25 · `selftest-contrast` 8/8 ·
  `selftest-vintage` 33/33 · `selftest-detail-sheet` 19/19
  (renders the real component via `react-dom/server.browser`). Plus `diag-blank-zero` / `diag-raw-cells` workbook inspectors.
- ⚠️ **`npm run build` does NOT catch a stray top-level `x={y}`** — it parses as a valid non-strict
  assignment, but ES modules are strict so it throws on every page load. A `perl -0pi` JSX edit
  introduced exactly that. **Use the Edit tool for multi-line JSX; check `head -1` of every edited
  file afterwards.** These source files are **CRLF**, so `\n` in a node/perl replacement silently
  no-ops — detect the newline style first.
- ⚠️ **There is no ESLint config in this repo** (`npx eslint` fails; no lint script). `npm run build`
  is the gate — never report a lint pass.

## Current state (2026-08-24)

- **✅ TIV FORECAST v3.0 — SHIPPED, VERIFIED ON PROD, AND UPLOADED (2026-08-24).**
  PR **#99** → `5bd2c2f` (engine + UI/UX) and PR **#100** → `d06cb08` (nanoid; **CI is fully
  green again**). Migration `20260824_tiv_v3_model_params.sql` applied to prod. Owner's Jul-26
  workbook uploaded (`model_params` id 19) and independently verified.
  - **v2.1 is WITHDRAWN, not superseded.** Its backtest harness compared **FY-to-date against a
    FULL prior FY**, pinning capped growth at **−15% in 56 of 72 segment-months** when the true
    value was +15%. Every v2.1 method selection rested on that. Production constants were computed
    correctly at train time, so *shipped forecasts were sound — the evidence for them was not*.
    **Rule: every YoY comparison must be period-matched. Never FY-to-date vs a full FY.**
  - **v3.0 method map** (a code constant — do **NOT** recompute on retrain):
    Bus PVT / Tractor / Tipper = `ROB` (robust-anchor SMLY × trailing-12M) · Haulage / MAV =
    `THETA` (0.6 SMLY + 0.4 Theta) · ICV Trucks = `ADAPT` (level-shift adapter, exists because
    GST 2.0 shifted demand past what a ±15% cap can express). Model **26.4%** vs judgment **28.6%**.
    Calendar normalisation **retired**; Holt-Winters now unused; `fuelCrisis` **deleted**; all
    triggers default **OFF**; forecast is **judgment-free**.
  - **Robust anchor = median(m−1, m, m+1) of the prior year** — neutralises one-month spikes
    arithmetically, so **no manual outlier list is needed or permitted**.
  - **Spec bug found and fixed:** §5.5 describes Theta as SES on the deseasonalized series. Classic
    Theta runs SES on the **θ=2 line** (`2·Y − regression`). The literal reading put Haulage 11–19
    units low. Predicted analytically (SES is linear) *before* changing code, then confirmed.
  - **Verified with real data, not asserted:** `scripts/tiv/parity-gate.mjs` runs the **real
    shipped modules** against the real workbook → **21/21 exact** (Aug/Sep/Oct-26 =
    **736 / 779 / 850**), backtest 12 rows @ **26.4%**. Prod row id 19 reproduces 736 by hand.
  - **⚠️ NEW LATENT DEFECT — multi-entity/brand uploads silently destroy data.** All six tables
    have **`UNIQUE (month_label)`** (global, not per entity+brand) and `admin-tiv` upserts on
    `month_label`, so a second brand's upload **overwrites the first in place** with no error.
    Reads are entirely unscoped. Latent today (prod holds exactly **1** entity/brand pair).
    ⭐ **Full write-up + fix order: `docs/backlog/tiv-multi-entity-brand.md`.** Needs owner approval
    (constraint change). **Do not add a viewing dropdown first** — that makes the destructive path
    easier to reach.
  - Methodology docs now live in the repo: `docs/TIV_FORECAST_MIGRATION_SPEC.md` (v3.0, authority),
    `docs/WEBSITE_BUILD_HANDOFF.md`, `docs/V3_EXECUTION_HANDOFF.md` (superseded, kept for the record).
    The source workbook is **gitignored** (commercial data); the gate takes its path as an argument.
- **✅ CI fully green (2026-08-24).** The long-running `npm-audit` red was `nanoid <3.3.18` (HIGH),
  a **dev-only transitive of postcss** whose `^3.3.16` range already admitted the patch. 3-line
  lockfile bump, proven inert (clean `npm ci` A/B → **all 34 emitted assets byte-identical**).
  react-router + dompurify **moderates remain by decision** — the gate is `--audit-level=high`, and
  react-router 7.x trades them for a HIGH and needs React 19.

## Current state (2026-08-07)

- **✅ UNIFORM USER SHAPE — SHIPPED & BACKFILLED ON PROD (2026-08-07).** Every portal user in
  every department now carries the same attributes. Six PRs, all live: **#89** `649a4b7` (stop
  the join-table wipes) · **#90** `46e66a5` (erp-sso requires an ACTIVE portal user) · **#91**
  `c8df30f` (audit SQL) · **#92** `b2852cd` (password-min docs) · **#93** `a613b76` (uniform
  form + server-side shape gate) · **#94** `363201e` (forced password change). Plus ERP **#41**
  `6995c5f`.
  - **The defect:** the employee form captured a *different shape per department*. Three
    mutually-exclusive blocks decided which controls an admin was even shown, and
    **accounts/hr/pdi matched none of them** — so those users had no brand and no outlet, and
    nothing reported it. `user_brands` is an **authorization input** (`vehicle_catalog_select`,
    `quotations_select`, `proforma_invoices_select`, `financier_copies_select`, all 7
    `tiv_forecast_*_select`), so a missing row silently blanked their catalog **and** dropped
    them out of the ERP sync's `!inner` brand join — before the query returned, so they never
    appeared in `skipped` either. That is why the ERP had **never once seen an accounts user**.
  - **Measured on prod (58 active non-admin users):** 37 missing `primary_outlet`, 2 missing
    `brands` (PT only), 1 missing `subdept`. **Zero** `(NO ENTITY)`/`(NO DEPARTMENT)` rows and
    **zero** `set_but_na` — so nobody was RLS-locked-out and there was no stale hidden data.
  - **Backfill:** all 37 outlets derived from the existing `location` field (exact match,
    correct entity, active outlet — no guessing), applied in 3 batches after owner review.
    SUNIL + Siya granted `al+hdh+switch`. **Acceptance test now returns exactly ONE row**
    (Ashok Prajapati, BO GM — correct by policy, see below).
  - **The shape** (`src/lib/userShape.js` + Deno mirror `supabase/functions/_shared/userShape.ts`):
    entity · department · designation · permission_level · **primary_outlet (ALL depts)** ·
    **≥1 brand (ALL depts)** · sales_verticals (Sales only) · subdept (Back Office, non-GM).
    A slot that doesn't apply is **rendered with its reason on screen**, never omitted — a blank
    that means "doesn't apply" is indistinguishable from one nobody filled in, and that
    ambiguity is what hid this for months. Enforced in the form **and** in `admin-users` on
    **create AND update** (the form is UX; the EF is the contract).
  - **No policy/waiver tables.** Considered and dropped on evidence: the audit found **one**
    exception in 58 users, and it is a *rule* (a BO GM heads EDP+RTO+CRM), not a person. The
    matrix is ~10 declarative lines; `scripts/user-shape-audit.sql` is the referee that makes
    drift *detectable*. Revisit only if a genuine per-person exception appears.
  - **ERP result:** `created:0, updated:21, deactivated:0, skipped:[]` (was `updated:20`).
    **SUNIL adopted** — `tier=executor · func=accounts · branch=HSR` all **preserved** by
    `role_overridden=true`; `source` flipped `local`→`portal`. **Both ERP admins untouched.**
    The accounts arm of the two-stage payment flow is no longer GM+admins only.
  - **ERP admins hardened** (owner-approved): `role_overridden=true` on `ceo` + `admin`.
- **✅ FORCED PASSWORD CHANGE — LIVE (PR #94 + ERP #41).** An HR/admin reset now marks the
  password temporary (`auth.users.app_metadata.must_change_password` — **not** a portal column,
  which `users_update` RLS would let the user clear themselves), **revokes live sessions**, and
  traps the user on `/change-password` (rendered outside `AppLayout`) until they choose their
  own. Both ERP doors refuse a flagged password. Three latent holes closed on the way:
  `resetPassword` had **no tier guard** (an HR *executive* could reset the admin's or a GM's
  password), its **failure path was never audited**, and `Profile`'s change-password let a
  **borrowed session change the password without knowing the old one**.
  ⚠️ **Not yet tested end-to-end by a human** — staging is INACTIVE so no rehearsal was
  possible. Run reset → login → trap → change → release once with a throwaway user before
  resetting anyone real.
- **⚠️ Staging project `klpnhpnlotcbbovwswmq` is INACTIVE/paused** — no pre-prod rehearsal is
  available. Factor this into any risky change.

## Current state (2026-07-26)

- **🔐 Prod is on Supabase NEW API keys (cutover LIVE 2026-07-23, PR #81 → `1d9ba17`).** Legacy
  `anon`+`service_role` DEACTIVATED; the leaked `service_role` JWT is verified DEAD (401). Browser uses
  `sb_publishable_…`; all 9 EFs use the injected secret/publishable bags via `_shared/keys.ts`
  (`USE_NEW_API_KEYS=true`). Cutover fully verified & closed — see `known_issues.md`.
- **🔒 2026-07-26 security batch — all live & verified on prod:** revoked `anon`+`PUBLIC` EXECUTE on
  `next_proforma_number`/`next_financier_copy_number` (PR #86 → `3316344`; the frontend calls them as
  `authenticated`, which keeps EXECUTE) · **`adminLogoutUser` fixed** — the GoTrue `…/logout` endpoint 404s,
  replaced by RPC `admin_revoke_user_sessions(uuid)` that deletes `auth.sessions` (PR #87 → `4fd2718`; proven
  on staging 4→0) · deleted dead `VITE_SUPABASE_SERVICE_KEY` (Vercel prod + `.env`) · provenance repair =
  **non-issue** (0 null rows) · react-router 6→7 = **WONTFIX** (7.18.1 adds a HIGH RSC-CSRF advisory,
  unreachable here; clean version needs React 19) · localhost dev restored (`.env` anon → staging publishable).
- **Deployed & live:** Phases 1A–9 + **Phase 9.5 Vendor Jobs** (`/vendor-jobs`) +
  **Phase 9.6 visual redesign** (LIVE 2026-07-16, PR #78 → `29404b4`) +
  **✅ Phase 9.7 — Catalog UX rework — LIVE ON PROD 2026-07-20** (PR #79 squash-merged →
  **`506d888`**; CI all-green, Vercel `portal` READY, prod `/`+`/login` = 200). The whole package
  shipped as ONE release: **9.7a keystone** (`vehicle_catalog.sub_segment_id` FK; rename unlocked) ·
  **9.7b workbench** (Reshuffle bulk-move via `move_cbns_to_family` RPC, Triage rule-suggestions,
  Rules CRUD, family retire/reactivate lifecycle; **MBP Truck → Long Haul Trucks** consolidation) ·
  **9.7c** (search-first landing + per-user shelf, brochure wall with real pdfjs cover thumbnails,
  **admin Browse tab**) · **9.7d** (family-level WhatsApp share). Also fixed **4 pre-existing prod
  bugs** on the same release: PostgREST 1000-row truncation (`fetchAllRows`), import blank-field
  null-erase, `MBP Truck` blank dropdown, and `createVehicle` never setting `brand_id` (R11).
  Pre-ship: R5 EF smoke test (19/19) → 4 clean-room red-team lanes → 19 Tier1+2 fixes → **25/25
  re-verify on staging** → owner screen-by-screen review. **Prod cutover facts (2026-07-20):**
  keystone backfill **976/1006** linked (30 orphans → Triage queue); consolidation `UPDATE 11` +
  retire `UPDATE 1`; b1 rules+5-arg RPC (writes `sales_vertical_id` too — T2) + c2 `cover_url`
  applied; `admin-catalog` EF deployed to prod. Full record: `docs/backlog/phase97-catalog-ux.md`.
- **🔗 ERP integration (2026-07-25, PR #83 → `bc72d83`):** `sync-erp-users` now carries the **PT sales
  department** into the ERP as its branch-less **`sales`** tier — the portal side of ERP Phase 13c, and
  the change that creates a sales user's ERP account at all. `ERP_FUNCS` += `sales`; the sales
  department **pins** tier `sales` instead of mapping `permission_level` (ERP `gm` bypasses every
  functional gate at the DB level); `BRANCHLESS_TIERS` = gm/admin/sales because the ERP CHECK
  `sales_is_branchless_sales_func` rejects a sales profile carrying a branch. Synced sales users arrive
  at **0 / ₹0 = inert** until an ERP admin sets their ceilings. Entry is gated on the `hdh` brand
  assignment (owner's chosen lever).
- **📋 Phase 10 — Vehicle Tracker (`/tracker`): planning COMPLETE, plan APPROVED 2026-08-11, build
  not started.** Six back-office Excel workbooks → one grid, **one row = one chassis**; success
  metric is **adoption**. Two design reviews merged, every number re-derived from the real workbooks.
  ⭐ **Start at `docs/backlog/phase10-execution-plan.md`** (+ `phase10-vehicle-tracker.md` design
  reference, `phase10-review-round2.md` evidence, `scripts/phase10/` derivations).
  ⚠️ Phase 10 docs live **only in the repo** — never cite a `~/.claude/plans/` path for it.
- **Separate project (not this repo):** the HD Hyundai **ERP** (`erp.parastrucks.in`, repo `erp-parastrucks`) — see `memory/project_hd_hyundai_vertical.md`.

## Next actions

- ~~**DECISION NEEDED — `tiv_upload_all()` never `DELETE`s.**~~ ✅ **DECIDED AND BUILT 2026-08-25**
  (PR **#118** → `0807489`): owner chose *"ask me, then remove"*. `tiv_upload_and_prune()` lists
  every month that would go, per table, box unticked by default; opt-in, refuses on an empty
  sheet, and refuses when its own count differs from what the uploader was shown.
  ⏭️ **Untested by a human** — nobody has ticked the box on a real upload. With the current
  workbook the list should be empty, so it will not even appear.
- ~~**OWNER: run ONE real upload.**~~ ✅ **DONE AND CONFIRMED 2026-08-25.** It behaved as predicted
  and surfaced two defects nothing else could — "Model trained: Invalid Date" (PR #112 →
  `dafa33a`) and the unlabelled lone Model column (PR #114 → `b0ebe31`). Hard refresh verified the
  summary tile leads with **Sep-26 779 · judgment 830** and the strip reads **25/8/2026**; the
  earlier Aug-26 tile was a **stale cached chunk**, not a bug. Nothing outstanding here.
- ✅ **TIV UI/UX tail — the owner's picks are all built** (PR #120 → `ade925c`): tap a number for
  its derivation (a real button + a bottom sheet under 720px), and the previous-vintage line.
  ⚠️ **The vintage line draws nothing on prod yet, by design** — every stored vintage is either
  `Jul-26` (same as the current model) or pre-v3 with no anchors. It begins working when August
  data lands. ⭐ **Prod rows wrote the rule:** three `Jul-26` re-upload rows (comparing a model
  against itself), a `Mar-27` row that is 2026-08-21 parser residue and is *newer* by
  `trained_at`, and pre-v3 rows the engine cannot replay — so a vintage must differ, be earlier,
  **and** be replayable.
- **⏭️ Not built — and NOT picked by the owner when asked (2026-08-25):** **W4.6** xlsx download /
  round-trip export / print stylesheet (Copy table + Copy summary already cover the daily need) ·
  roving tabindex on the accuracy grid (168 tab stops kept; the *Show forecast/actual* toggle is
  the keyboard path, so nothing is unreachable). Both stay available if he asks.
  ⭐ `docs/backlog/tiv-uiux-fix-roadmap.md` §1b.
- ~~**Remove the superseded `admin-tiv` actions.**~~ ✅ **DONE** (PR #117 → `50048b3`) — `upsertRows`,
  `insertModelParams`, `insertUploadHistory` deleted with their 8 client wrappers and the now-dead
  `TABLE_CONFIG` + `injectTivIds`. **−133 lines**, and one fewer service-role path.
- **⏭️ TIV multi-entity/brand — OWNER SAID "EVENTUALLY, NOT NOW" (2026-08-25). Do not start it.**
  A second entity/brand upload would still hit the global `UNIQUE (month_label)`, but the **409
  guard makes that a refusal, not silent data loss**. When it is wanted, the order is
  **constraint → scoped reads → selector**, never the selector first, and the constraint change
  needs explicit approval. ⚠️ `fetchModelParamsHistory` and `fetchStoredMonths` are also unscoped —
  scope them in the same pass. ⭐ `docs/backlog/tiv-multi-entity-brand.md`.
- **⏭️ TIV re-trial checkpoint: after Oct-26 actuals** (15-month window). Re-examine ADAPT
  stability for ICV Trucks and whether Haulage should move to ADAPT (it was second-best there and
  carries a persistent −19% to −37% bias under capped methods). **Do not change `V3_METHOD`
  before then** — it is a code constant, not a retrained field.
- ~~**Owner: supply AL/LM split for Apr-26 onward.**~~ **RESOLVED — this is STALE, do not chase it.**
  Measured 2026-08-25: the current workbook carries real AL figures right through **Jul-26**
  (Apr-26 = 10/95/31/24/30/44 …), so the share layer is no longer frozen at Mar-26 and the ⚠ chip is
  correctly hidden. `al_actuals` holds 52 rows, all with data.
- **⏭️ Owner: run the forced-password-change loop once** with a throwaway user (reset → login →
  land on `/change-password` → every other route bounces → set new password → released → sign
  out/in, not prompted again). Untested end-to-end; staging is down.
- **⏭️ Owner: Ashok Prajapati's sub-department.** Decision taken (2026-08-07): *waiver — a Back
  Office GM heads EDP, RTO and CRM*, so `subdept` stays NULL and that is **correct by policy**,
  not an open gap. No table needed; the rule is encoded in `userShape.js`.
- **Open, deliberately not built (all red-teamed, evidence in `~/.claude/plans/task-make-every-majestic-crane.md`):**
  - `sync-erp-users` **`incomplete` bucket** — would name users the `!inner` joins drop instead
    of letting them vanish. **Blocked on a prerequisite:** it is a remediation list, and
    remediating `ceo@` would adopt the ERP admin — mitigated now that `role_overridden=true` is
    set, but the bucket must also hard-flag any portal email matching an ERP `source='local'`
    or `tier='admin'` profile as DO-NOT-SCOPE.
  - **`signOut` lives only inside the sync's deactivation sweep** (`sync-erp-users:272`); the
    patch path sets `is_active=false` without revoking. A portal-deactivated user keeps a live
    ERP session until the next sweep. Fix = move `signOut` into the patch path.
  - **DELETE latency:** a portal user DELETE only deprovisions via the sweep. Considered gating
    the sweep to cron; **rejected** — that would take deprovision-on-delete from 0 to ~45 min.
  - **DB constraints** (indexes, composite FKs, NOT NULL). ⚠️ **`entity_id` AND `department_id`
    must use `CHECK (… OR permission_level='admin') NOT VALID`, never plain NOT NULL** — the
    singleton admin (`ceo@parastrucks.in`, `c6faaf5c…`) has **both NULL**, and that NULL pair is
    the *active protection* keeping the ERP super-admin out of the sync's joins.
  - **ERP repo `integration/` holds two STALE sync copies** (156 + 127 lines vs live 285) and
    `README.md:46-47` documents the copy direction as ERP→portal — following that runbook would
    overwrite the live EF with an ancestor. Delete or invert (needs owner approval).
  - `Jind` is an active PT outlet **missing from `BRANCH_BY_CITY`** — a Jind manager/executive
    given `hdh` would enter ERP scope and be skipped forever.


- **✅ Phase 9.7 SHIPPED to prod 2026-07-20** (PR #79 → `506d888`, Vercel READY, prod verified). The
  3 pre-existing prod bugs that rode it (1000-row cap, import null-erase, MBP blank dropdown) + R11
  are now fixed on prod. **Small remaining tail:**
  1. **✅ DONE 2026-07-21 — cover backfill on prod (8/8 generated).** Needed a **prod-only cutover gap**
     fixed first: the prod `brochures` bucket's **allowed MIME types was `application/pdf` only**, so
     every `image/webp` cover upload was rejected `400` by Storage (not RLS — signed upload URLs bypass
     it). Fix = add `image/webp` to the bucket's allowed MIME types (dashboard; additive, no code, no
     deploy). **Systemic, not backfill-only:** `uploadCoverBlob` swallows failures by design, so every
     *future* brochure upload would silently have produced no cover too. Staging was unaffected because
     the 2026-07-20 Storage repair copied prod's 4 **policies** but not **bucket settings**.
     See `memory/known_issues.md`.
  2. **✅ DONE 2026-07-21 — refreshed `docs/db/schema-current.sql` + `seed-reference.sql`** from prod
     (PG 17.6) with `pg_dump 18.4`, flags `--no-owner --no-privileges`, seed = the same 14 reference
     tables. Confirmed it hit the right DB: `sub_segment_id` 0→14, `catalog_assign_rules` 0→27,
     `cover_url` 0→1, families 44→**49**, `vehicle_catalog` 906→**1006**. **Method to reuse:** dump to
     a scratch dir first so the live `SYNC_SECRET` never enters the git working tree, scrub the
     `sync_erp_users` webhook `Authorization` header to `__REDACTED_ROTATE_SEE_RECONSTRUCTION__`, then
     sweep for residuals (raw JWTs / `sb_secret_` / long hex runs / any *other* `http_request` trigger)
     — PR #75 lesson: `gitleaks` misses this hex-in-JSON pattern.
  3. **On-phone Android Web-Share check** — owner opted to test the WhatsApp files→draft path
     directly on prod (couldn't be done from desktop; code verified correct by inspection — H4/H5 fixed).
- **✅ 🔗 ERP sales sync DEPLOYED **and synced** 2026-07-25** (PR #83 → `bc72d83`; EF live on the portal
  project, Vercel READY, prod 200). **4 sales users provisioned** into the ERP — verified on ERP prod:
  all four `tier=sales · func=sales · branch_id=null · source=portal · role_overridden=false` at
  **0 / ₹0 / terms_unlimited=false**, and the pre-existing 18 profiles unchanged (admin 2, gm 1,
  manager 3, executor 12; every manager/executor kept its branch). Both reconciles returned
  `created:4, updated:16, reactivated:0, deactivated:0, skipped:[]`.
  **How to run a sync yourself (no secret needed, it lives as a GH Actions secret):** the 30-min
  backstop cron `.github/workflows/sync-erp-users.yml` **in the ERP repo** has a `workflow_dispatch`
  with a **`dryRun` input** — `gh workflow run sync-erp-users.yml -f dryRun=true --repo parastrucks/erp-parastrucks`
  prints the full result JSON with zero writes. That is the way to bound a scope change before it lands.
  **⏭️ One thing left, owner-side:** **set their ceilings** in ERP → User Management → "Approval
  authority", or they stay inert. Proven inert, not assumed: `fn_can_authorize_terms` returns **false**
  for all four across 0/0, 2%, ₹60k and 2%+₹60k (strict false, not NULL). ⚠️ If an SSO click errors,
  suspect a **stale pre-cutover browser session** — full sign-out + sign-in for a fresh ES256 token.
- **✅ Post-9.7 provenance repair — NON-ISSUE (checked 2026-07-26):** prod `vehicle_catalog` has **0** null
  `price_circular`/`effective_date` across all 1006 rows. Nothing to re-stamp.
- **✅ Task A — localhost dev RESTORED 2026-07-26.** Local `.env` targets **staging** (`klpnhpnlotcbbovwswmq`)
  and `npm run dev` boots on `:3000` (staging EFs whitelist `http://localhost:3000`). **The catch that had
  silently broken login:** staging's **legacy** keys were disabled during the cutover rehearsal, but `.env`
  still held the legacy `anon` JWT → login failed *"Legacy API keys are disabled"*. Fix = `.env`
  `VITE_SUPABASE_ANON_KEY` → the staging **publishable** key (`sb_publishable_…`, public by design). **Do NOT
  add localhost to the prod project's `ALLOWED_ORIGINS`** (owner-rejected). ⚠️ The prod-creds backup file is
  named **`.env .prod .bak`** (spaces) and holds **DEAD** legacy `eyJ…` JWTs — useless post-cutover; get
  new-format keys from the dashboard.
- **Phase 9 residual hardening (9h/9i):** MFA, new-device email, active-sessions page,
  security-monitor cron, file-upload virus scan, PII encryption; plus process items. Untouched.
  Full specs in `docs/history/PORTAL_HISTORY.md` (Phase 9 programme).
- **✅ DONE 2026-07-23 — new-API-key cutover LIVE on prod; leaked `service_role` key retired & verified dead.**
  PR #81 → `portal` `1d9ba17` (CI green, Vercel READY, prod 200). 7-step cutover all executed: all 9 EFs
  redeployed with `--no-verify-jwt` (verify_jwt is CLI-flag-enforced — there is **no `supabase/config.toml`**);
  `USE_NEW_API_KEYS=true` set + redeploy forced fresh isolates (boot logs confirm `-> using NEW keys`); Vercel
  `VITE_SUPABASE_ANON_KEY` → `sb_publishable_…` (production target only; forced fresh build `dpl_DJgc4i`, verified
  bundle ships publishable, zero `eyJ` legacy JWTs); **legacy `anon`+`service_role` DEACTIVATED**. **Objective
  proven with the real credential:** leaked `service_role` JWT from git history (`3dcbd75`) → prod PostgREST
  **401** (was full `users` table). Fresh incognito login + catalog + Employees all pass with legacy off.
  ⚠️ Corrected: rollback is **NOT** instant (`Deno.env` snapshots at isolate boot → flip *and* rollback need a
  redeploy); the instant incident lever is **re-enabling legacy keys** (reversible). **Red-team (4 lanes + direct
  tests): no cutover blockers** — no dead-key code path, no external/DB caller depended on legacy, refresh is a
  pure GoTrue op (safe). Runbook/record: [[next-actions]], `known_issues.md`.
- **✅ Cutover bug-watch CLOSED** — all 9 EFs boot-log confirmed `-> using NEW keys`; privileged read + write
  paths proven on prod; leaked `service_role` dead (401); passive collector (Access Rules → Error Log tab)
  empty. Bug-watch memory retired. Failure signature if one ever appears: one EF 500/503 while others work →
  redeploy that ONE EF with `--no-verify-jwt`.
- **Post-cutover follow-ups:** ✅ **DONE 2026-07-26** — `adminLogoutUser` fixed (PR #87 → `4fd2718`; RPC
  `admin_revoke_user_sessions`); dead `VITE_SUPABASE_SERVICE_KEY` deleted from Vercel prod + both `.env` files.
  Remaining: optional `package.json` supabase-js caret bump to `^2.100.1`. ✅ RESOLVED: `SYNC_SECRET`
  git-history value proven DEAD (401) = the already-rotated V1, no rotation pending.
- **Open issues:** see `memory/known_issues.md` (e.g. C1 PII-read RLS). ✅ 2026-07-26: `next_proforma_number`/
  `next_financier_copy_number` anon-execute **CLOSED** (PR #86); `adminLogoutUser` 404 **FIXED** (PR #87).

---

## How to work here

**Stack constraints:** free tier of Supabase, Vercel (Hobby), Cloudflare. Hardening items are
tagged `[FREE]` / `[PAID]` / `[FREE-ALT]` in the history archive.

**Branching & deploy:**
- `portal` is the **production** branch (Vercel deploys from it). `main` is the unrelated public
  website — never merge the two.
- Label PRs/commits/branches with the sub-phase ID where relevant (e.g. `9c-ef-perimeter`).
- The portal moves **in parallel** with other work: `git pull` + read current source, branch off
  latest `origin/portal`, stage specific files (avoid `git add -A`), rebase before push.
- **After any push to `portal`, verify CI all-green AND the Vercel `portal` deploy = READY**
  before calling it done (`memory/feedback_verify_deploy.md`, `feedback_vercel_api.md`).
- Commit author is **Dhruv Bothra / ceo@parastrucks.in**, set locally per-repo (never global).
- **Another Claude session may be working in this SAME working tree.** Signals: untracked files you didn't
  create appear mid-session; `git status` changes between your own commands. Then: don't stash (a
  path-limited `git stash` of `.claude/settings.local.json` collided with a mid-turn rewrite and dropped 159
  of 165 permission entries), don't `npm install`, and never `git add -A` — stage specific files. After any
  push, tell the owner the other session must `git pull --rebase`.

**Environment:**
- Local `.env` targets **staging**; `.env.prod.bak` holds prod creds for prod-only operations.
  All `.env*` files are gitignored except `.env.example`.
- A **git worktree has no `.env`** (only `.env.example`) — copy the main checkout's `.env` in, or
  `npm run dev`/preview boots blank (the Supabase client throws on undefined `VITE_SUPABASE_URL`).
- Python is **not installed** — use Node.js or PowerShell for scripting.

**Backend gotchas (see `memory/project_edge_function_auth.md`):**
- All **9** Edge Functions deploy with **`verify_jwt: false`** (each runs its own stricter `verify()`). The nine: `verify-login`, `admin-users`, `admin-access-rules`, `admin-catalog`, `admin-tiv`, `log-error`, `service-jobs`, `erp-sso`, `sync-erp-users` — docs previously said 7/8; deploying fewer than all nine breaks the missed one at the key cutover.
- Locking down a `SECURITY DEFINER` RPC needs `revoke … from anon` **and** `from authenticated`,
  not just `from public` (Supabase grants EXECUTE to `anon` on function creation).
- **Never delete DB rows/columns/tables without explicit owner approval** (`memory/feedback_no_schema_deletion.md`).
- Supabase migrations were applied via `psql` through the Session Pooler (Supabase CLI `db push`
  needs Docker, not installed). The `supabase/migrations/` folder is **not** a full base — the
  canonical current schema is `docs/db/schema-current.sql`.
- **`supabase functions deploy` does NOT need Docker** (unlike `db push`). It prints
  `WARNING: Docker is not running` and deploys fine — verified 2026-07-25:
  `npx supabase@2.109.1 functions deploy <fn> --project-ref mmmxvjaavdtwlpcnjgzy --no-verify-jwt`.
  Watch the upload list: a function importing `_shared/*` must show **all** its assets going up
  (e.g. `index.ts` + `cors.ts` + `keys.ts`), otherwise the key path didn't travel with it.
- **The Supabase MCP is scoped to the ERP project only.** `execute_sql` etc. work against
  `cloghfqosoapqtltslrp` but return *"You do not have permission to perform this action"* for the portal
  project `mmmxvjaavdtwlpcnjgzy`. So **portal DB questions cannot be answered via MCP** — use a dry-run of
  the deployed code, the CLI, or the dashboard.
- **⚠️ ALWAYS `git pull --rebase` before touching a portal Edge Function.** On 2026-07-25 the checkout was
  2 commits behind `origin/portal` and the missing commit was `1d9ba17` (`_shared/keys.ts`); deploying
  from that stale tree would have shipped the **dead** legacy `SUPABASE_SERVICE_ROLE_KEY` read and
  silently broken portal→ERP sync. This is the difference between a working and a dead function.
- **`source='local'` does NOT shield an ERP profile from `sync-erp-users`** (corrected 2026-07-26 — the
  opposite was in memory and was wrong). The EF matches `byPortalId.get(portal_id) ?? byEmail.get(email)`
  and **`byEmail` is built from ALL profiles with no `source` filter**. On a hit it overwrites
  `full_name`/`email`/`is_active`, stamps `source='portal'` + `portal_user_id`, and unless `role_overridden`
  also rewrites `tier`/`func`/`branch_id` — so a hand-made ERP admin gets adopted and demoted, not skipped.
  What actually protects the two admin rows (`ceo@`, `ceo.hr@`) is the query's `!inner` joins on
  entities/departments/user_brands, which exclude a portal user with no department or no brand row.
  `role_overridden` guards only tier/func/branch.

**Design/verification habits:**
- CSP is enforced from the header on the **document** — verify by curling real page URLs (`/`,
  `/login`), not by reading `vercel.json`.
- When offering design options, span the real solution space including non-obvious architectures
  (`memory/feedback_mece_innovation.md`).
