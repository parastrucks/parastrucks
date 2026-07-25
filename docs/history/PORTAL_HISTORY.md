# Paras Portal — Master History Archive

> **What this is:** the complete, permanent record of the Paras Trucks & Buses team
> portal (`team.parastrucks.in`) — every phase, the Phase 9 security programme, and
> dated session logs. It is the single place the *entire backstory* lives.
>
> **When to read it:** only when you need the full history of a decision or phase, or
> to append a new session record. **Do not read it at session start** — the lean
> `CLAUDE.md` + the memory index carry the current state. This file is deliberately
> kept out of the always-loaded path.
>
> **How it's maintained:** when a piece of work ships, append a dated entry to the
> "Session & change log" at the bottom; leave the earlier sections as the frozen record.
> Nothing here is deleted — it is the archive.
>
> For *rebuilding* the system from scratch (schema, EFs, config, seed data), see the
> companion blueprint [`docs/RECONSTRUCTION.md`](../RECONSTRUCTION.md).

---

## Table of contents

1. **[Phase-by-phase log](#part-1--phase-by-phase-log)** — chronological build record, Phase 1A → 9.5 (+ Phase 10 planned).
2. **[Phase 9 security programme](#part-2--phase-9-security-programme-full-record)** — the full VAPT remediation plan (v2), the T1–T20 hardening catalog, the 9a–9i sub-phase roadmap, post-deploy re-test findings, and session handoffs. (Archived verbatim from the pre-reorg `CLAUDE.md`.)
3. **[Session & change log](#part-3--session--change-log)** — dated records of individual work sessions.

---

## Part 1 — Phase-by-phase log

*(Verbatim from `memory/phase_status.md` as of the 2026-07-04 documentation reorg. This
is the canonical phase completion record; the memory copy is kept trimmed to current state.)*

**Phase 1A — COMPLETE**
- Login, Dashboard (role-based tool grid filtered by canAccess), Profile (password change, sign out)
- Employees CRUD (HR/Admin only): create auth user + profile, edit, deactivate/activate, delete, password reset
- All employee operations use `supabaseAdmin` (service role) to bypass RLS where needed

**Phase 1B — COMPLETE**
- Quotation tool (/quotation): fuzzy vehicle search (Fuse.js), segment filter, line items, qty/price editing, TCS@1%, RTO tax, insurance, grand total
- My Quotations (/my-quotations): history per user, re-download any PDF (full customer data restored)
- Quotation Log (/quotation-log): admin-only, all quotations across all users, search by customer/number/user, re-download
- PDF generator (pdfGenerator.js): AL logo, entity stamp (33x22mm), 4-col vehicle table, 9 standard terms
- Vehicle catalog: 815 AL vehicles seeded from AL_Vehicle_Price_List_Sep2025.xlsx

**Phase 1C — COMPLETE**
- Bus Calculator (/bus-calculator): 87 AL bus cowl chassis, 5-step estimator (chassis > body > AC > extras > summary)
- Vercel deployment: team.parastrucks.in, auto-deploy from `portal` branch
- vercel.json: no-cache for HTML, immutable for /assets/* (hashed filenames)
- Access Rules (/access-rules) — admin-only, 3 tabs:
  - Tab 1: multi-dimensional access rules (route x permission_level x brand x location x department x role)
  - Tab 2: User Permissions — assign brand/location/department/vertical per user
  - Tab 3: Configuration — manage Brands / Roles / Locations / Departments reference tables

**Phase 2 — Multi-entity / multi-brand (AL complete)**
- DB: `entities` table (PTB Gujarat, PT Haryana), `operating_units` (16 units), quotation numbering RPC
- Entity-aware quotation flow, PT-specific PDF differences (jurisdiction, payment line, stamp)
- Remaining: HDH/Switch quotation formats (different from AL, no design yet), Vehicle Catalog page CRUD

**Phase 3 — Vehicle Catalog + Brochures (COMPLETE, 2026-04-05)**
- AdminCatalog (3 tabs: Vehicles, Sub-Segments, Import) + SalesCatalog (segment cards, brand-filtered)
- `sub_segments` table, brochure storage bucket, brand-aware throughout

**Phase 4 — COMPLETE (2026-04-09, PR #17)**
- 4A: Email-based login (replaced username), 4B: TIV Forecast tool (v2.1 champion model)

**Phase 5 — Security & hardening (COMPLETE, 2026-04-14)**

*All 12 code units shipped:*
- **EF migration (PR #1):** 5 admin EFs + `log-error`. `callEdge()` raw fetch wrapper. Zero service-role-key in client.
- **U1:** RLS audit on all public tables.
- **U2:** CSP/HSTS/X-Frame-Options in `vercel.json`.
- **U3:** Catalog hardening (magic-byte, size, debounced Fuse.js, narrow select).
- **U4:** ErrorBoundary, React.lazy routes, window.onerror/unhandledrejection, Dashboard null-safety.
- **U5:** Error log UI (fire-and-forget + AccessRules 4th tab, admin-only).
- **U6:** PDF hardening (defensive destructure, module-level logo/stamp cache).
- **U7:** QuotationLog (re-download guard, server-side pagination 25/page, PDF spinner).
- **U8 (PR #35):** Login hardening — verify-login EF (lockout + Turnstile + remember-me). Custom storage adapter (localStorage/sessionStorage). `callEdgePublic` unauth helper.
- **U8 hotfix (PR #36):** verify-login success-path crash fix (`.catch()` -> `try/catch`); tab-switch re-render cascade fix (`accessRulesEqual` shallow diff before `setAccessRules`).
- **U9:** Per-user fixed-window rate limiting (60/min, 120/min for log-error). Atomic `rate_limit_hit()` plpgsql.
- **U10:** Editable line-item description + quotation search debounce.
- **U11:** Employees narrow select + MyQuotations PDF spinner.
- **PR #34:** Eager Dashboard+Login imports, RPC rate-limit, Catalog spinner BEM fix.

*Manual config (DONE as of 2026-04-13):*
- JWT expiry set to 43200 (12 hours)
- Min password length set to 10
- Leaked-password protection: NOT available on Supabase free plan (skip)
- Turnstile: LIVE — `VITE_TURNSTILE_SITE_KEY` in Vercel, `TURNSTILE_SECRET` in Supabase EF secrets

*Polish shipped (2026-04-14, on portal as `feat(polish): Phase 5 polish + AuthContext dedup`):*
- `useAsyncAction` hook (C2) — unified loading/error state
- `ToastProvider` + `useToast()` (E1) — replaces inline alerts
- `<Skeleton>` component (E2) — shimmer placeholders
- `htmlFor`/`id` on all form labels (E3) across Employees, Profile, Quotation, AccessRules, Catalog
- `useFocusTrap` hook (E4) — Tab/Shift+Tab cycle, Escape, focus restore on modals
- **AuthContext dedup:** `loadingForRef` in-flight guard + functional `setProfile`/`setAccessRules` with shallow-diff helpers — prevents triple-fetch on INITIAL_SESSION+SIGNED_IN and skips re-render cascade when unchanged.

**Phase 2 — REMAINING (no timeline)**
- HD Hyundai (HDH) quotation format — completely different from AL; design + catalog not available yet
- Switch Mobility quotation format — completely different from AL; design + catalog not available yet
- Vehicle Catalog page (/catalog): admin CRUD for vehicle_catalog table (currently "Coming Soon")

**Phase 6a — COMPLETE (2026-04-16, PR #37 squash-merge, commit c9f0f61)**

UI/UX polish, no DB changes. Ships in parallel with 6b (independent tracks).

- **P0 #1 MRP mobile dropdown** — stacked grid at <560px, 48px tap target, dvh for iOS keyboard safety
- **P0 #2 Quotation line items cards** — card layout at <960px, aligned with sticky price rail's return breakpoint; absolute-positioned × for linear keyboard tab flow
- **P0 #3 Bus Calculator DDAC=NAC pricing** — AC_REF constant change in `src/pages/BusCalculator.jsx:98`. DDAC chassis have bracket only (no compressor), so retrofit BOM matches NAC. **Operational:** verbal DDAC quotes in-flight on deploy day became stale. 12m DDAC bus went ₹3.75L → ₹5.25L prefilled AC.
- **P1 #4 Terminology sweep** — UI labels aligned with `memory/terminology.md`; 21-line header comment in `src/context/AuthContext.jsx` documents DB↔UI inversion; Profile/Employees column headers use product-owner terms
- **P2 #5 Breakpoint convention** — 560 / 768 / 960 documented in `src/index.css`
- **P2 #7 Touch target + safe-area** — 44px min-height on `.btn`/`.form-input`/`.form-select` below 900px; `viewport-fit=cover` in `index.html`; `.bottom-nav` grows into iOS home-bar via `env(safe-area-inset-bottom)`; `.app-main` padding follows in lockstep
- **P2 #8 Responsive-table convention** — documented as CSS comment in index.css; existing `{scope}-desktop-table`/`{scope}-mobile-cards` pattern (line-items at 960, catalog at 700) preserved

**Skipped:** P2 #6 `<Sheet>` primitive — no current caller, flagged for when a real use case appears.

**Phase 6b — COMPLETE (2026-04-16)**

DB schema restructure (additive migration — Stages 0 + 1 of the original 5-stage plan). Full plan at `C:\Users\91963\.claude\plans\declarative-tumbling-pike.md`. Summary in `phase_6b_plan.md`. The original "Stages 2–4" (app cutover, verification, cleanup) are now **Phase 6c** — a distinct phase because the app-layer work is independent of the additive DDL.

- **Stage 0 — COMPLETE (2026-04-16)** — pre-migration user purge. Deleted 3 non-admin users + 1 non-admin quotation. Sole surviving row: Dhruv Bothra (admin, `c6faaf5c-68c2-4f27-9a79-b590fb4788ce`).
- **Stage 1 — COMPLETE (2026-04-16, PR #38 squash-merge, commit `28327e6` on portal)** — additive migration applied to prod via MCP `apply_migration`. File `supabase/migrations/20260416_phase6b_stage1_additive.sql`. Added: UUID ids on entities/brands/departments; GM pointer FKs on entities; 5 new ref tables (outlets 8, outlet_brands 16, sales_verticals 8, back_office_subdepts 3, designations 33); 6 new FK cols on users (admin backfilled to permission_level='admin'); `users_single_admin` partial unique index; 4 empty join tables (user_brands/user_sales_verticals/user_outlets/user_profiles) with provisional RLS; additive nullable FK cols on access_rules; `quotations.brand_id NOT NULL` (12 backfilled to AL); `vehicle_catalog.brand_id NOT NULL + sales_vertical_id` (906 backfilled via VERTICAL_SEGMENTS map: buses 139, icv_trucks 311, long_haulage 307, tipper 149); 7× `tiv_forecast_*` tables got `entity_id + brand_id NOT NULL` backfilled to PTB/AL (skipped trigger_state + upload_history). **Departments renamed** "Spare Parts"→"Spares"; Admin marked inactive; Back Office + PDI inserted. Brand stays globally-keyed (3 rows), entity ownership via `user_brands + users.entity_id`. App still reads OLD columns — no behavior change.

**Phase 6c — COMPLETE (2026-04-17, PRs #39–43)**

Full app cutover + legacy column drop + business-table RLS. The entire 6b/6c arc is done.

- **6c.1 — app cutover (PR #39, 4 commits, merged 2026-04-16):**
  AuthContext.ruleMatches → 4-axis; 61 access_rules seed (now 62 after PTB HR Manager rule added during smoke test); Employees.jsx cascading-dropdown rebuild + join-table population; AccessRules.jsx 4-tab rewrite (Rules / Entities GM / Config / Errors); Catalog SalesCatalog → user_brands + user_sales_verticals; Profile/Sidebar/BottomNav/Dashboard migrated to new columns; all 6 EFs updated.
- **6c.3 — cleanup (PR #39 commit 4, same session):**
  `current_user_role()` rewritten to `permission_level + departments.code`; `quotations.entity_id` FK added + `quotations.entity` text dropped; users dropped `role/vertical/brand/department/designation/entity`; access_rules dropped `role/brand/location/department`; `error_log admin read` policy rewritten; NOT NULL tightened on new axes; business-table RLS (quotations, vehicle_catalog, tiv_forecast_* × 7, users) with helper functions `is_hr_same_entity`, `has_user_brand`, `has_user_sales_vertical`.
- **Hotfixes (PRs #40–43):** CSP Turnstile (PR #40), tab-switch auth dedup (PR #41), focus-trap keystroke fix (PR #42), entity-scoping + brand filtering (PR #43). All merged.
- **6c.2 — verification window (in progress, 2026-04-17 → 2026-04-23):** Remote trigger fires 2026-04-23 ~9am IST with verification SQL checklist. 3 users in prod (admin + PTB HR Manager + PTB BO Manager). Smoke test partially complete — quotation create + catalog view still pending.

**Phase 7a — COMPLETE (2026-04-17, PRs #45 + #46 + #47)**

6 bundled UX/TIV fixes shipped as three PRs:

- **PR #45** — Core fixes (Fix 1–3):
  - Fix 1: Quotation line-items → cards-only on all screen widths (deleted desktop table block ~112 lines in Quotation.jsx + responsive CSS flip in index.css)
  - Fix 2: CBN number removed from customer PDF (`item.description` only in Particulars column)
  - Fix 3: Segment rename "MBP Truck" → "Long Haul Trucks" (vehicle_catalog data UPDATE + Quotation.jsx + Catalog.jsx + scripts/apply_apr2026_prices.cjs)

- **PR #46** — TIV fixes (Fix 4–6):
  - Fix 4: Jun-26 total row — colSpan mismatch fixed; judgment months now span 2 columns in total row
  - Fix 5: JUDG column color stays amber (cosmetic, cells were never editable — just looked it)
  - Fix 6: UploadPanel entity+brand selector; admin-tiv v8 requires explicit entity_id+brand_id (no auto-inject)

- **PR #47** — Sub-segment CBN visibility in Catalog:
  - Edit mode: shows which CBN numbers are included in the sub-segment (chip tags)
  - Add mode: shows unallocated CBNs only (client-filtered); admin can select CBNs to assign at creation time

**Phase 8 — COMPLETE (2026-04-18, PR #52, commit 218dc58 on portal)**

- `financier_copies` table + `next_financier_copy_number()` RPC (FY-based: FC-PTB-2026-27-0001, rolls 1 April).
- `fc_serial_counter` + `fc_counter_fy` columns on entities.
- 6 access_rules: `/financier-copy`, `/my-financier-copies`, `/financier-copy-log` × GM × PT/PTB. No executive/manager access.
- RLS insert: admin OR (back_office dept AND permission_level in admin/gm).
- 3 pages: FinancierCopy.jsx, MyFinancierCopies.jsx, FinancierCopyLog.jsx (mechanical clone of PI).
- `generateFinancierCopyPdf()` — title "TAX INVOICE", italic "(Financier's copy)" above AL logo, `FC No:` label.
- Dashboard compacted: flat 11-card grid → GROUPS (3 collapsible group cards) + UNGROUPED_TOOLS (5 flat cards).
  GroupCard: primary Link + chevron button (sibling, not child) → dropdown for My/Log. Outside-click + Escape close.
- Rebased onto portal HEAD (includes PR #50 RLS hotfix + PR #51 employees/autoPort fix). Clean, no conflicts.

**Phase 7b — COMPLETE (2026-04-18, PR #48 + PR #49 + PR #50)**

- `proforma_invoices` table + RLS (mirrors quotations) + `next_proforma_number(entity_id uuid)` RPC. Format: PI-PTB-2026-0001 (calendar year, separate counter).
- 18 access_rules rows: `/proforma-invoice`, `/my-proformas`, `/proforma-log` — BO only (no Sales).
- ProformaInvoice.jsx: batch creation — default vehicle + N chassis/engine rows with optional per-row vehicle override. Editable description per row.
- MyProformas.jsx + ProformaLog.jsx: history/log mirroring quotation pattern; log search includes chassis_no + engine_no.
- generateProformaPdf(): quotation layout + "PROFORMA INVOICE" title + chassis/engine as bold sub-row under model description. Address wrapping fixed with splitTextToSize.
- PR #49: 5 post-deploy fixes (bold chassis/engine, address wrap, editable Particulars, same-entity users visibility for Prepared By, TIV total row judgment column alignment).
- PR #50 (hotfix): RLS infinite recursion fix — `get_my_entity_id()` SECURITY DEFINER function replacing inline subquery that caused login 500s.
- `get_my_entity_id()` function now in DB: `select entity_id from public.users where id = auth.uid()` wrapped in SECURITY DEFINER.

**Phase 8b — FC PDF tax-invoice redesign — COMPLETE (2026-04-23, PR #55, squash-merged to portal as commit `58b083c`)**

V2 Financier's Copy PDF in Indian tax-invoice format. Backward-compatible via `pdf_format_version` dispatcher — 8 pre-migration rows backfilled to v1 re-download through the preserved V1 generator (`generateFinancierCopyPdfV1`); new saves always v2.

- **New utils:**
  - `src/utils/gstUtils.js` — `IN_STATE_CODES` (38 entries), `panFromGstin`, `stateCodeFromGstin`, `stateNameFromCode`, `deriveTaxType` (intra vs inter from seller/buyer GSTIN first-2), `splitGst` (per-head rounding for intra; single-round for inter).
  - `src/utils/amountInWords.js` — `inrInWords(rupees)` Indian numbering (Crore/Lakh/Thousand).
- **pdfGenerator.js:** renamed existing generator to `generateFinancierCopyPdfV1` (untouched); added `generateFinancierCopyPdfV2` with dynamic columns per regime (hard-coded mm widths — intra 10 cols sum 182mm: `9|36|16|8|22|14|22|14|22|19`; inter 8 cols sum 182mm: `9|52|20|8|25|14|25|29`); added `buildFinancierCopyPdfArgs(row, entity, entityCode, preparedBy)` reconstructing args for re-downloads; exported dispatcher `generateFinancierCopyPdf(data)` routing by `data.pdf_format_version ?? 2`.
- **Taxable calc:** MRP input is GST-inclusive → `taxable = Math.round(mrp / 1.18)`; line-item `total = taxable + cgst + sgst + igst` (reconciles to original mrp ±1₹ rounding drift).
- **FinancierCopy.jsx:** `hsn: ''` on each model chip + HSN text input; optional "Ship to a different address" checkbox (GSTIN length validated; state optional); per-batch precompute of `sellerStateCode`, `taxType`, `buyerStateCode`, `customerPan`; persists V2 columns (`ship_to`, `tax_type`, `seller_state_code`, `buyer_state_code`, `amount_in_words`, `customer_pan`, `pdf_format_version: 2`) and per-line `hsn` + full tax breakdown in `line_items` JSONB.
- **MyFinancierCopies.jsx / FinancierCopyLog.jsx:** SELECT adds V2 columns; replaced manual arg construction with `buildFinancierCopyPdfArgs()`. Re-downloads of v1 rows still print the original 4-column layout (audit integrity).
- **DB migration** `fc_tax_invoice_redesign_v2`: 6 nullable columns + `pdf_format_version SMALLINT DEFAULT 2`; 8 pre-migration rows backfilled to v1 inline.
- **PDF polish:** headers center-aligned via `headStyles.halign: 'center'`; Bill-To/Ship-To blocks suppress GST/PAN/State rows for walk-in customers (no GSTIN); stamp stacked above signature line with explicit gaps; customer + authorised signature lines share baseline; T&C 3 lines (entity jurisdiction + 18% interest + chassis-not-returned); `(Financier's copy)` → `(Finance copy)`; `G Total` → `Grand Total`; `Total` col header → `Total Amt`.
- **Smoke test 21/21 passed:** intra/inter/walk-in/ship-to/multi-HSN/amount-in-words edge cases/re-download v1+v2 round-trip; DB row inspection confirms all V2 columns + per-line hsn/tax keys populated.

**TIV Forecast hotfixes (2026-05-01, direct-to-portal, no PR)**
- `a2e313e` — `src/tiv-forecast/components/UploadPanel.jsx`: entity dropdown was empty because the query selected `entities.name` (column was renamed to `full_name` during Phase 6c.3 terminology flip). PostgREST returned an error object that the `.then()` discarded silently. Fixed select+order to `full_name`; option label now `{e.full_name} ({e.code})`; added `console.error` on error branch so future silent failures surface.
- `eb481c6` — `src/tiv-forecast/lib/forecastEngine.js`: `computeForecastMonths()` used to start at `lastDataMonth + 1`, so once the current month elapsed without an upload the first column became a nowcast. Now starts at `max(lastDataMonth + 1, currentMonth + 1)` while preserving the *true* horizon value (skipped months still increment `horizon`) so `dampedTrendSum(horizon)` math stays correct. Example: Mar-26 actuals viewed in Apr-26 → forecast starts May-26 with `horizon=2`, not horizon=1.
- Both deployed to Vercel prod via `npx vercel --prod --yes` from main worktree on 2026-05-01.

**TIV current-month fix (2026-05-14, PR #56, `1a2ecaa` on portal)**
- `fix(tiv): always show current month in forecast horizon` — forecast now anchored at `currentMonth` (was `currentMonth+1`), reversing `eb481c6`. File `src/tiv-forecast/lib/forecastEngine.js`.

**Phase 9 — Security & Hardening (9b–9g) — DEPLOYED TO PROD 2026-05-17/18 (PR #57 `421259b`, PR #58 `b9cce59`, #59 `bf2553e`, #60 `9e76199`)**
- Shipped to prod: PR #57 (9b–9g security & hardening) + #58 (CSP root-path fix) + #59 (catalog brand_id) + #60 (date UTC-rollback). Staging Supabase `klpnhpnlotcbbovwswmq` exists. Migrations applied to prod via `psql`; all EFs redeployed. Full record in CLAUDE.md. 9h/9i (further hardening) untouched.

**Catalog bulk-import brand_id fix (2026-05-18, PR #59, `bf2553e` on portal)**
- `fix(catalog): set brand_id on xlsx bulk-import rows` — `processFile` resolves `brand_id` from `brands` by code so UI bulk-import no longer hits the `vehicle_catalog.brand_id` NOT NULL constraint. Frontend-only; auto-deploys on portal push. See `known_issues.md`.

**Phase 9.5 — Vendor Jobs (outside-workshop & ancillary job tracker) — DEPLOYED TO PROD 2026-06-28/29 (PRs #61–#67)**
- New feature at route `/vendor-jobs` (label "Vendor Jobs"). Tables `service_vendors`/`service_jobs`/`service_job_events`; RPC `create_service_job()`; helper `is_manager_or_above()`; 12 `access_rules`; EF **`service-jobs`** (the 7th EF, `verify_jwt:false`, prod **v3** / staging v8); migration `20260625_phase95_service_jobs.sql`. Lifecycle: po_generated→work_completed→invoice_received + parallel payment/settlement; ancillary-warranty caps at work_completed. Role model: create=all portal users (**vendor required**); advance-to-work_completed=any portal user incl. executive; advance-to-invoice_received/warranty-approve/convert/cancel=manager+; payments=accounts; undo=gm/admin. UI: role-aware `Needs you | All jobs | Overview` home (Overview tab for manager/gm/admin; admin lens previews other roles; GM undo feed). All 5 roles verified live on staging. Detail in CLAUDE.md "Phase 9.5 — Deployment Record" + `phase95_service_tracker.md`.
- **Post-launch fixes:** #63 (`62799f4`) Overview→top-level tab + manager Needs-you advancement buckets + exec advance-to-work_completed + lens custom dropdown (EF v2); #66 (`7270771`) **vendor compulsory for a new job/PO** — form `required` + EF `createJob` guard (EF v3; `vendor_id` stays nullable so existing rows untouched); #67 (`c648b4f`) **security fix** — revoked `anon` EXECUTE on `create_service_job()` (was anon-callable despite the migration; Supabase grants EXECUTE to anon on function-create and `revoke from public` doesn't remove it). Prod read-only audit 2026-06-29 = clean apart from that gap (see `project_edge_function_auth.md` + `known_issues.md`).
- **Deps/CI cleanup (PR #62 `39f1dff`, #64 `9b6f610`):** `npm audit fix` + vite 5→8/plugin-react 4→6 → `npm audit` 0 vulns; trivy-action pin fixed (`@0.24.0`→`@0.35.0`); **security workflow now fully green**. xlsx CDN-tarball pin preserved (never `audit fix --force`).

**Session 2026-07-04 — Employee brands for Service/Spares + prod backfill + bus-calc sticky fix**

- **Service/Spares brands — DEPLOYED TO PROD (PR [#69](https://github.com/parastrucks/parastrucks/pull/69), squash `49e93ad`, Vercel `portal` deploy confirmed complete, CI 9/9 green).** `src/pages/Employees.jsx` only (client-only): Service AND Spares employee sections now render a **required `Brands *`** MultiCheckbox (`svc-brands`, was Sales-only). `validateForm` requires ≥1 brand for service/spares; create+update payloads send `brand_ids` for `DEPT_SERVICE`/`DEPT_SPARES`. No EF/migration change — the `admin-users` EF already writes `brand_ids`→`user_brands` generically (no dept filter, index.ts:272 create / :409 update); edit modal pre-loads `brand_ids` dept-agnostically (index.ts:231) so editing existing service/spares users preserves brands. Verified: Vite transform clean; live desktop + mobile behaviour (below).
- **Prod brand backfill — DONE (via `.env.prod.bak` service_role key → prod `mmmxvjaavdtwlpcnjgzy` REST API; dedup-safe `Prefer: resolution=ignore-duplicates`).** So no existing service/spares user is left brand-less and blocked by the new required gate. IDs: PTB entity `01766dbc-7d85-4a2f-93c3-e06a0afc1f33`, PT entity `e541f8b6-0517-46b8-9ab7-a3c4f1519006`; brands GLOBAL (no entity_id col) — AL `1e7ab9db-…`, HDH `f7ecf25c-…`, Switch `2fa7b909-…`; service dept `a7fa19a5-…`, spares dept `03801804-…`.
  - **PTB Service (5, all had 0 brands) → AL:** Darshan Patel `c7deaf88…`, Manoranjan Kumar `88073bdf…`, Thomas Christian `de506d7e…`, Umesh Rathod `f215fb33…`, Yash Mistry `1f026d1f…`. (PTB has 0 Spares staff.)
  - **PT Service (only 1 PT employee total) → AL + HDH + Switch:** Jitendra Arora `21178f70-1794-4f97-b905-ec3c5360ad04`.
  - Both verified via re-read. Prod real usage NOT otherwise touched.
- **Bus Calculator sticky estimate card — DEPLOYED TO PROD (PR [#71](https://github.com/parastrucks/parastrucks/pull/71), squash `bbb9e16`, Vercel `portal` deploy confirmed, CI 9/9).** Symptom: right-side estimate/summary card didn't stay pinned on scroll. Root cause: `.bc-sum-panel` had `position:sticky;top:80px` but sat in a bare wrapper grid item, and `.bc-layout{align-items:start}` shrink-wrapped that wrapper to the panel's height → zero travel room. Fix (`src/pages/BusCalculator.jsx` + `src/index.css`): wrapper got class `.bc-sum-col` + `align-self:stretch` **inside the existing `@media (min-width:960px)` block only**. Verified live on staging 1280×900 (col stretches to 2117px vs 304px panel → sticky, `position:sticky`+`align-self:stretch` computed) AND 375px mobile (mq inactive, panel `position:static`, `align-self:auto`, single-column grid, stacked below form — **mweb identical to pre-fix, no harm**).
- **gitignore `.env*` — DEPLOYED TO PROD (PR [#70](https://github.com/parastrucks/parastrucks/pull/70), squash `f8de64b`, merged to `portal`).** `.gitignore` broadened from `.env`+`.env.local` to `.env*` + `!.env.example`, because the local prod-creds backup `.env .prod .bak` (holds a live prod service_role key) matched neither pattern → untracked-but-not-ignored (a `git add -A` could have staged a prod secret). Verified via `git check-ignore`.
- **`.env` decision (owner Q): keep pointed at STAGING, do NOT revert to prod.** Per CLAUDE.md Task A (post-2026-05-22 laptop migration): localhost dev must run against staging because prod EF `ALLOWED_ORIGINS` only whitelists `team.parastrucks.in` and owner rejected whitelisting localhost on prod. The `.env.prod.bak` (URL `mmmxvjaavdtwlpcnjgzy` + valid service_role JWT) IS the "prod copy kept aside" for occasional prod work — used it for the backfill without disturbing the working staging `.env`. The staging `VITE_SUPABASE_SERVICE_KEY` in `.env` is stale/invalid but the client doesn't use a service key (EFs do; `.env.example` intentionally dropped it) so it's harmless.
- **Worktree gotcha:** the git worktree (`.claude/worktrees/…`) has NO real `.env` (only `.env.example`), so `npm run dev`/preview there boots BLANK (supabase client throws on undefined `VITE_SUPABASE_URL`). Fix: `cp` the main-checkout `.env` into the worktree (it's gitignored). Done this session so the preview harness worked.
- **PARKED by owner (do later, item "#2"):** (a) delete the dead/invalid `VITE_SUPABASE_SERVICE_KEY` line from `.env` (tidiness only); (b) rotate the prod `service_role` key now that it was used in a shell session (aligns with T4 90-day rotation). Neither blocks anything.
- **DEPLOY COMPLETE (2026-07-04):** PR #70 (`f8de64b`) + #71 (`bbb9e16`) both squash-merged to `portal`; Vercel prod deploy on portal HEAD `bbb9e16` = `Deployment has completed`, combined commit status `success`. Nothing outstanding this session except the owner-parked item #2 (delete dead `.env` service-key line; rotate prod service_role key).

---

## Part 2 — Phase 9 security programme (full record)

*(Archived verbatim from the pre-reorg `CLAUDE.md`, 2026-07-04. This is the complete
Phase 9 VAPT remediation plan v2, the T1–T20 industry-hardening catalog, the 9a–9i
sub-phase implementation roadmap, the post-deployment VAPT re-test findings, and the
2026-05-02 session handoff. The live `CLAUDE.md` was slimmed to an operational core;
its full historical content is preserved here.)*

# Parastrucks — Project Memory

> **Current website phase:** Phase 9 (9b–9g) **DEPLOYED 2026-05-17/18**, and
> **Phase 9.5 — Vendor Jobs (outside-workshop & ancillary job tracker) DEPLOYED to
> production 2026-06-28/29** (PRs #61–#64; route `/vendor-jobs`, EF `service-jobs` prod v2).
> See "Phase 9.5 — Deployment Record" below. The Phase 9 residual deps are also now
> cleared (vite 5→8 + `npm audit fix` → `npm audit` reports 0 vulnerabilities; CI fully green).
> Next engineering work is **9h** (medium-effort hardening: MFA, new-device email,
> active-sessions page, security-monitor cron, file-upload virus scan, PII encryption)
> and **9i** (programme/process items). Both are untouched. See the roadmap at the bottom.
>
> **Naming convention:** label PRs / commits / branches with the sub-phase ID (e.g. `9b-deps`, `9c-ef-perimeter`). Future website phases should be `Phase 10`, `Phase 11`, etc.
>
> **Stack constraints:** Free tier of Supabase, Vercel (Hobby), Cloudflare. Hardening items are tagged `[FREE]`, `[PAID]`, or `[FREE-ALT]`.

---

## Next Actions — START HERE

> Maintained as the single source of truth for "what to do next". Update this list
> as items are completed (move them to a deployment record) or added.

### Task A — Restore localhost development on the current laptop

**Context:** Laptop was migrated (2026-05-22). Production (`team.parastrucks.in`) works
on the new machine, but `npm run dev` on `http://localhost:3000` fails with a **CORS
error** — the prod Supabase Edge Functions' `ALLOWED_ORIGINS` only whitelists
`https://team.parastrucks.in` (Phase 9c hardening, working as designed).

**DO NOT add `localhost` to the PROD project's `ALLOWED_ORIGINS`** — explicitly rejected
by the owner as a production risk. Use the staging project instead:

- [ ] Point local `.env` at the **staging** Supabase project `klpnhpnlotcbbovwswmq`
      (`paras-portal-staging`, Mumbai) — update `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_SUPABASE_SERVICE_KEY` to staging values. Keep a prod `.env` copy aside for the
      rare case prod testing is needed.
- [ ] On the **staging** project only, set Edge Function secret
      `ALLOWED_ORIGINS=http://localhost:3000` (add the staging site URL too if one exists).
- [ ] Confirm `npm run dev` → `http://localhost:3000` → login works with no CORS error.
- [ ] Note: Vite dev port is 3000 (`vite.config.js` `server.port`); if it ever starts on
      5173, align the `ALLOWED_ORIGINS` value or set `PORT=3000`.

### Task B — Phase 9 residual hardening

- [x] **CVE overrides / npm-audit — DONE (2026-06-29).** Resolved in stages: (1) `postcss`
      + `dompurify` `overrides` block hand-added (commit `6670d00`); (2) `npm audit fix`
      (no `--force`) patched ws/babel/dompurify/react-router (PR #62, `39f1dff`); (3) vite
      `5.4.21`→`8.1.0` + `@vitejs/plugin-react` `4`→`6` cleared the last dev-server-only
      esbuild/vite advisories (PR #64, `9b6f610`). `npm audit` now reports **0 vulnerabilities**.
      The `xlsx` CDN-tarball pin was preserved throughout (explicit installs, never
      `audit fix --force`). Also fixed the broken `trivy-fs` CI job (yanked
      `aquasecurity/trivy-action@0.24.0` → `@0.35.0`). **The `security` workflow is now fully green.**
      Note for future dep work: vite 8 needs node `^20.19 || >=22.12` (CI node 20.x + Vercel 22.x both satisfy).
- [ ] **9h — medium-effort feature hardening** (each its own PR, do not bundle):
      9h-1 MFA for admin/HR · 9h-2 new-device email (Resend) · 9h-3 active-sessions page ·
      9h-4 security-monitor cron · 9h-5 file-upload virus scan · 9h-6 PII encryption.
      Full specs in the "9h" roadmap section below.
- [ ] **9i — programme/process items** (T14–T20): not engineering work — calendar
      reminders, docs, vendor scheduling. See the "9i" section below.

### Optional cleanup (from the Phase 9 deployment)

- [x] **Stale git branches + worktree — DONE (2026-06-29).** All 28 merged-PR feature
      branches deleted from origin; the `claude/elated-volhard-c88b85` branch (and the
      leftover `vibrant-williams-74d295` worktree) removed; stale PR #18 (TIV Forecast UX,
      from April, superseded) closed. Remote now has only `main` + `portal`.
- [ ] Remove local dump artifacts once prod is confirmed stable: `prod_schema.sql`,
      `prod_seed_data.sql`, `staging_apply.sql`, `prod_backup_pre_phase9_*.sql` (if still present locally).

---

## Phase 9 — Deployment Record (9b–9g)

**Shipped to production 2026-05-17 → 2026-05-18.** All Critical/High/Medium VAPT
findings remediated, verified end-to-end on a dedicated staging Supabase project
before prod (9/9 functional tests + prod-build console-strip check, zero regressions).

**PRs merged to `portal`:**
- **#57** (`421259b`) — Phase 9 stack 9b–9g (one commit per sub-phase).
- **#58** (`b9cce59`) — `fix(csp)`: `vercel.json` header `source` `/:path*` → `/(.*)`. The
  `/:path*` pattern never matched the bare root `/`, so the CSP + security headers
  were absent on the root document (the page most users land on). Caught by curling
  prod *after* #57 — config was byte-perfect but not effective.
- **#59** (`bf2553e`) — `fix(catalog)`: xlsx bulk-import now resolves `brand_id`
  (pre-existing bug, surfaced during staging verification).
- **#60** (`9e76199`) — `fix(dates)`: `today()`/`endOfMonth()` in Quotation /
  ProformaInvoice / FinancierCopy used `.toISOString()` (UTC), rolling the date back
  a day for IST users working 00:00–05:30. Replaced with local-time `fmtLocalDate()`.

**Prod infrastructure changes (not in git):**
- Supabase Functions secrets set on prod (`mmmxvjaavdtwlpcnjgzy`):
  `ALLOWED_ORIGINS=https://team.parastrucks.in`, `REQUIRE_CAPTCHA=true`
  (`TURNSTILE_SECRET` was already present).
- Migrations `20260502_phase9_security_hardening.sql` + `20260502_phase9f_quotation_idempotency.sql`
  applied to prod via `psql` (Supabase CLI `db dump`/`db push` need Docker, which
  isn't installed locally — direct `psql` through the Session Pooler was used instead).
- All 6 Edge Functions redeployed to prod (verify-login v6, admin-users v12,
  admin-access-rules v10, admin-catalog v9, admin-tiv v11, log-error v9).
- Pre-deploy `pg_dump` backup taken (`prod_backup_pre_phase9_*.sql`, stored off-machine).

**Staging:** Supabase project `klpnhpnlotcbbovwswmq` (`paras-portal-staging`, Mumbai)
now exists — bootstrapped from a prod schema dump + reference-data dump. Reusable for
future migration testing. The migrations folder is NOT a full history (earliest file
is `20260401_*`); a fresh project must be seeded from a prod dump, not `db push`.

**Known residuals (not blocking, deferred):**
- Transitive CVEs `postcss 8.5.8` (GHSA-qx2v-qp2m-jg93) + `dompurify 3.3.3` —
  fixable with a `package.json` `overrides` block; left for a follow-up.
- 9h / 9i not started (multi-week feature track + process items).
- Local dump artifacts (`prod_schema.sql`, `prod_seed_data.sql`, `staging_apply.sql`,
  `prod_backup_pre_phase9_*.sql`) and the worktree `elated-volhard-c88b85` can be
  cleaned up once prod is confirmed stable.

**Verification facts worth keeping:** CSP is enforced based on the header delivered
with the *document* — verify security headers by curling actual page URLs
(`/`, `/login`), not by reading `vercel.json`. The login page console is flooded by
Cloudflare Turnstile's own iframe/worker noise (`normal?lang=auto`, `about:srcdoc`,
`blob:challenges.cloudflare.com`) — that is third-party, not the portal; do CSP
console checks on app pages (Dashboard), not the login page.

---

## Phase 9.5 — Deployment Record (Vendor Jobs)

**Shipped to production 2026-06-28 → 06-29.** New feature: the service team's
**outside-workshop & ancillary job tracker** at route **`/vendor-jobs`** (user-facing
label "Vendor Jobs"). Tracks the four cases {outside, ancillary} × {warranty, paid}
through a PO-number lifecycle (status tracking + PO/warranty-letter PDF only — no money,
no invoice metadata, no uploads in v1). Full design/history: plan file
`C:\Users\dhruv\.claude\plans\immutable-petting-hearth.md` + memory `phase95_service_tracker.md`.

**Architecture:** new tables `service_vendors` / `service_jobs` / `service_job_events`
(append-only track log); SECURITY DEFINER RPC `create_service_job()` (atomic fiscal-year
PO numbering + idempotency); helper `is_manager_or_above()`; RLS (entity+role reads, EF
writes); 12 `access_rules` rows for `/vendor-jobs`. Edge Function **`service-jobs`**
(`verify_jwt:false`, custom `verify()` — the 7th EF) enforces per-action authority +
entity-ownership (no IDOR) + audit. Migration `supabase/migrations/20260625_phase95_service_jobs.sql`.

**PRs merged to `portal`:**
- **#61** (`d3468a5`) — Phase 9.5 feature (DB migration + EF + `ServiceJobs.jsx` +
  `generateServicePoPdf` + nav/route wiring). Migration applied to prod via the Supabase
  MCP `apply_migration`; EF deployed prod **v1**.
- **#62** (`39f1dff`) — `npm audit fix` (ws/babel/dompurify/react-router; no `--force`).
- **#63** (`62799f4`) — 4 fixes: Overview promoted to a top-level tab (Needs you | All jobs
  | Overview) for manager/gm/admin; manager Needs-you now surfaces spine-advancement work
  ("Mark work completed" / "Mark invoice received" buckets); executives can advance a job
  **to work_completed** (EF `advanceStage` relaxed — invoice_received stays manager+);
  lens switcher native `<select>` → custom dropdown (native popup bled over cards on mobile).
  EF deployed prod **v2**.
- **#64** (`9b6f610`) — vite 5→8 + plugin-react 4→6 + trivy CI fix (see Task B above).
- **#66** (`7270771`) — **vendor is now compulsory for a new job/PO**: `NewJobForm`
  vendor `<select>` gets `required` + `*`; EF `createJob` rejects a missing `vendor_id`.
  DB `vendor_id` stays **nullable** (existing prod rows untouched — gates NEW jobs only).
  EF deployed prod **v3** / staging v8.
- **#67** (`c648b4f`) — **security: revoke `anon` EXECUTE on `create_service_job()`**.
  A prod audit found the RPC still `anon`-executable: the original migration revoked it
  from `public`+`authenticated` but Supabase grants EXECUTE to `anon` on function creation
  and that direct grant survived the `revoke … from public`. Anon key is public (client
  bundle) → anon could POST `/rest/v1/rpc/create_service_job` with forged owner/entity,
  bypassing the EF. Revoked from `anon` on prod+staging (migration
  `phase95_revoke_anon_create_service_job` + repo file `supabase/migrations/20260629_*`);
  now `service_role`-only. **Reusable lesson:** locking down a SECURITY DEFINER RPC needs
  `revoke … from anon` AND `from authenticated`, not just `from public`.

**Role model:** create job = all portal users (vendor now required) · advance to
work_completed = any portal user (incl. executive) · advance to invoice_received / approve
warranty / convert / cancel = manager+ · payments (vendor payout + customer received) =
accounts · undo last status = gm/admin. Vendors are typed `is_authorized` (OEM dealers →
ancillary work) vs general (→ outside jobs). All 5 roles verified live on staging.

**Prod infra (not in git):** EF `service-jobs` prod **v3** (`verify_jwt:false`); prod
`ALLOWED_ORIGINS` already covered `https://team.parastrucks.in` (untouched). Staging
project `klpnhpnlotcbbovwswmq`: EF v8, test data cleared after verification (test users
`svc.mgr@`/`svc.exec@`/`gm@`/`pt.mgr@`/`admin@`/`tester@parastrucks.test`, pwd `StagingTest#2026`, kept).
Prod holds real usage data (1 vendor, 2 jobs, 10 events as of 2026-06-29) — do NOT touch.

**Prod audit (2026-06-29, read-only):** only 1 migration (`phase95_service_jobs`) + only
the `service-jobs` EF were added by 9.5 (other 6 EFs untouched); RLS + policy counts correct
on all 3 service tables; the 3 new SECURITY DEFINER objects pin `search_path`. Only gap =
the `anon` grant above (fixed, #67). **Still open, pre-existing (Phase 7b/8, NOT 9.5):**
`next_proforma_number()` and `next_financier_copy_number()` are also `anon`-executable and
consume fiscal counters — same class of gap, a one-line `revoke … from anon` each would
close them (deferred; flagged for the owner).

**Verify-on-staging facts worth keeping:** the portal session lives in
`sessionStorage['sb-session']` (custom storage adapter — NOT localStorage); the login
form gates submit on a Turnstile token (staging has `REQUIRE_CAPTCHA=false` so it passes) —
to drive login in the preview harness, set fields via the native value setter + `input`
event, wait for the `cf-turnstile-response` token, then `form.requestSubmit()`.

**Verify-on-staging facts worth keeping:** the portal session lives in
`sessionStorage['sb-session']` (custom storage adapter — NOT localStorage); the login
form gates submit on a Turnstile token (staging has `REQUIRE_CAPTCHA=false` so it passes) —
to drive login in the preview harness, set fields via the native value setter + `input`
event, wait for the `cf-turnstile-response` token, then `form.requestSubmit()`.

---

## Phase 9 — Post-Deployment VAPT Re-Test (2026-05-18) — ALL FINDINGS TABLED

After 9b–9g shipped, three red-team agents re-attacked production (non-destructive:
perimeter probing + code/RLS review; no brute-force, no data mutation). **Result: the
Phase 9 perimeter held — every deployed control passed.** The findings below are
gaps *outside* the Phase 9 scope. **Decision (2026-05-18): all tabled, none actioned.**
None are anonymous-internet exploitable — every one requires a valid portal login.
Full plain-English report: `docs/security-vapt/phase9-verification-report.md`.

| ID | Finding | Severity | File |
|----|---------|----------|------|
| **C1** | `users_select` RLS policy lets ANY authenticated user read every coworker's PII (email/phone/employee_code/permission_level/is_active) in their entity. Caused by the April recursion hotfix adding an `entity_id = get_my_entity_id()` OR-branch that was never narrowed back. | **High** (insider PII leak, live) | `supabase/migrations/20260418_fix_users_select_recursion_hotfix.sql:18-21` |
| **M-1** | `bulkUpsertVehicles` has no field whitelist — client `rows` go straight into a service-role `upsert` (up to 5000 rows). Single-row `updateVehicle` *does* whitelist. Mass-assignment. | Medium | `supabase/functions/admin-catalog/index.ts:173-186` |
| **M-2** | `injectTivIds` trusts `entity_id`/`brand_id` from the payload with no caller-owns-entity check — a back-office user can write TIV data tagged to the *other* entity (IDOR). | Medium | `supabase/functions/admin-tiv/index.ts:119-153` |
| **H-1** | `admin-access-rules` never compares `permission_level` against the caller's own tier (H6 spec said it should). Harmless today — only `admin` can call it — but a latent self-escalation path if a non-admin role is ever added. | Low (latent) | `supabase/functions/admin-access-rules/index.ts` |
| **H-2** | Reference-data mutations (`toggleDepartment`, `toggleBrand`, `createOperatingUnit`, …) write no `security_audit_log` row, despite some changing users' effective role. | Low (audit gap) | `admin-users` / `admin-catalog` |
| **M-3** | C2 self-edit block omits `is_active` from the blocked-field loop (spec listed it). Not reachable today. | Low (spec gap) | `admin-users/index.ts` |
| **L-1** | Rate limiter + `verify-login` lockout both **fail open** on a DB error. Brute-force throttling is best-effort only. | Low | `verify-login/index.ts` |
| — | `team.parastrucks.in` static responses send `Access-Control-Allow-Origin: *` (EF CORS is correctly locked; static-site config only). | Low | `vercel.json` |
| — | `postcss 8.5.8` / `dompurify 3.3.3` CVEs — confirmed NOT reachable in current app usage (build-time / unconfigured DOMPurify). | Info | `package.json` |

**Open product question for C1 before any fix:** the `entity_id` OR-branch may exist
because some screen needs an employee list (a colleague dropdown / team page). The fix
is likely "lock sensitive fields, allow a name-only view if a screen needs it" — confirm
what the UI actually depends on before narrowing the policy, or that screen goes blank.

**Confirmed PASS (Phase 9 worked):** EF CORS allow-list rejects unknown origins · all
security headers correct on `/` and deep paths · CSP3 split correct · `security.txt`
served · EFs reject unauth with clean 401, no leaks · caller identity always validated
via `getUser()` (so `verify_jwt:false` is safe) · C2 HR-edit guardrails · H4 signOut on
deactivate · RLS fails closed when `current_user_role()` is NULL · all SECURITY DEFINER
functions pin `search_path` · no XSS sinks in `src/` · no service-role key in the
client bundle · entity isolation on quotations/invoices/tiv/catalog holds.

---

# Parastrucks VAPT — Final Remediation Plan (v2, post-review)

## Context

Three parallel red-team agents audited the portal (auth/session, RLS/authorization, client/infra). This plan now reflects the user's decisions:

- HR retains the ability to set subordinate `permission_level`. The fix tightens *who* HR can edit (not *what fields*).
- `fails_remaining` removal: approved.
- CAPTCHA fail-closed: approved.
- H5 (force-logout on demotion across tabs): **dropped** — user will redeploy if a critical demotion is needed.
- M1 (uniform 401 for locked + bad-creds): **dropped** — keep the lockout countdown UX.
- M5 UUID brochure filenames: approved.
- M2 entity-scoped reference tables: confirmed safe (see findings).
- C3 explained below.
- M4 redesigned for zero visual change.

---

## CRITICAL

### C1. Lock down CORS on every Edge Function
- **Files:** `supabase/functions/_shared/cors.ts` (new), and every EF (`verify-login`, `admin-users`, `admin-access-rules`, `admin-catalog`, `admin-tiv`, `log-error`).
- **Change:** new helper reads `ALLOWED_ORIGINS` env var (comma-separated), echoes `Access-Control-Allow-Origin` only when `req.headers.get('Origin')` matches; otherwise omits the header. Adds `Vary: Origin`. All EFs import and use it.
- **UX:** none.

### C2. HR-edit guardrails in `admin-users.updateProfile` (revised — HR keeps permission-edit ability)
HR is identified by `departments.code = 'hr'` (not by `permission_level`); see `admin-users/index.ts:77-102, 171`. The keep-functional rule set is:
1. **Block self-edit of sensitive fields.** Caller cannot change their own `permission_level`, `entity_id`, `department_id`, or `is_active`. (Other self-edits like name/phone are fine.)
2. **Block edits targeting other HR users.** If `target.department.code === 'hr'` and caller is not `admin`, reject. Prevents an HR user from sabotaging a peer.
3. **Block edits where target is currently or becoming a higher-or-equal tier than caller.** Build a tier rank: `staff < executive < manager < gm < admin`. HR caller (typically `manager` or `executive`) cannot edit a `gm` user, and cannot promote anyone to a tier `>=` their own. Admin bypasses.
4. **Field whitelist.** Accept only known fields from the JSON body (`name, phone, employee_code, department_id, designation_id, outlet_id, sub_dept_id, sales_vertical_id, permission_level, is_active, entity_id`). Drop any extra keys silently — kills mass-assignment.
5. **Existing `requireSameEntity` and `rejectAdminTier` guards stay** (lines 187-196, 125-131).
- **UX:** legitimate HR workflow (HR edits subordinate's profile, including bumping permission_level to gm/manager/executive) keeps working. Only blocked: editing self, editing other HR, editing peers/superiors.

### C3. Vulnerable client dependencies — explained
The `xlsx` npm package (`xlsx@0.18.5`) is the issue. Two distinct CVEs:
- **Prototype Pollution (GHSA-4r6h-8v6p-xvw6)** — a malicious .xlsx file can inject properties into `Object.prototype`, breaking app invariants and enabling escalation.
- **ReDoS (GHSA-5pgg-2g8v-p4x9)** — a crafted file makes the parser hang.

Both reachable through `parseExcel.js:246` (the TIV Forecast upload), which calls `XLSX.read()` on user-supplied workbooks.

**Why it can't just be `npm audit fix`:** the SheetJS maintainers stopped publishing patched versions to npm. The patched build lives on their own CDN.

**Two options, you choose:**
- **(Recommended) Drop-in:** install from SheetJS's official tarball — `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Same package name, same `import * as XLSX from 'xlsx'`, same API (`XLSX.read`, `XLSX.utils.sheet_to_json`). **Zero code changes**, just a `package.json` update. This is what SheetJS officially recommends.
- **Replace with `exceljs`:** different API (cell-by-cell iteration). Requires rewriting `parseExcel.js` (~280 lines) and `Catalog.jsx`'s xlsx usage. Not justified unless you want to leave SheetJS entirely.

Other deps to bump in the same PR:
- `dompurify` → latest (XSS bypass fixes).
- `postcss` → ≥8.5.10 (`</style>` XSS).
- `vite` → latest (pulls patched `esbuild`).

**UX:** none if option 1 is chosen and tests pass.

---

## HIGH

### H1. `verify-login` 500 leaks `stage` + raw error
- **File:** `supabase/functions/verify-login/index.ts:194-205`.
- **Change:** keep `console.error(...)` (server logs only); response body becomes `{ error: "internal_error" }`.
- **UX:** none.

### H2. Drop `fails_remaining` from server + UI
- **Files:**
  - `supabase/functions/verify-login/index.ts:167-170` — remove `fails_remaining` from JSON response.
  - `src/context/AuthContext.jsx` — drop `failsRemaining` from the thrown error.
  - `src/pages/Login.jsx:76, 109-112, 143-148` — remove state and the warning banner.
- **UX:** users no longer see "N attempts remaining" — accepted by user. The lockout countdown banner stays.

### H3. CAPTCHA fail-closed in production
- **File:** `supabase/functions/verify-login/index.ts:50-52, 66-68`.
- **Change:** add `REQUIRE_CAPTCHA` env var. When `true`, missing `TURNSTILE_SECRET` or any Cloudflare error returns `503 captcha_unavailable` instead of bypassing. When unset/false, current behaviour (dev/local).
- **UX:** during a Cloudflare outage, login is blocked rather than silently weakened — accepted by user.

### H4. Enforce `is_active` in RLS + `current_user_role()` + revoke refresh tokens
- **File:** new migration `supabase/migrations/<date>_phase9_security_hardening.sql`.
- **Change:**
  - Add `is_active_user()` SECURITY DEFINER returning `boolean`.
  - Modify `current_user_role()` to return `NULL` when caller is inactive.
  - Add `is_active_user()` predicate to existing SELECT/UPDATE/DELETE policies on user-data tables (`quotations`, `customers`, `leads`, etc.).
  - In `admin-users.setActive(false)`, call Supabase Admin API `auth.admin.signOut(user_id)` to revoke refresh tokens immediately.
- **UX:** legit users unaffected. Deactivated users lose data access immediately instead of after token expiry.

### H6. `admin-access-rules` privilege-aware checks
- **File:** `supabase/functions/admin-access-rules/index.ts:126-150`.
- **Change:** require caller is `admin` (already done at line 108 — confirm). In `createRule`/`updateRule`, reject any `permission_level` value `>=` caller's tier. Add a `security_audit_log` row for every mutation.
- **UX:** none for non-admins; admin still has full control.

### H5. ~~Force-logout on demotion across tabs~~ — **dropped per user**

---

## MEDIUM

### M1. ~~Uniform 401 for locked + bad-creds~~ — **dropped per user**

### M2. Entity-scope reference tables — **confirmed safe**
Investigation results:
- `outlets`: `Employees.jsx:120-126` and `UploadPanel.jsx:43-45` already filter by `entity_id`. Safe.
- `outlet_brands`: same — already entity-scoped via join. Safe.
- `sales_verticals`, `back_office_subdepts`, `designations`: loaded by `Employees.jsx`, `Profile.jsx`, `AccessRules.jsx`, `Catalog.jsx`. None of these display cross-entity data — they're either filtered after fetch by the selected entity or scoped to a single user's IDs.
- The only edge case is `AccessRules.jsx:52` (designations loaded globally) — that page is admin-only, so cross-entity visibility is intentional. We will leave `designations` un-scoped (admin-only consumer); scope `outlets`, `outlet_brands`, `sales_verticals`, `back_office_subdepts` to `entity_id = get_my_entity_id()` for `authenticated` role. Admin bypass via existing `current_user_role() = 'admin'` predicate.
- **UX:** none. Same data is shown — just enforced by RLS now.

### M3. Audit log for privilege mutations
- **Files:** new table in migration; writes from `admin-users.updateProfile/setActive`, `admin-access-rules.*`.
- **Schema:** `security_audit_log(id, actor_id, action, target_id, before_jsonb, after_jsonb, created_at)`. RLS: admin-only read.
- **UX:** none.

### M4. CSP hardening — **redesigned for zero visual change**
The 415 `style={{}}` inline-object usages do not need to move. CSP3 splits style controls into `style-src-elem` (for `<style>` blocks and `<link>` stylesheets) and `style-src-attr` (for `style=""` attributes on elements). React's `style={{}}` compiles to the latter.

**Plan:**
1. Extract the single `<style>{...}` template-literal block in `src/pages/Login.jsx:229-316` into `src/pages/Login.css` and `import './Login.css'` at the top of the file. This is mechanical, no rule changes.
2. Update `vercel.json` CSP to:
   ```
   default-src 'self';
   script-src 'self' https://challenges.cloudflare.com;
   style-src-elem 'self';
   style-src-attr 'unsafe-inline';
   img-src 'self' data: blob: https://*.supabase.co;
   connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com;
   frame-src https://challenges.cloudflare.com;
   object-src 'none';
   base-uri 'self';
   frame-ancestors 'none';
   ```
3. Add: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()`.
4. Verify in Chrome/Edge/Firefox/Safari that `style-src-attr` is honoured (it is, in all current versions; falls back to `style-src` in old browsers, so we keep `style-src 'self' 'unsafe-inline'` as a fallback line for very old clients — net effect identical).

**Pre-flight visual regression check:** before merging, take screenshots of the login page on the current branch, apply the change, take screenshots again, diff. Repeat on three pages with heavy `style={{}}` usage (Catalog, AccessRules, Employees). Zero pixel diffs expected; if any, roll back the Login.css extraction and use a CSP nonce instead.
- **UX:** none if regression check passes.

### M5. UUID brochure filenames
- **File:** `supabase/functions/admin-catalog/index.ts:204`.
- **Change:** ignore client-supplied path; server generates `crypto.randomUUID() + '.pdf'` and writes to `brochures/<uuid>.pdf`. Persist the original filename + uuid mapping in the existing brochure DB row.
- **UX:** filename on disk changes; download link in UI still works (uses uuid). Original filename can still be exposed via a `Content-Disposition: attachment; filename="<original>.pdf"` header on signed URLs if needed.

### M6. Idempotency on Quotation save
- **File:** `src/pages/Quotation.jsx:708`.
- **Change:** generate `client_request_id = crypto.randomUUID()` per save click; backend / RPC adds a unique index on `(user_id, client_request_id)` within a 24h window. Re-submission returns the original row.
- **UX:** none for users; eliminates duplicate rows on flaky network.

---

## LOW / INFO

- **L1.** Strip `console.*` in prod via `vite.config.js` → `esbuild: { drop: ['console','debugger'] }`. Real errors continue to flow through the existing `log-error` Edge Function.
- **L2.** `ErrorBoundary.jsx:44-48` already uses `encodeURIComponent` for the mailto body — confirm no other consumer renders `error.message` as HTML. No change needed if confirmed.
- **L3.** Per-IP rate limiting → Cloudflare WAF (out-of-scope, tracked separately).

---

## Files modified (final list)

**Edge Functions**
- `supabase/functions/_shared/cors.ts` (new)
- `supabase/functions/verify-login/index.ts`
- `supabase/functions/admin-users/index.ts`
- `supabase/functions/admin-access-rules/index.ts`
- `supabase/functions/admin-catalog/index.ts`
- `supabase/functions/admin-tiv/index.ts`
- `supabase/functions/log-error/index.ts`

**Database**
- `supabase/migrations/<date>_phase9_security_hardening.sql` (new) — `is_active_user()`, modified `current_user_role()`, RLS additions, reference-table scoping for outlets/outlet_brands/sales_verticals/back_office_subdepts, `security_audit_log` table.

**Client**
- `src/pages/Login.jsx` — remove `failsRemaining` UI; extract inline `<style>` block.
- `src/pages/Login.css` (new)
- `src/context/AuthContext.jsx` — drop `failsRemaining`.
- `src/pages/Quotation.jsx` — `client_request_id` UUID.
- `vite.config.js` — `esbuild.drop` in prod.

**Infra & deps**
- `package.json` — bump `xlsx` (CDN tarball), `dompurify`, `postcss`, `vite`.
- `vercel.json` — new CSP and security headers.

---

## Verification

1. **CORS:** `curl -i -X POST -H "Origin: https://evil.example" https://<proj>.functions.supabase.co/verify-login -d '{}'` → no `Access-Control-Allow-Origin: https://evil.example` in response.
2. **HR functional check:** sign in as HR (manager + dept=hr). Confirm: can edit subordinate `permission_level` to executive ✓; CANNOT edit own `permission_level` ✗; CANNOT edit another HR user ✗; CANNOT promote anyone to gm if caller is manager ✗.
3. **Info disclosure:** force a 500 in `verify-login` → body is exactly `{"error":"internal_error"}`. Bad-creds → `{"error":"invalid_credentials"}` with no `fails_remaining`.
4. **Lockout still works:** 5 wrong attempts → 6th returns 429 `{"error":"locked","retry_after_s":...}`. UI shows the countdown banner (preserved per M1-skip).
5. **CAPTCHA fail-closed:** with `REQUIRE_CAPTCHA=true` and Cloudflare unreachable → 503, login refused.
6. **Inactive user:** deactivate a user; with their old JWT, `supabase.from('quotations').select('*')` returns `[]`; refresh-token call also fails (Admin signOut applied).
7. **Reference-table scoping:** entity-A user does `supabase.from('outlets').select('*')` → only entity-A rows; admin sees all.
8. **Dependencies:** `npm audit` reports 0 high/critical advisories. TIV Forecast upload still parses sample workbook correctly.
9. **CSP visual regression:** screenshots of Login, Catalog, AccessRules, Employees identical pre/post change in Chrome + Firefox + Safari.
10. **Headers:** `curl -I https://portal.parastrucks.in/` shows HSTS, CSP, X-Frame-Options DENY, Permissions-Policy.
11. **Brochure upload:** uploaded file lands at `brochures/<uuid>.pdf`; UI download still works.
12. **Audit log:** every privilege change writes a `security_audit_log` row visible to admin.
13. **Quotation idempotency:** double-clicking Save while throttled produces exactly one quotation row.
14. **Smoke:** standard happy-path flows (login, quotation create/save, brochure browse, employee edit) all work end-to-end.

---

## Industry-Standard Hardening (Third-Party Recommendations)

These items aren't tied to a specific vulnerability we found — they're standard controls (OWASP ASVS, CIS, NIST SP 800-63, Supabase production checklist) that raise the security baseline. **Stack constraint: we are on the FREE tier of Supabase, Vercel (Hobby) and Cloudflare**, so each item is annotated:
- **[FREE]** — usable as-is on current plans
- **[PAID]** — requires a paid upgrade; listed for awareness only, do not action now
- **[FREE-ALT]** — paid feature has a free workaround we can build

### Quick wins (do alongside the main PR)

**T1. Subresource Integrity (SRI) on the Cloudflare Turnstile script.** **[FREE]**
- `src/pages/Login.jsx:24-29` injects `https://challenges.cloudflare.com/turnstile/v0/api.js` without an `integrity` attribute. Cloudflare officially recommends *not* using SRI on `v0/api.js` because they update it without notice (versioned URLs would break). Action: pin the loader to a specific build only if Cloudflare publishes one; otherwise accept the residual risk and instead add `referrerpolicy="no-referrer"` + a strict CSP `script-src` that whitelists only `challenges.cloudflare.com`. CSP is already covered by H1.

**T2. `security.txt` (RFC 9116).** **[FREE]**
- Add `public/.well-known/security.txt` with `Contact:`, `Expires:`, `Preferred-Languages:`. Vercel Hobby serves static files at this path automatically — no header rule needed beyond the existing `vercel.json`.

**T3. GitHub repo hardening.** **[FREE]**
- All free for public repos and (since 2024) for **private** repos too:
  - Enable **secret scanning + push protection** (Settings → Code security).
  - Enable **Dependabot security updates** (auto-PR for vulnerable deps — would have caught xlsx/dompurify).
  - Add a **CodeQL** workflow (`.github/workflows/codeql.yml`) — free for any repo on GitHub-hosted runners.
  - Branch protection on `main`: required PR review, required CI green, no force-push.

**T4. Supabase dashboard settings.**
- Auth → **Leaked Password Protection** (HaveIBeenPwned check). **[FREE]** — available on free tier as of 2024.
- Auth → password minimum length ≥ 12, require mixed character classes. **[FREE]**
- Auth → JWT expiry 1h, refresh-token reuse detection ON. **[FREE]**
- Auth → per-IP / per-email rate limits for `/auth/v1/token`. **[FREE]** — basic rate limits are configurable on free tier.
- Database → **pg_stat_statements** extension. **[FREE]**
- Database → **pgaudit** extension. **[PAID]** — requires Pro plan; defer.
- Database → **PITR backup** + quarterly restore test. **[PAID]** — Pro+ only. **[FREE-ALT]**: free tier gives daily logical backups for 7 days — schedule a weekly `pg_dump` via a GitHub Actions cron that pushes the encrypted dump to a private repo or to GitHub Releases as an artifact (free, off-platform copy).
- API → rotate `SERVICE_ROLE_KEY` every 90 days and on offboarding. **[FREE]**

**T5. Email-domain hygiene for `parastrucks.in`.** **[FREE]**
- Publish/verify **SPF**, **DKIM**, **DMARC** (`p=quarantine` → tighten to `p=reject`). Free at any DNS host (Cloudflare DNS is free). Without these, attackers can spoof `hr.guj@parastrucks.in` (the contact in `Login.jsx:225`) for credential-phishing of staff.

**T5b. Cloudflare free-tier WAF rules.** **[FREE]**
- Cloudflare Free includes 5 custom WAF rules and the "Free Managed Ruleset". Add:
  - Rate-limit rule on `/auth/v1/token` and the `verify-login` EF path: e.g. 10 req/min per IP (free plan allows one rate-limit rule).
  - Bot Fight Mode ON (free).
  - Country-block / challenge for non-IN, non-relevant geos if business is India-only.
  - Block known bad ASNs on login routes.

### Medium effort

**T6. MFA for admin and HR tiers.** **[FREE]**
- Supabase Auth TOTP (`enableMFA`) is **available on free tier**. Enforce for users with `permission_level in ('admin','gm')` or `department.code = 'hr'`. UI: enrolment screen + challenge step in login flow. Single biggest ATO-risk reduction available to us.

**T7. New-device / new-IP login notification email.** **[FREE-ALT]**
- Supabase free tier's built-in SMTP is rate-limited (3 emails/hr) — not viable for transactional. **Free workaround**: integrate **Resend** free tier (3k emails/month, 100/day) or **Brevo** free (300/day). Trigger from `verify-login` EF: hash UA + IP, store first-seen in a small `user_known_devices` table; on miss, enqueue email and insert row.

**T8. "Active sessions" self-service page.** **[FREE]**
- `/account/sessions` page listing the user's active refresh tokens (Supabase Admin API + service-role from an EF) with per-session revoke and "sign out everywhere". Uses existing free-tier APIs only.

**T9. CI security gates.** **[FREE]**
- GitHub Actions on a public/private repo gives 2k free minutes/month — enough for these:
  - `npm audit --audit-level=high`
  - `gitleaks` scan
  - `trivy fs` on lockfile
  - Fail the build on high/critical findings.

**T10. Pre-commit hook for secrets.** **[FREE]**
- `.husky/pre-commit` runs `gitleaks protect --staged`. Local-only, zero cost.

**T11. Centralized logging + alerting.** **[FREE-ALT]**
- Supabase **Log Drains** (Logflare/Datadog/etc.) require **Team plan** — out of scope. **Free workaround**:
  - Use Supabase dashboard's built-in log explorer (free, 1-day retention).
  - For alerting we don't get for free, build a lightweight EF (`security-monitor`) run by **GitHub Actions cron** every 15 min. It queries `auth_attempts`, `security_audit_log`, and `auth.audit_log_entries` for the alert conditions below and posts to a private **Discord/Slack webhook** (both free):
    - >10 failed logins from one IP in 5 min
    - any 5xx from an admin EF (read from `auth.audit_log_entries` proxy or wrap EF responses with a logging helper that writes to `security_audit_log`)
    - any `security_audit_log` write outside business hours
    - any `permission_level` change to `gm`/`admin`
    - any `auth_attempt_record` row matching an admin email
- Note: 1-day Supabase log retention on free is a real gap. Compensate by mirroring critical events to our own `security_audit_log` table (already exists — extend it).

**T12. File-upload virus scan.** **[FREE-ALT]**
- ClamAV in an EF won't fit free-tier memory limits. **Free workaround**: send the file hash + first 32MB to **VirusTotal Public API** (free, 4 req/min, 500/day) before finalizing the upload. Quota fits brochure/TIV upload cadence. Reject on hit. If quota becomes an issue, downgrade to client-side filename + magic-byte check + size cap as a basic guardrail.

**T13. PII minimization + encryption-at-rest for sensitive columns.** **[FREE]**
- `pgcrypto` is available on Supabase Free. Use `pgp_sym_encrypt` for the most sensitive PII columns (`customers.mobile`, `users.phone`, etc.) with key stored in **Supabase Vault** (free). Aligns with DPDP Act 2023 expectations.

### Longer-term programme items

**T14. Annual third-party penetration test.** **[PAID — external cost, not platform]**
- Engage a CERT-In-empanelled VAPT vendor (required in India for many sectors). Budget: ₹1.5–4L per engagement. Not a platform-tier cost — independent of Supabase/Vercel/Cloudflare plans.

**T15. Responsible disclosure / bug-bounty programme.** **[FREE]**
- Start with a public policy file (`security.txt` from T2 + a `SECURITY.md` in the repo, both free). Graduate to HackerOne / BugCrowd later only if traffic justifies it.

**T16. Phishing-resistant MFA (WebAuthn / FIDO2) for admin tier.** **[FREE]**
- Supabase Auth WebAuthn factor is available on free tier. Use a YubiKey or platform authenticator for the single `admin` user.

**T17. Disaster-recovery runbook.** **[FREE-ALT]**
- Document RTO/RPO. Without PITR (Pro), the realistic RPO on free tier is "last weekly `pg_dump` from T4". Tabletop-test annually by restoring the dump into a fresh free-tier Supabase project.

**T18. Staff security training.** **[FREE]**
- Quarterly 30-min phishing-awareness sessions for HR users. Use free CERT-In or Google "Phishing Quiz" material. No platform cost.

**T19. Privacy & compliance docs.** **[FREE]**
- Update privacy policy + add data-retention schedule (DPDP Act 2023). Confirm Supabase project is in **Mumbai (ap-south-1)** region — selectable on free tier at project creation; if the current project isn't, schedule a migration.

**T20. Principle-of-least-privilege review.** **[FREE]**
- Quarterly audit: list all `gm`+ users; confirm each still needs that tier. Revoke unused access. Same for `access_rules` rows. Pure process work.

---

### Free-tier limitation summary (what we explicitly cannot do)

| Capability | Tier required | Our compensating control |
|---|---|---|
| Point-in-time recovery (Supabase) | Pro | Weekly `pg_dump` via GitHub Actions (T4) |
| pgaudit extension | Pro | Application-level audit via `security_audit_log` |
| Supabase log drain → SIEM | Team | EF + GitHub Actions cron + Discord webhook (T11) |
| >7-day log retention | Team | Mirror critical events to our own table (T11) |
| High-volume transactional email | (Supabase SMTP capped) | Resend/Brevo free tier (T7) |
| Cloudflare advanced WAF / >5 custom rules | Pro/Biz | Use the 5 free custom rules wisely (T5b) |
| Vercel WAF / log drains | Pro/Enterprise | Cloudflare in front of Vercel (free) for WAF/rate-limit |
| ClamAV at scale | (memory) | VirusTotal Public API (T12) |

---

## Out-of-scope / tracked separately

- Per-IP rate limiting on `verify-login` (Cloudflare WAF rule — overlaps T4 Supabase rate limits).
- H5 force-logout on demotion (user will redeploy on critical demotions).
- M1 uniform 401 for locked + bad-creds (UX kept).

---

## Phase 9 — Security & Hardening (Sub-phased Implementation Roadmap)

This is **Phase 9 of the parastrucks website**. It is broken into sub-phases `9a` through `9i`, sequenced for **deployability** (each ships independently and is reversible), **dependency order** (e.g. shared CORS helper before EFs that import it), and **risk** (lowest-blast-radius first). All work happens on branch `claude/secure-login-vulnerabilities-Ypeoh`; each sub-phase is one PR / one merge to `main`.

### 9a — Pre-flight (no code, ~1 hour)

Goal: snapshot the world before changes.

- [ ] Confirm Supabase project region is `ap-south-1` (Mumbai). If not, schedule migration as a separate workstream.
- [ ] Take a manual `pg_dump` of production into a private off-site location (free-tier safety net since we don't have PITR).
- [ ] Capture **baseline screenshots** of: Login, Catalog, AccessRules, Employees, Quotation. Stored in `/docs/security-vapt/baseline/` (local only). Used by 9f visual-regression check.
- [ ] Capture **baseline `npm audit` output** for diff after 9b.
- [ ] Decide values for new env vars: `ALLOWED_ORIGINS` (CSV of `https://portal.parastrucks.in,http://localhost:5173`), `REQUIRE_CAPTCHA` (`true` for prod, unset for dev).
- [ ] Stand up a **staging Supabase project** (free tier allows 2 projects per org) with a copy of schema + sanitized seed data. All DB migrations (9d) test here first.
- [ ] Identify **two test accounts per tier** in staging: admin, gm, manager+hr-dept, manager (non-hr), executive, staff. Used in every phase's verification.

Exit criteria: backup taken, staging up, env-var values agreed, test accounts ready.

---

### 9b — Dependency + build hardening (C3, L1) — **lowest risk, ship first**

Goal: eliminate CVEs from npm tree and silence prod console.

**Repo facts verified before execution (2026-05-02):**
- Branch `claude/secure-login-vulnerabilities-Ypeoh`, HEAD `360e0d9` (CLAUDE.md commit), working tree clean.
- Package manager: npm (`package-lock.json` present).
- `package.json` deps observed: `xlsx ^0.18.5`, `vite ^5.1.6`, `react ^18.2.0`, `react-dom ^18.2.0`, `@supabase/supabase-js ^2.39.7`. **`dompurify` is NOT installed**; **`postcss` is NOT a direct dep** (transitive via vite only). No eslint/vitest/jsdom. `"type": "module"`.
- `vite.config.js` is minimal: `plugins: [react()]` + `server.port`. No `esbuild`, no `build`, no `define`.
- `xlsx` API surface in app code is **only two calls** (verified):
  - `src/tiv-forecast/lib/parseExcel.js:3` import; `parseExcel.js:246` `XLSX.read(...)`; `parseExcel.js:51,86,119,148,180` `XLSX.utils.sheet_to_json(...)`.
  - `src/pages/Catalog.jsx:2` import; `Catalog.jsx:1207` `XLSX.read(...)`; `Catalog.jsx:1211` `XLSX.utils.sheet_to_json(...)`.
  - Both calls exist unchanged in SheetJS 0.20.3 — drop-in is safe.
- `src/lib/errorLog.js` is the existing client logger that posts to the `log-error` Edge Function — does not call `console.*`. Safe to drop console in prod.
- 21 `console.*` calls in `src/`, all in catch blocks / debug paths.
- **No `.github/workflows/` directory**, no test runner. CI gates and unit tests are out of scope for 9b (they belong in 9g).

**Scope (revised to match reality):**

1. `package.json`:
   - Replace `"xlsx": "^0.18.5"` with `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (SheetJS-published patched build; same package name, same imports — no app-code changes).
   - Bump `vite` from `^5.1.6` to latest stable 5.x (pulls patched `esbuild`/`postcss` transitively).
   - **Do NOT add `dompurify`** — not used in repo. Original plan's claim was wrong.
   - **Do NOT pin `postcss`** as a direct dep — it's transitive via vite; the vite bump handles it.

2. `package-lock.json`: regenerate via `npm install` (no `--force`).

3. `vite.config.js`: add prod-only console/debugger strip using the function form of `defineConfig`:
   ```js
   export default defineConfig(({ mode }) => ({
     plugins: [react()],
     server: { port: parseInt(process.env.PORT || '3000') },
     esbuild: {
       drop: mode === 'production' ? ['console', 'debugger'] : [],
     },
   }));
   ```
   This keeps `console.*` working in `npm run dev` and strips it from `npm run build` output. `errorLog.js` is unaffected (it doesn't call console).

**Pre-execution checks:**
- [ ] `git status` clean on `claude/secure-login-vulnerabilities-Ypeoh`.
- [ ] Capture `npm audit --json > /tmp/audit-before.json` for diff.

**Verification (manual, since no test runner exists):**
- `npm install` succeeds; lockfile updated.
- `npm audit` after: 0 high/critical (or strictly fewer than before — capture diff).
- `npm run build` succeeds. Note bundle-size delta in PR description (informational).
- `npm run dev` and manually exercise:
  - TIV Forecast upload (`src/tiv-forecast/...`) — parse a sample `.xlsx`, confirm rows render.
  - Catalog page xlsx-driven flow (`Catalog.jsx`) — confirm no runtime error.
  - Login → quotation create + save — smoke only.
- `npm run build && npx vite preview` → DevTools Console is silent during the same flows (proves drop is active).
- `git diff` touches only `package.json`, `package-lock.json`, `vite.config.js` — nothing else.

**Rollback:** `git revert <commit>`; `npm install` restores the previous lockfile.

**Out of scope for 9b (deferred):**
- Adding dompurify (no consumer exists; if XSS-sanitization is ever needed, add it then).
- Creating `.github/workflows/security.yml` and CI gates → 9g (T9).
- Replacing `xlsx` with `exceljs` → not pursued (drop-in tarball solves the CVE).

Why first: zero behaviour change in app code, isolates the only known third-party-code risk, gives a clean dependency baseline before EF changes.

---

### 9c — Edge Function perimeter (C1, H1, H3)

Goal: lock down the public attack surface — CORS, error leaks, CAPTCHA fail-closed.

Pre-deploy:
- [ ] Set `ALLOWED_ORIGINS` and `REQUIRE_CAPTCHA` secrets in Supabase Functions config (staging first, prod later).

Scope:
- `supabase/functions/_shared/cors.ts` (new helper).
- All six EFs updated to use it: `verify-login`, `admin-users`, `admin-access-rules`, `admin-catalog`, `admin-tiv`, `log-error`.
- `verify-login`: response body for 500 becomes `{"error":"internal_error"}` (H1); `REQUIRE_CAPTCHA` gating (H3).

Verification:
- `curl -i -H "Origin: https://evil.example" https://<proj>.functions.supabase.co/verify-login` → no `Access-Control-Allow-Origin` echo.
- Force a 500 (mis-shape DB row in staging) → body is exactly `{"error":"internal_error"}`.
- Unset Cloudflare secret with `REQUIRE_CAPTCHA=true` → 503 `captcha_unavailable`.
- All six EFs still callable from `https://portal.parastrucks.in` and `http://localhost:5173`.
- Smoke: full login flow + one admin EF call from each tier.

Rollback: redeploy previous EF versions (Supabase keeps history).

Why second: only EF-level changes; no DB schema change, no client behaviour change. Tightens the perimeter before we put new privileged logic behind it.

---

### 9d — Database migration (H4 partial, M2, M3)

Goal: server-side guardrails that EF logic in 9e will rely on.

Scope: single migration `supabase/migrations/<date>_phase9_security_hardening.sql`:
- `is_active_user()` SECURITY DEFINER.
- Modified `current_user_role()` returns NULL when caller inactive.
- Add `is_active_user()` predicate to existing SELECT/UPDATE/DELETE policies on user-data tables (`quotations`, `customers`, `leads`, etc.).
- New RLS policies scoping `outlets`, `outlet_brands`, `sales_verticals`, `back_office_subdepts` to `entity_id = get_my_entity_id()` for `authenticated` (admin bypass).
- New `security_audit_log` table + RLS (admin read only, EFs write via service role).

Pre-deploy:
- [ ] Dry-run on staging.
- [ ] Run the verification queries below on staging before merging.

Verification (run as different roles):
- Active staff: `select * from quotations` returns their entity's rows (unchanged behaviour).
- Inactive staff (set `is_active=false`): `select * from quotations` returns `[]`.
- Entity-A user: `select * from outlets` returns only entity-A outlets.
- Admin: `select * from outlets` returns all rows.
- Reference-table consumers in UI (`Employees`, `UploadPanel`, `AccessRules`, `Catalog`) all render correctly for test accounts.

Rollback: down-migration that drops the new objects and removes the predicates added to existing policies. Write the down-script as part of this phase.

Why third: schema/RLS changes are the riskiest because they affect every query. Doing them on their own (separate PR, no app-code coupling) keeps the blast radius bounded and lets us bisect easily if a UI page breaks.

---

### 9e — Privilege hardening in Edge Functions (C2, H2, H4 EF-side, H6)

Goal: enforce HR/admin invariants at the API layer, now that the DB primitives from 9d exist.

Scope:
- `supabase/functions/admin-users/index.ts`:
  - `updateProfile`: self-edit block, HR-target block, tier-rank check, field whitelist (C2).
  - `setActive(false)`: call `auth.admin.signOut(user_id)` (H4).
  - Remove `fails_remaining` from response (H2 server side).
- `supabase/functions/admin-access-rules/index.ts`: tier-aware checks + writes to `security_audit_log` (H6, M3).
- `supabase/functions/admin-users/index.ts`: writes to `security_audit_log` for every privilege mutation (M3).
- Client side of H2: `src/context/AuthContext.jsx` and `src/pages/Login.jsx` drop `failsRemaining` UI.

Verification (from 9a test accounts):
- HR-manager: edits subordinate's `permission_level` to `executive` ✓; cannot edit own `permission_level` ✗; cannot edit another HR user ✗; cannot promote to `gm` ✗.
- Admin: still has full edit power.
- Deactivate a logged-in user from another session → their next API call returns 401, refresh fails.
- Login UI no longer shows "N attempts remaining"; lockout countdown still appears after 5 fails.
- Every privilege change produces a `security_audit_log` row.

Rollback: revert PR; previous EFs still functional because 9d RLS is permissive of correct callers.

Why fourth: combines all the privilege-policy logic into one coherent change set. Depends on 9d (`is_active_user`, `security_audit_log`).

---

### 9f — Client UX, headers, data integrity (M4, M5, M6)

Goal: browser-side defence-in-depth + remaining data hygiene items.

Scope:
- **M4 CSP & headers**: extract `<style>` block from `Login.jsx` into `Login.css`; update `vercel.json` with new CSP (`style-src-elem 'self'` + `style-src-attr 'unsafe-inline'` fallback) + HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy.
- **M5**: `admin-catalog/index.ts:204` server-generates UUID filenames; DB row stores original→uuid mapping; download path serves `Content-Disposition: filename="<original>.pdf"`.
- **M6**: `Quotation.jsx:708` — `client_request_id` UUID per save; backend dedupe via unique index.
- **L2 confirm**: grep that no other consumer renders `error.message` as raw HTML; if clean, no change.

Pre-deploy:
- [ ] Visual-regression diff against 9a baseline screenshots in Chrome + Firefox + Safari for Login, Catalog, AccessRules, Employees. Zero pixel diffs expected.

Verification:
- `curl -I https://portal.parastrucks.in/` shows all new headers.
- DevTools → Console: no CSP violations on any page.
- Brochure upload → file lands at `brochures/<uuid>.pdf`; UI download succeeds with original filename in browser save dialog.
- Quotation Save: spam-click 5x while throttled → exactly one row in `quotations` table.

Rollback: revert PR; CSP was additive so no client breakage if reverted.

Why fifth: depends on 9e EFs being live (M5 modifies `admin-catalog`). Visual-regression gate is the highest-effort verification step in the project — give it its own phase.

---

### 9g — Free-tier platform/config hardening (T1–T5b, T9, T10)

Goal: turn on every free-tier control we identified. Mostly config, very little code.

Scope (each is independently deployable; group into one PR for code, plus a checklist of dashboard/DNS toggles):

Code changes:
- `public/.well-known/security.txt` (T2).
- `SECURITY.md` at repo root (T15 prerequisite).
- `.github/workflows/security.yml` — `npm audit`, `gitleaks`, `trivy fs` jobs (T9).
- `.github/workflows/codeql.yml` — default GitHub CodeQL workflow (T3).
- `.husky/pre-commit` running `gitleaks protect --staged` (T10).
- `src/pages/Login.jsx`: Turnstile script gets `referrerpolicy="no-referrer"` + CSP whitelist already in 9f (T1).

Config changes (no code, tracked as a checklist in the PR description):
- GitHub: enable secret scanning + push protection; enable Dependabot security updates; configure branch protection on `main` (T3).
- Supabase dashboard: leaked-password protection, password-policy, JWT 1h, refresh-token reuse detection, per-IP/email auth rate limits, enable `pg_stat_statements`, schedule service-role-key rotation reminder (T4).
- DNS (Cloudflare): SPF, DKIM, DMARC=`p=quarantine` for `parastrucks.in` (T5).
- Cloudflare WAF: 5 custom rules — rate-limit on `/auth/v1/token` and `verify-login`, Bot Fight Mode, geo-rule, ASN block (T5b).
- New GitHub Action (cron, weekly): `pg_dump` of Supabase prod, encrypted, uploaded as a release artifact (T4 free-alt).

Verification:
- `curl https://portal.parastrucks.in/.well-known/security.txt` returns the file with `Content-Type: text/plain`.
- A test commit containing a fake AWS key is rejected by push protection.
- A pinned-vulnerable dep PR triggers a Dependabot alert.
- `dig TXT _dmarc.parastrucks.in` shows the record; mail-tester.com score ≥ 9/10.
- Cloudflare WAF dashboard shows the new rules with traffic.
- Test the weekly backup workflow manually; download artifact; verify it restores into the staging project.

Rollback: each toggle is independently reversible from its console.

Why sixth: depends on 9f's CSP being live (so the Turnstile-script CSP whitelist is already in place). All these items are low-risk individually, but each one needs verification in its own console — keeping them in one phase makes the checklist tractable.

---

### 9h — Medium-effort hardening (T6, T7, T8, T11, T12, T13)

Goal: substantive new features. Each is its own PR within this phase (don't bundle).

Order within the phase (by dependency):

**9h-1. MFA for admin & HR (T6).** New tables + RLS + UI for TOTP enrol/challenge. Touches login flow — high priority because it's the single biggest ATO reduction. ~3–5 days.

**9h-2. New-device email (T7).** `user_known_devices` table; Resend integration via EF; emit from `verify-login` after successful auth. Depends on the Resend API key being provisioned. ~2 days.

**9h-3. Active-sessions page (T8).** New `/account/sessions` route; backed by an EF that calls Supabase Admin API. ~2 days.

**9h-4. Security monitor cron (T11).** New `security-monitor` EF; GitHub Actions cron (every 15 min); Discord webhook URL stored as repo secret. Read-only, low-risk. ~1–2 days.

**9h-5. File-upload virus scan (T12).** VirusTotal integration in `admin-catalog` and `admin-tiv`. Behind a feature flag so we can disable if quota issues. ~2 days.

**9h-6. PII encryption (T13).** Migration adds encrypted columns alongside plaintext (don't drop yet); EF/RPC layer encrypts on write, decrypts on read; backfill cron; finally drop plaintext columns in a follow-up after verification. ~1–2 weeks total because of backfill window.

Each PR should land independently with its own staging soak.

Verification: per-item, listed in the hardening section above (T6–T13).

Why seventh: each item is too big to bundle with the core remediation. Splitting them out also means the critical security work in 9b–9f ships in days, not weeks.

---

### 9i — Programme / process items (T14–T20)

Goal: things that aren't pull requests.

- **T14** — schedule annual CERT-In VAPT vendor (calendar reminder, budget approval).
- **T15** — publish responsible-disclosure policy via the `SECURITY.md` and `security.txt` already shipped in 9g.
- **T16** — when MFA is live (9h-1), provision a YubiKey for the admin user and enrol it.
- **T17** — write the DR runbook (1-pager) using the weekly `pg_dump` from 9g.
- **T18** — book quarterly phishing-awareness sessions for HR.
- **T19** — privacy-policy update covering DPDP Act 2023; confirm Supabase region.
- **T20** — calendar a quarterly least-privilege review.

These are checklists / docs / calendar entries, not engineering work.

---

### Suggested calendar

| Sub-phase | Effort | Risk | When |
|---|---|---|---|
| 9a — Pre-flight | 1 hr | None | Day 0 |
| 9b — Deps + build | 0.5 day | Low | Day 0–1 |
| 9c — EF perimeter | 1 day | Low | Day 1–2 |
| 9d — DB migration | 1 day | Medium | Day 2–3 |
| 9e — Privilege EFs | 1.5 days | Medium | Day 3–5 |
| 9f — CSP + UX | 1 day | Low (after visual diff) | Day 5–6 |
| 9g — Platform config | 1 day | Low | Day 6–7 |
| 9h — Medium features | 2–4 weeks (parallelizable) | Medium | Week 2–5 |
| 9i — Programme | Ongoing | None | Continuous |

Sub-phases 9b–9g (the core remediation of every C/H/M finding) is roughly **one working week**. 9h is the ongoing security investment.

---

## Session Handoff — 2026-05-02

This section captures everything learned in the session that planned the rollout, so the next Claude Code session (started locally on the user's Windows machine) can resume without re-discovery.

### State of the repo at handoff

- Branch `claude/secure-login-vulnerabilities-Ypeoh` is checked out, working tree clean.
- One commit exists on the branch: `360e0d9 docs: add Phase 9 security & hardening plan to CLAUDE.md`.
- That commit is **not yet pushed** to GitHub due to the sandbox blocker below. User will push manually from PowerShell with: `git push -u origin claude/secure-login-vulnerabilities-Ypeoh`.
- The full plan also lives at `/home/user/parastrucks/CLAUDE.md` (identical content) so it's loaded as project memory automatically.

### Sandbox blockers identified (apply only to the remote sandboxed session — gone in a local session)

- **Blocker A — git push 403.** The remote sandbox proxies git through `127.0.0.1:39225` and rejects pushes to `parastrucks/parastrucks`. Not present in a local Claude Code session.
- **Blocker B — `cdn.sheetjs.com` blocked.** Sandbox egress filter rejects the SheetJS CDN, so `npm install https://cdn.sheetjs.com/...` fails with `host_not_allowed`. Not present in a local session either.

Both blockers disappear once the user runs Claude Code locally with normal network access. No code workaround is needed.

### Verified facts about the repo (from Explore-agent audit)

These supersede any contradictory line numbers / claims in the main plan body. All confirmed by reading the files:

- `package.json`:
  - `"xlsx": "^0.18.5"` (vulnerable; targeted by 9b)
  - `"vite": "^5.1.6"` (targeted by 9b)
  - `"react": "^18.2.0"`, `"react-dom": "^18.2.0"`, `"@supabase/supabase-js": "^2.39.7"`
  - **`dompurify` is NOT a dependency.** The plan body mentions bumping it — that step is a no-op; remove from 9b scope.
  - **`postcss` is NOT a direct dependency.** It comes in transitively via Vite. Bumping Vite to ^5.4.21 pulls a patched postcss automatically; no separate `postcss` line is needed.
  - No test runner configured (no vitest/jest/mocha; no `test` script).
  - Package manager: npm (only `package-lock.json` exists).
  - `"type": "module"`.
- `vite.config.js`: minimal (`plugins: [react()]`, `server.port` from env). No `esbuild` key, no `build` key. The 9b edit must add `esbuild.drop` from scratch.
- xlsx API surface (verified, drop-in safe for `xlsx@0.20.3`):
  - `src/tiv-forecast/lib/parseExcel.js:3` — `import * as XLSX from 'xlsx'`
  - `src/tiv-forecast/lib/parseExcel.js:246` — `XLSX.read(...)`
  - `src/tiv-forecast/lib/parseExcel.js:51, 86, 119, 148, 180` — `XLSX.utils.sheet_to_json(...)`
  - `src/pages/Catalog.jsx:2` — `import * as XLSX from 'xlsx'`
  - `src/pages/Catalog.jsx:1207` — `XLSX.read(...)`
  - `src/pages/Catalog.jsx:1211` — `XLSX.utils.sheet_to_json(...)`
  - Both files use only `XLSX.read` + `XLSX.utils.sheet_to_json`. Both APIs are unchanged in 0.20.3.
- Client logger: `src/lib/errorLog.js` exists and wraps the `log-error` Edge Function. Never calls `console.*` directly. Confirms it's safe for L1 (esbuild console-strip).
- `console.*` count in `src/`: 21 calls, all in error/debug code paths — all safe to drop in production builds.
- `.github/workflows/`: directory does **not exist**. Phase 9g must create it from scratch (no prior workflows to preserve).

### Decisions made this session

- **9b path = Option 1** (install xlsx as a CDN tarball spec in `package.json`, not a vendored binary). Rationale: smallest diff, lockfile pins integrity, Dependabot can still see it for future updates, Vercel build sandbox has no egress restriction so production deploys will work.
- **9b dompurify/postcss steps = dropped.** Verified neither is a direct dep. Vite bump covers postcss transitively.
- **Push strategy for the remote sandbox session = manual from PowerShell.** Will not retry the sandbox proxy push.

### 9b — exact execution plan (what the next session should do)

Run from the project root on the user's Windows machine with normal network. All commands work in PowerShell. Total time: ~3 minutes.

**Step 1 — Update dependencies (npm rewrites package.json + package-lock.json):**

```powershell
npm install "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
npm install vite@^5.4.21 --save-dev
```

**Step 2 — Edit `vite.config.js` to add prod-only console/debugger drop.** Replace the entire file with this (function form so dev mode keeps `console.*` working):

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: { port: parseInt(process.env.PORT || '3000') },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
}))
```

**Step 3 — Verify:**

```powershell
npm audit
npm run build
```

Expected: `npm audit` shows 0 high/critical advisories from `xlsx` (the two GHSA-4r6h-8v6p-xvw6 + GHSA-5pgg-2g8v-p4x9 entries are gone). `npm run build` completes without error; bundle size delta within 5%.

**Step 4 — Manual smoke test (cannot be automated):**
- Open the built site (`npm run preview`) and upload a sample `.xlsx` to TIV Forecast → confirm parsing succeeds.
- Open Catalog → confirm xlsx-driven flows still render.
- Open browser DevTools console on a production preview build → confirm no `console.log` output (proves the drop worked).

**Step 5 — Commit:**

```powershell
git add package.json package-lock.json vite.config.js
git commit -m "9b: patch xlsx CVEs, bump vite, strip prod console" -m "- xlsx 0.18.5 -> 0.20.3 (SheetJS-published patched build) fixes GHSA-4r6h-8v6p-xvw6 (Prototype Pollution) and GHSA-5pgg-2g8v-p4x9 (ReDoS) reachable via parseExcel.js:246 and Catalog.jsx:1207." -m "- vite 5.1.6 -> 5.4.21 (pulls patched esbuild/postcss transitively)." -m "- vite.config.js: prod-only esbuild.drop for console + debugger."
git push -u origin claude/secure-login-vulnerabilities-Ypeoh
```

The push will succeed in a local Claude Code session (no sandbox proxy in the way).

### What to do after 9b

Proceed in order through 9c, 9d, 9e, 9f, 9g per the roadmap above. Each is its own PR. 9c onwards may need additional verification passes; the plan body has the exact files and verification commands for each.

### Open items not blocking 9b

- Set the `ALLOWED_ORIGINS` and `REQUIRE_CAPTCHA` Supabase Functions env vars before merging 9c (values agreed in 9a checklist: `https://portal.parastrucks.in,http://localhost:5173` and `true` respectively).
- Capture baseline screenshots of Login, Catalog, AccessRules, Employees, Quotation **before merging 9f** for the visual-regression check (per the 9a checklist).
- Stand up the staging Supabase project before merging 9d.

These were left as user actions in 9a and don't gate 9b.

---

## Part 3 — Session & change log

*Append a dated entry per work session. Newest at the bottom. See `memory/phase_status.md`
for the always-current summary; this is the durable long-form record.*

### 2026-07-04 — Employee brands, prod backfill, bus-calc sticky, docs reorg (portal + ERP), catalog CBN rule

- **Service/Spares require Brands** (PR #69, `49e93ad`, deployed): `src/pages/Employees.jsx`
  gained a required Brands picker for the Service and Spares departments (was Sales-only);
  validation + create/update payloads persist `brand_ids` for both. Client-only — the
  `admin-users` EF already writes `brand_ids → user_brands` generically.
- **Prod brand backfill** (via `.env.prod.bak` service-role key → REST, dedup-safe): all 5
  PTB Service staff → AL; PT Service (Jitendra Arora) → AL + HDH + Switch. So no existing
  service/spares user is blocked by the new required-brand gate.
- **Bus Calculator sticky estimate card** (PR #71, `bbb9e16`, deployed): the summary panel
  had `position:sticky` but its wrapper grid item shrink-wrapped under `.bc-layout{align-items:start}`.
  Fixed with `.bc-sum-col { align-self:stretch }` inside the existing `@media (min-width:960px)`
  block. Verified sticky at 1280px, unchanged (static/stacked) at 375px mobile.
- **gitignore `.env*`** (PR #70, `f8de64b`, deployed): broadened from `.env`/`.env.local`
  to `.env*` + `!.env.example` so the local prod-creds `.env .prod .bak` can never be staged.
- **Documentation reorganization** (PR #72, `7aeefc9`, deployed): created this master archive,
  `docs/RECONSTRUCTION.md`, and `docs/db/` (gold-standard `schema-current.sql` + `seed-reference.sql`
  from the owner's `pg_dump`); slimmed `CLAUDE.md` 957→90 lines to an operational core with a
  Documentation Map; refreshed `README.md`; tidied `docs/` into `history/` + `backlog/`; fixed stale
  memory reference docs against the post-Phase-6c model. Also surfaced Phase 10 (Vehicle Tracker) as
  planned (`docs/backlog/phase10-vehicle-tracker.md`).
- **ERP documentation reorganization** (separate repo `erp-parastrucks`, PR #1): mirrored this scheme
  onto the HD Hyundai ERP — created its missing `CLAUDE.md` + `README.md`, `docs/RECONSTRUCTION.md`,
  and `docs/history/HISTORY.md` (folding in the 11a–11k build knowledge that had been stranded in the
  portal's memory). See `memory/project_hd_hyundai_vertical.md` (now a pointer).
- **Catalog: one CBN per sub-segment — latest assignment wins** (PR #73, `a69887d`, deployed):
  `src/pages/Catalog.jsx` — the sub-segment Add picker selected only `cbn, description`, so its
  "unallocated only" filter (`!v.sub_category`) was always true → every CBN showed as available and
  could be silently pulled from another sub-segment. Fix: picker now selects `sub_category`, shows all
  CBNs badged with their current sub-segment (`• in <name>`), and reassigns on save with
  **last-write-wins** (owner's rule: latest assignment takes priority) + inline note + post-save toast.
  A CBN is only ever in one sub-segment (single `sub_category` column; `cbn` UNIQUE).
- **Docs catch-up** (PR #74, `6288473`, merged): appended the ERP-docs reorg + catalog #73 above (this
  archive was written mid-session and omitted the later work).
- **Secret leak — rotated + scrubbed** (PR #75, `f4924b0`, merged): GitGuardian flagged the **`SYNC_SECRET`**
  Bearer token embedded in the `sync_erp_users` `pg_net` webhook trigger's `Authorization` header, which
  `pg_dump --schema-only` captured into `docs/db/schema-current.sql`. It's a custom shared secret guarding
  the portal→ERP sync EF — **not** the service-role key (no DB access). Fix: redacted to a placeholder +
  scrub note in `RECONSTRUCTION.md`; **owner rotated `SYNC_SECRET`** across all 4 places (portal webhook
  header + `sync-erp-users` EF secret + ERP GitHub Actions secret + `erp-parastrucks/.env`); verified
  old→401 (dead), new→cron run green. `gitleaks` missed the hex-in-JSON pattern; GitGuardian caught it.
  **Future schema-dump refreshes MUST scrub `Authorization: Bearer` headers before commit.**

### 2026-07-07 — AL July-2026 pricelist applied to prod catalog (data-only, no deploy)

- Source `D:\Claude CoWork\PTB\Pricelist\PTB_CombinedPricelist_20260706.xlsx` (870 rows; 4 AL circulars
  WEF 1-Jul-26; also carries Base Price + Dealer Markup, which the catalog does **not** store — MRP-incl-GST
  only). Applied to prod `vehicle_catalog` (`mmmxvjaavdtwlpcnjgzy`) via service-role REST, matched by CBN.
- **770 existing CBN prices updated + 100 new CBNs inserted** → catalog **906 → 1006**; all 870 set
  `effective_date=2026-07-01`, `price_circular='Jul 2026 Circular'`.
- **Portal taxonomy preserved** — the file's coarser AL segment/sub-segment names were NOT imported (would
  have broken quotation filters + brochure sub-segments). New CBNs' taxonomy was derived from a
  matched-CBN `file-sub-segment → portal` map (82 auto; 16 CNG → `Ecomet CNG`; 2 orphans hand-assigned:
  MCV bus `CCT25120D00027` → `Bus – MCV`/`12M Coach`; tipper `CTN482529B0052_YW` → **new sub_segment
  `10x2 Tipper – 48T GVW`**, id 45).
- **136 catalog CBNs not in this circular** (heavy 35T/55T tractors, RMC/Boom Pump, special variants) left
  **untouched per owner** — still sold, keep older prices; NOT discontinued.
- Data-only (no deploy — catalog is read live, so new prices are immediately in effect for new quotations).
  Rollback backup: `D:\Claude CoWork\PTB\Pricelist\catalog_backup_pre_20260706.json` (906 rows, old prices).
  The two new sub-segments have no brochure PDF yet (attach via Catalog UI).

---

## Appendix — archived `project_next_session.md` (pre-reorg snapshot, 2026-07-04)

*Preserved verbatim during the documentation reorg. The live memory file was rewritten to a
lean "next actions + backlog"; its full prior content (dated reminders, per-session status,
deferred engineering backlog) is kept here for the record.*

## Dated reminders — check on next session

- **On or after 2026-06-02 (≈15 days post-Phase-9 prod deploy of 2026-05-17/18) — Phase 9 prod-soak verification + cleanup.**
  1. Confirm prod stable: scan Supabase logs (Edge Functions + Postgres) for any new 5xx / RLS-denial spikes since 2026-05-18; check Vercel deploy logs for new build errors; ask user if any staff have reported regressions since Phase 9.
  2. If clean, with user's go-ahead: delete local dump artifacts in main worktree (`prod_schema.sql`, `prod_seed_data.sql`, `staging_apply.sql`, `prod_backup_pre_phase9_*.sql`) and remove the worktree `.claude/worktrees/elated-volhard-c88b85` plus its branch `claude/elated-volhard-c88b85`.
  3. If NOT clean, log findings and roll back the cleanup decision; the dumps are the only off-machine backup.

- **Standing rule (no fixed date) — Phase 6b column-drop verification window.**
  Whenever a legacy-column/table drop comes up for approval, require ≥1 week (preferably ≥2 weeks / 15 days) in production with the *new* code path live and the old columns *unread*, before submitting the DROP to the user. Confirm zero reads from Supabase Postgres logs first.

- **On or after 2026-06-04 — `public.roles` table drop eligibility check.**
  Code-side gate is OPEN as of 2026-05-21: zero references in `src/` or `supabase/functions/`; only the table's own RLS policies (Phase 5 migration `20260411_phase5_u1_rls_coverage.sql:70-75`) remain. Action on 2026-06-04 (≈2-week runtime window):
  1. Query Supabase Postgres logs (`get_logs` MCP / dashboard) for any `roles` table activity since 2026-05-21 — `SELECT/INSERT/UPDATE/DELETE` on `public.roles`. Free-tier retention is 7 days, so the actual check must happen within a week of the target date or earlier.
  2. If logs show zero reads/writes, submit `DROP TABLE public.roles CASCADE` (with policy + grant cleanup) to user for explicit permission. Per "Never delete DB rows/columns/tables without explicit permission."
  3. If logs show ANY activity, stop and investigate the caller — there's an off-codebase consumer (script, external tool, manual psql) the grep missed.

## Status as of 2026-05-18 (end of session)

**Phase 9 sub-phases 9b–9g DEPLOYED to production and verified end-to-end. portal HEAD `9e668b2`.**

### Just-completed (2026-05-17/18)
- **Phase 9 fully shipped to prod.** Staging Supabase (`klpnhpnlotcbbovwswmq`, paras-portal-staging, Mumbai) stood up from a prod dump; 9/9 functional tests + console-strip check passed there before prod. Then prod: Functions secrets set (`ALLOWED_ORIGINS=https://team.parastrucks.in`, `REQUIRE_CAPTCHA=true`), 2 migrations applied via `psql`, 6 EFs redeployed (verify-login v6, admin-users v12, admin-access-rules v10, admin-catalog v9, admin-tiv v11, log-error v9), pre-deploy `pg_dump` backup taken off-machine.
- **PRs merged to portal:** #57 (`421259b` Phase 9 9b–9g) · #58 (`b9cce59` CSP root-path `/:path*`→`/(.*)`) · #59 (`bf2553e` Catalog brand_id) · #60 (`9e76199` date-helper UTC→local-time fix) · `9e668b2` (CLAUDE.md deployment record).
- Full deployment record is now in `CLAUDE.md` at repo root ("Phase 9 — Deployment Record" section).
- Prod smoke test passed: login + Turnstile + quotation + PDF all working; CSP/headers/CORS/security.txt curl-verified.

### Still pending / next session
- **VAPT re-test findings (2026-05-18) — ALL TABLED by user, none actioned.** 3 red-team agents re-attacked prod after Phase 9 shipped; perimeter held. Out-of-scope gaps logged: C1 (High, live — `users_select` RLS leaks coworker PII entity-wide), M-1 (catalog bulk-upsert mass-assignment), M-2 (admin-tiv cross-entity write IDOR), H-1/H-2/M-3/L-1/CORS (low). Full report: `docs/security-vapt/phase9-verification-report.md`; table in `CLAUDE.md`. C1 needs a product check (does any UI need an entity-wide employee list?) before fixing.
- **9h** — medium-effort hardening (MFA for admin/HR, new-device email, active-sessions page, security-monitor cron, file-upload virus scan, PII encryption). Multi-week; not started. Each is its own PR.
- **9i** — programme/process items (vendor VAPT, training, calendar). Not engineering work.
- Transitive CVE residuals `postcss 8.5.8` (GHSA-qx2v-qp2m-jg93) + `dompurify 3.3.3` — fixable via `package.json` `overrides`; deferred.
- Cleanup when prod confirmed stable: worktree `.claude/worktrees/elated-volhard-c88b85` and local dump files (`prod_schema.sql`, `prod_seed_data.sql`, `staging_apply.sql`, `prod_backup_pre_phase9_*.sql`).
- Optional: manual .xlsx Catalog-import verification (PR #59's fix).

### Gotchas learned this deploy (keep)
- Supabase CLI `db dump`/`db push` need **Docker** (not installed locally). Workaround: native `pg_dump`/`psql` (installed via `winget PostgreSQL.PostgreSQL.17`) through the **Session Pooler** URI (Direct connection is IPv6-only on free tier).
- The `supabase/migrations/` folder is **not** a full history (starts `20260401_*`) — a fresh Supabase project cannot be built with `db push`; bootstrap from a prod dump instead.
- CSP is enforced via the header on the **document**; verify by curling real URLs, not by reading `vercel.json`. `vercel.json` header `source` must be `/(.*)` (matches root), not `/:path*` (doesn't).
- The login-page console is flooded by Cloudflare Turnstile's own iframe noise — do CSP console checks on app pages, not `/login`.

### Prior — Status as of 2026-05-14

**One hotfix shipped; large Phase 9 security stack staged locally (unpushed) — NOW MERGED, see above.**

### 2026-05-14 session
- **PR #56** (`1a2ecaa` on portal, squash-merged): `fix(tiv): always show current month in forecast horizon`. **Reverses the product decision in `eb481c6`** (the 2026-05-01 hotfix). Today's `lastDataMonth=Apr-26`; old behaviour started forecast at Jun-26, new behaviour starts at May-26. Anchored at `currentMonth` instead of `currentMonth+1`. Horizon math preserved (skipped months still increment horizon). File: `src/tiv-forecast/lib/forecastEngine.js:69-98`. Vercel auto-deploy confirmed `success` at 2026-05-14T08:46Z.
- Reason: users prefer always seeing the current month in the grid, even though it's partially-elapsed (a nowcast). The earlier hotfix's "pure forecast only" rule was unwelcome.

### Phase 9 — Security & Hardening — IN PROGRESS, unpushed, on worktree
- Worktree: `.claude/worktrees/elated-volhard-c88b85/` on branch `claude/elated-volhard-c88b85`.
- 7 unpushed commits forming a complete code stack (9b–9g) — verifications + deploys NOT done.
- Plan + handoff context lives in `CLAUDE.md` at worktree root (734 lines, also committed as `e7410a7`).
- Commit stack (in order): `e7410a7` (docs), `4f1037c` (9b deps), `7b8006f` (9c EF perimeter), `fc9161d` (9d migration SQL), `16866bb` (9e privilege EFs), `caa4813` (9f CSP/UUID brochures/idempotency), `c632feb` (9g security.txt/workflows/husky).
- Two transitive CVE residuals open: `postcss 8.5.8` (GHSA-qx2v-qp2m-jg93) and `dompurify 3.3.3`. Fixable via `package.json` `overrides`; deferred pending decision.
- Manual ops checklist (staging Supabase setup, Supabase dashboard toggles, DNS, Cloudflare WAF, GitHub repo settings, prod deploy) is in chat history of session ending 2026-05-14; reproducing it would be a 30-min ask. **User does NOT have staging Supabase yet** — that's the first concrete blocker on resumption.
- Explicitly NOT done: 9a baselines, 9h (MFA / Resend / sessions / virus-scan / PII encryption — multi-week feature work), 9i (vendor procurement, training, calendar items).

### Prior sessions for reference
- **2026-05-01:** TIV hotfixes (`a2e313e` entity dropdown column rename; `eb481c6` skip elapsed months — now superseded by PR #56).
- **2026-04-23:** PR #55 (`58b083c`): FC PDF V2 tax-invoice redesign.

### Prior session (2026-04-23) — for reference
- **PR #55** (`58b083c`, squash-merged to portal): FC PDF V2 tax-invoice redesign. HSN per line, CGST+SGST/IGST split, PAN, Indian-numbering amount-in-words, ship-to, dispatcher pattern via `pdf_format_version`. 21/21 smoke passed.

### Deferred (unchanged, no active owner)
> **2026-05-21 recategorization** of column/table drop items (was: lumped under "deferred = ready, just waiting"). A grep of `src/` and `supabase/functions/` showed three of the four drop items still have live callers → they are **blocked on refactor**, not waiting on a clock. Only `roles` is genuinely waiting-only (see dated reminder above).

1. **REFACTOR REQUIRED (not just deferred)** — Drop DB column `financier_copies.valid_until`. Code-side gate CLOSED: `FinancierCopy.jsx:327` writes it, `FinancierCopyLog.jsx:46` + `MyFinancierCopies.jsx:30` read it, `pdfGenerator.js:1528` reads it. Identical `valid_until` column on `proforma_invoices` + `quotations` similarly used — these are load-bearing, not residual. Refactor target unclear; needs product decision before any code work.
2. Vercel env var: `VITE_TURNSTILE_SITE_KEY` on prod (verify present)
3. Assign brands to Ashok Prajapati in Employees UI (blocks his vehicle dropdown)
4. PDF generator `operating_units` lookup — still uses legacy brand+location text
5. **`public.roles` legacy table** — code-side gate OPEN as of 2026-05-21; dated runtime-window check on 2026-06-04 (see dated reminders). **`public.locations` legacy table** — code-side gate CLOSED: `AccessRules.jsx:422` selects from it; `admin-access-rules/index.ts:264, 281` inserts and reads it. **Not deferred — actively used.** Refactor (or accept the table as non-legacy and remove from this list) before any drop discussion.
6. **REFACTOR REQUIRED (not just deferred)** — `vehicle_catalog.brand` text column. Code-side gate CLOSED: `Catalog.jsx:72` and `:1503` both `.select('... brand ...')` (text column, alongside `brand_id`). Refactor: switch both selects to join `brands` via `brand_id`. Smallest of the three blocked items — good "tabled for later" candidate.
7. `next_quotation_number` RPC — refactor to accept `entity_id`
8. Apply tax-invoice redesign to Proforma Invoice PDF if/when requested
9. Promote HSN to a `vehicle_catalog` column with seed data (currently form-only per chip)
10. **Audit other Supabase queries that swallow `error` in `.then()` destructuring** — the TIV bug pattern (`.then(({ data }) => ...)` ignoring `error`) likely exists elsewhere. Worth a one-pass grep for `\.then\(\(\{\s*data\s*\}\)`.

### Context for next agent
- Supabase project `mmmxvjaavdtwlpcnjgzy`. All 6 EFs `verify_jwt:false`.
- Main worktree: `D:\PTB\Website\portal_phase1a_setup\portal` (branch `portal`, latest = `1a2ecaa`).
- Worktrees under `.claude/worktrees/<slug>` — `crazy-vaughan-fa55f7` exists from FC work but is now stale; safe to remove if tidying up.
- `entities` table columns: `id, code, full_name, address, gstin, bank_name, bank_account, bank_ifsc, ...` (NOT `name`).
- Vercel deploy cmd from main worktree: `npx --yes vercel --prod --yes`. CLI installed via npx, not globally.
- Dev server: `preview_list` to find serverId; port 3000 in worktree.
- Never delete DB rows/columns/tables without explicit permission.
- Platform: Windows, bash via git-bash, no Python.
- Hotfixes vs features: small UI/data fixes can go direct to `portal` branch + push + redeploy. FC-scale work uses feature branch + PR + squash-merge.

---

## Phase 9.6 — Portal visual redesign (Paras Group print-report language) — ✅ LIVE ON PROD (2026-07-16, PR #78 → `29404b4`)

Full **visual/structural redesign** of the whole portal to the Paras Group print-report design
language. Zero behavioural change intended — routing, Supabase, edge-fn calls, `canAccess`, and all
business logic preserved. On branch **`9.6-portal-redesign`** (off `origin/portal`, 21 commits,
every `npm run build` green). Smoke-tested on staging + 3-agent red-team (ship-safe). **Not yet
merged — PR + one-shot merge to `portal` pending owner go-ahead.** Live working state:
`memory/phase96_portal_redesign.md`; open owner decisions: `memory/known_issues.md`.

**Design language:** paper `#F4F4F4` ground · ink `#000` · `#D4D4D4` hairline-rule tables · square
corners (2px only on inputs/buttons) · ONE blue accent `#2563EB` · **Carlito** font (Google Fonts,
metric Calibri substitute) · thin-line **Lucide** icons. Source of truth = the design handoff at
`D:\PTB\Website\Website redesign guidance\design_handoff_portal_redesign\`. Plan
`~/.claude/plans/buzzing-popping-fairy.md`.

**Build (phased):** (0) `lucide-react` npm dep + Inter→Carlito. (1) rewrote `src/index.css` `:root`
tokens keeping the old names so ~400 `var()` refs cascade, retuned every family, appended
print-report primitives (`.page-head`, `.eyebrow`, `.tag`, `.stat-block`/`.stat-strip`,
`.table-card`/`.rowlink`, `.mobile-cards`/`.m-card`, `.panel`, `.only-desktop`/`.only-mobile`).
(2) `Icon.jsx` Lucide wrapper. (3) `Sidebar.jsx` → 4 labelled sections + pinned Dashboard + HD
Hyundai ERP item; shared `navConfig.js` + `lib/erp.js`; groups collapsed by default. (4) new mobile
shell — `TopBar.jsx` + `MobileDrawer.jsx` + hybrid `BottomNav.jsx` (dept tabs + centered Create(+)
→ `CreateSheet.jsx`, incl. New Vendor Job → `/vendor-jobs?new=1`); shell breakpoint 900→760.
(5) `Dashboard.jsx` → section eyebrows + `.dcard` link/group/inverted cards + MORE OPTIONS expander.
(6) PageHead on all pages + mobile stacked-card tables for customer-facing lists; dense admin tables
(Access Rules, TIV) stay h-scroll; Login dark→paper.

**Owner review fixes (staging walkthrough):** bottom nav capped ≤4 icons + centered create; New
Vendor Job in the + sheet; late-night greeting; removed doubled dashboard rule; **fixed mobile cards
leaking onto the desktop table**; vehicle search shows description + `ignoreLocation` + validation
focus (Quotation/Proforma/Financier); **HD Hyundai ERP entry brand-gated (hdh) so PTB users don't
see it** (`useErpVisible`, admin override, fails open on error). Residual polish: emoji→Lucide on the
last buttons; removed ~187 lines of dead `.tool-card*`/`.stat-*` CSS; fixed the long-broken favicon
(`public/favicon.svg`).

**Red-team (assumed pre-redesign portal was perfect) — regressions found & FIXED:** (H1)
`useErpVisible` failed CLOSED → fails OPEN on read error (pre-redesign the ERP card was always shown,
server-gated); (Med) `.badge-gray`/`.tag--inactive` text on grey ~2.4:1 → `--text-secondary` ~4.5:1;
(Med) six list-page `fmtINR` had lost the ₹ non-breaking space → restored; hardening —
`navConfig.itemVisible` erp→false. Verified clean: all `.select()` columns, PDF args, re-download
guards, pagination/search, `canAccess`, icon names, desktop↔mobile flip.

**Open owner decisions (flagged, not actioned):** M2 mobile bottom nav drops Profile tab for
Service/Accounts (Profile via top-bar avatar); M3 sidebar groups no longer auto-expand on active
route (per handoff); L2 drawer/sheet lack a focus-trap (net-new); LOW-1 log mobile cards omit the
preparer designation. All in `memory/known_issues.md`.

**Session 2 (2026-07-05) — red-team round 2 (4 Fable-5 agents) + fixes + prod brand provisioning.**
Re-ran the red-team with 4 parallel Fable-5 reviewers (data-integrity / access-control /
CSS-responsive / runtime-build) vs `origin/portal` as the "known-good" baseline. Verdict again
**SHIP-SAFE, no CRITICAL/HIGH**; build green, `npm audit` 0, all 51 Icon names resolve, zero orphaned
CSS, route/`canAccess` parity confirmed. Six fixes across two commits:
- `dff4211` — (1) `ServiceJobs` `?new=1` auto-open effect keyed on `searchParams` so Create (+) →
  New Vendor Job opens the form even when already on `/vendor-jobs` (was a mount-only no-op that also
  left the param in the URL); (2) hooks hoisted above the accessible-items early return in
  `Sidebar.NavGroup` + `Dashboard.GroupCard` (rules-of-hooks latent-crash guard); (3) shell mobile
  media queries `759px`→`759.98px` (closes the 759–760 fractional-viewport dead-zone under 125/150%
  display scaling); (4) drawer/sheet backdrops+panels hidden `@media (min-width:760px)` so a resize
  into desktop can't leave them overlaying the sidebar.
- `96d8f65` — (5) MED-2: normalized all 58 off-grid `font-weight` declarations (500/600/800) in
  `index.css`/`Login.css` to Carlito's real 400/700 grid — pixel-identical (browser already snapped
  them) but honest CSS + documented at the `--font` token; true 5-weight hierarchy would need a font
  swap away from the Calibri-metric Carlito (owner call, not done). (6) LOW: gated the "New …" CTAs on
  My Quotations / My Proformas / My Financier Copies behind `canAccess(route)`.
- **Resolved not-a-bug:** the "ERP-card gating changed" flag — prod audit confirmed the only
  `hdh`-branded user is in Service (keeps the card); nobody loses ERP access under the redesign.
- **Prod data fix (`user_brands`):** owner asked whether accounts/back-office/HR have brand
  provisioning "like sales/service/spares". Prod audit of all 36 users: sales (22 `al`), service
  (6, `al`+1`hdh`+1`switch`), back_office (3 `al`) were provisioned; **accounts (3) + hr (1) had
  zero brand rows**; owner (admin, no dept) bypasses. No `spares` department exists in prod. Owner
  rule = PTB→`al`, PT→all three; all 4 gaps are PTB → each got `al` (brand `1e7ab9db-…`). Inserted 4
  rows on prod `mmmxvjaavdtwlpcnjgzy` (merge-duplicates, no deletes) via the `.env .prod .bak`
  service-role key; re-verified accounts 3/3, hr 1/1, 0 remaining. Users: Pradeep Chavda (hr),
  Bhadresh Thakor / Mahir Makwana / Bhavesh Solanki (accounts).
- Cosmetic LOWs then addressed (commit `e992c17`): drawer closes on route change (browser back),
  drawer+sheet lock body scroll, bottom-nav no longer flashes the wrong FALLBACK tabs (`deptResolved`
  gate). Only the non-visual 3×-dup-`user_brands` ERP read left deferred.
- **All four owner design-decisions then resolved (2026-07-05):** M2 — accepted as-is (owner
  "reducing the tab is ok"; bottom nav keeps dropping the Profile tab on odd-count depts, Profile via
  top-bar avatar). M3 — **restored sidebar auto-expand** on the active route (`NavGroup` seeds
  `useState` from `isGroupActive` + effect; still collapsible). L2 — **wired `useFocusTrap` into
  MobileDrawer + CreateSheet** (Tab-cycle, Escape-close, `role=dialog aria-modal`); safe re the PR #42
  keystroke focus-steal (hook hardened to deps `[active]` + no text inputs in either overlay). LOW-1
  — declined (owner "no need").
- **Full local staging walkthrough (2026-07-07) — PASSED, zero console errors.** Dev server on
  `:5173` vs staging; logged in as `admin@` and `svc.mgr@parastrucks.test`. The preview harness has no
  layout viewport (`innerWidth` 0) so it renders the mobile shell — used that to verify live: M3
  sidebar auto-expand (group opens + active sub highlighted on nav, still collapsible); L2 focus-trap
  on drawer (18 focusables) + create-sheet (5) with Tab/Shift-Tab wrap + `aria-modal`; body scroll-lock
  engages+restores; drawer closes on link-nav AND browser-back; `?new=1` opens the New Job form from
  another page AND when already on `/vendor-jobs` (round-2 fix) with the param stripped; **ERP hidden
  on dashboard+sidebar+drawer for the PTB service manager** (owner requirement) while admin sees it;
  create-sheet `canAccess`-filtered (admin = 4 actions, service = New Vendor Job only); mobile cards
  render full data. **One residual emoji found + fixed** — login show-password toggle `👁`/`🙈` →
  Lucide `eye`/`eye-off` (`Icon` wrapper), verified live. Desktop *rendering* (sidebar-visible view,
  desktop tables, 759.98 fractional fix) still wants one real-browser eyeball — not renderable in this
  harness. Branch now **31 commits** ahead of `origin/portal`, all pushed, build green. PR → one-shot
  merge still pending owner go-ahead.

**Session 2026-07-14 — owner step-by-step localhost review (Phase 9.6).** Owner reviewed the
redesign screen-by-screen on `localhost:5173` (staging DB); each fix committed as it landed (new
standing preference). Branch → **40 commits, all pushed**, build green. Fixes:
- **Catalog stray vertical scrollbar** — `.vc-tabs` / `.table-wrap` set `overflow-x:auto`, which per
  CSS spec makes `overflow-y` compute to `auto`; the tab row was 2px taller than its box, so a
  phantom scrollbar appeared. Pinned `overflow-y:hidden` on both.
- **Mobile drawer, mweb-first** (owner: "sidebar menu looks too tiny on mweb") — 50px touch targets,
  16px text, larger section labels, and **collapsible groups with chevrons that auto-expand the
  active group** — restoring the dropdown chevron that had "disappeared" on mobile vs desktop.
- **Bus Calculator re-skin** (owner: "has not been redesigned") — it had only received the PageHead +
  token cascade. Swapped the ⌕/🚌 and School/Staff/With-AC emoji for Lucide (toggles now text-only,
  matching the seating buttons); gradient summary header → solid ink; multi-colour spec tags →
  monochrome with length as the one accent; blue-washed chassis card / dropdown / notes / formula →
  white + hairline + ink top-rule; **₹ and the amount unified into one bordered control** (the ₹ had
  sat outside a box with the number right-aligned, leaving a gap that read as "uneven"); sticky
  summary `top` 80→24px.
- **Lining figures, app-wide** (owner: "the 8 is larger") — Carlito/Calibri default to **old-style
  numerals**; a canvas measurement confirmed "8" ink-ascent **139px vs 131px** for "0"/"1", so 6 and
  8 ride tall. Added `font-variant-numeric: lining-nums` on `body` and folded it into the existing
  `tabular-nums` declarations. Fixes every number in the app.
- **Full emoji → Lucide sweep** — 37 glyphs across 17 files: empty-state icons, brochure paperclips,
  Coming-Soon wrench, overdue clock, Filters gear, the **⚠ in every alert box**, ✕ modal-close, and
  ✓/ℹ toast marks. Residual scan clean — no UI-facing emoji remain.
- **Validation errors moved to the field** (owner: *"banners are not intuitive. Nobody will scroll
  up."*) — `errorField` state flags the offending input red (`.error`, strengthened to beat `:focus`)
  and renders the message inline under it (`.form-error`), clearing as the user types. The top alert
  banner is **deleted**; save/server failures become toasts. Done on Quotation, then rolled to
  Proforma, Financier, Login, Profile (AccessRules/Employees part-done; Catalog, ServiceJobs and TIV
  still pending). `ErrorBoundary` keeps its banner by design — a full-page crash has no field to
  point at. Also gave "Reset to catalog" `btn-secondary` (a bare `.btn` has no fill/border in the new
  design and read as plain text).
- **DECIDED: PDFs keep "Rs.", not ₹.** jsPDF's built-in fonts are WinAnsi-encoded and have no glyph
  for U+20B9, so the code prints "Rs." deliberately. The only fix is embedding a TTF; the verified
  path (Arimo — metric-compatible with Helvetica, so the hard-coded mm tax-invoice columns would not
  shift — subset via `subset-font`, base64 into jsPDF) was prototyped then reverted as not worth
  blocking the ship. Not a redesign regression: `pdfGenerator.js` is untouched by 9.6.

**Banner sweep COMPLETE (2026-07-14, branch at 43 commits).** Every top-of-page/top-of-modal error
banner in the app is gone; the only one left is `ErrorBoundary` (a full-page crash screen — there is
no field to point at). **Inline-at-field** (offending input turns red, message renders directly
beneath it, clears as the user types) for genuine field validation: Quotation, ProformaInvoice,
FinancierCopy, Login (message under the password, both fields red on a credential failure), Profile,
AccessRules, Employees, and Catalog's SubSegmentModal (Name / Segment). **Toast** for everything with
no field to point at: Catalog ImportTab (header-row / CBN / MRP / brand / parse failures), Catalog
brochure-file errors (these had *also* been feeding the banner and would otherwise have been silently
dropped), ServiceJobs (load / create-job / action failures), TIV UploadPanel (size / not-xlsx / parse
/ read / upload) and TivForecastPage (load). Verified: build green; `grep -rln "alert alert-error"
src` returns ErrorBoundary only; zero orphaned `setError`/`parseError`; no error message lost.
*Gotcha:* `ServiceJobs.jsx` already had a local success-pill state literally named `toast`
(`.sj-toast`), so it was renamed to `pageToast` to free the name for `useToast()` — pill behaviour
unchanged.

**Session 2026-07-16 — owner screen-by-screen review COMPLETE (Phase 9.6). Branch at 53 commits, all
pushed, build green. Every screen passed; opening the PR to `portal` is the only step left.**
Eight commits landed this round (each committed as the owner found it, per the commit-each-fix rule):

- **ERP gating as `svc.mgr`** — PASS. HD Hyundai ERP correctly hidden on the dashboard, sidebar *and*
  drawer for a PTB service manager; visible again for admin. (The R1 red-team fail-open fix holds.)
- **Vendor Jobs — native Chrome validation bubble** (`d55c180`). The New Service Job form still used
  the HTML `required` attribute, so Chrome intercepted submit and drew its own off-design bubble
  ("Please select an item in the list.") before our code ran. Fixed with `noValidate` + JS validation
  → red field + `.form-error` beneath, clearing as the user types. Covers reg-no, customer, vendor,
  material-out date and the three required warranty-letter fields.
- **Vendor Jobs — mobile fold** (`d9e5ba0`, superseded by `d274bb4`). The first attempt compacted
  every band; the owner rejected it ("rather than resizing to make it look awkward, remove the green
  line and merge sort into the filter button"). Final: the **green all-clear radar banner is deleted**
  (the bar is exception-only now — silence means everything is on track) and the standalone mobile
  **sort bar moved into the Filters popover** (mobile-only; desktop still sorts from table headers).
  The app-wide page-head margin trim from the first attempt was reverted. Net ≈90px reclaimed with
  nothing resized. Verified end-to-end: job create → `PO-PTB-2026-27-0001` generated + downloaded,
  green "Job created · PO downloaded" pill (the renamed `pageToast`), mobile (+) → New Vendor Job.
- **Employees** (`d2f28be`). The four always-open filter selects (entity / department / level /
  status) stacked into a four-row block on mobile → collapsed behind a **Filters button + popover**
  (the Vendor Jobs pattern; count badge + Clear/Done, search stays inline). Edit-modal footer tagged
  `.modal-actions` so the buttons wrap on a phone — **"Delete Permanently" was cut off the edge**.
- **🔴 GLOBAL modal-header regression** (`bd51070`). The redesign had moved the header's flex layout
  onto a new `.modal-header-main` wrapper that **only the ServiceJobs modal uses**, so **all 8 simple
  modals** (Employees edit / reset-pw / confirm, AccessRules ×2, Catalog ×3) lost their row layout and
  stacked the ✕ as a grey circle *below* the title. Fixed by restoring flex on `.modal-header` itself,
  with `flex-basis:100%` on `.modal-header-main` / `.modal-header-extra` so ServiceJobs keeps stacking
  its subtitle + badge row. **All 10 modal-header call-sites audited: 8 fixed, 2 pixel-identical** —
  the ServiceJobs job-detail modal (the only one that actually passes `headerExtra`, a `.sj-badges`
  row) and the Catalog sub-segment detail modal (`<div>` title + `<div>` actions, handled by
  `space-between`). Owner eyeballed both.
- **Access Rules → Errors tab 400** (`096cef1`) — **a pre-existing, prod-affecting bug, not a redesign
  regression** (the query was byte-identical to `origin/portal`). The tab embedded
  `user:users(full_name,email)` on `error_log`, but `error_log.user_id`'s FK targets **`auth.users`**,
  not `public.users`; PostgREST only exposes `public`, so it could never resolve the relationship —
  400 *"Could not find a relationship between 'error_log' and 'users' in the schema cache"*, and the
  tab silently showed "No errors logged" even with rows present. Fixed app-side (no schema change):
  drop the embed, resolve display names with a second `users` lookup on the distinct ids.
  *Lesson:* a PostgREST embed needs a **declared FK on the exposed schema** — a matching id column is
  not enough.
- **TIV — key-prop warnings** (`6df6135`). `.map()` returning a bare `<>…</>` fragment, which **cannot
  carry a key** (the inner `<th>`/`<td>` keys don't count — React needs it on the top-level mapped
  node). ForecastTable ×3 + AccuracyTrackerTab ×1 → keyed `<Fragment>`.
- **Toast contrast** (`6df6135`) — owner: *"not visible"*. Toasts were a pale wash (dark-red text on a
  near-white pink) that barely lifted off the page. Now **solid saturated fills with white text**
  (success / error / info, all passing WCAG AA) and the ✕ went .5→.8 opacity. **Global** — every toast
  in the app. Confirmed live on Profile's "Password updated successfully." (solid green).
- **TIV charts** (`31990e1`) — owner: *"graphs have not been redesigned"*, and they were right: the
  charts still carried the pre-redesign colours. `SEG_COLORS`' saturated rainbow
  (`#E67E22`/`#2ECC71`/`#9B59B6`/`#E74C3C`/`#1ABC9C`) → a **muted categorical set** at the design
  tokens' own saturation, led by the accent blue. **Six distinct hues were kept deliberately** — the
  "TIV Forecast by Segment (all segments)" **stacked bar** genuinely needs them; collapsing to one
  blue would have made it unreadable. On the Accuracy chart the **"Judgment" series identity was
  `#F59E0B`, which collided with the semantic amber ≤25% threshold** (one colour, two meanings) →
  identity is now **ink** (blue vs ink reads cleanly and is on-language). Chrome: tooltip → a
  print-report card (hairline, 2px radius, soft lift), axis ticks/lines → secondary/hairline,
  recharts' default `#8884d8` purple fallback → accent, active-trigger banner radius 6px→2px.
  **Deliberately unchanged:** the accuracy **threshold** colours (green ≤15% / amber ≤25% / red >25%)
  encode meaning, not decoration — they only moved from a raw hex onto the `--amber` token.
- **Profile** — PASS. Inline validation ("Password must be at least 8 characters." at the red field),
  the new solid-green success toast, clean mobile stacking, clean console.
- **760px shell boundary** — PASS. Swept 386 / 700 / 759 (mobile shell) → 760 / 761 / 768 (desktop
  shell): exactly one shell at every width, a clean single switch, no flicker, **no dead zone, and
  768px iPad-portrait lands correctly on desktop**. The R2 `759.98px` fractional-viewport fix holds.

*Note:* the two console warnings present on every page (React Router v7 `startTransition` /
`relativeSplatPath` future flags) are **also on production** — not redesign noise.

**Session 2026-07-16 (evening) — Excel templates, two catalog fixes, and the Phase 9.7 plan.
Branch at 58 commits, all pushed; owner set the 9.6 deploy for TONIGHT.**

- **Excel templates on both upload surfaces** (`cadd116`, owner-directed): "Download template" on
  Catalog→Import (Price_Circular_Template.xlsx — instruction row ABOVE the header row so the CBN
  header-finder skips it; deliberately NO example data rows, so an unedited upload imports zero
  vehicles) and TIV→Data Upload (Market_Data_Template.xlsx). The TIV generator
  (`downloadMarketDataTemplate`) lives in `parseExcel.js` next to the parser and is built from the
  SAME constants the parser reads (6-sheet order, month format, RAW_SEGMENT_ROWS row indices), so
  template and import can never drift apart; the Raw-Data month placeholder `<Apr-22>` is
  angle-bracketed so `parseMonthLabel()` ignores it until replaced. Client-side via the bundled
  `xlsx` lib — no static assets, no new dependencies.
- **Sub-segment modal showed the brochure upload progress twice** (`4ec8b32`) — owner spotted it on
  prod: "Uploading… 0%" under the file button AND a leftover "Uploading brochure… 0%" under the
  Active checkbox. Second block removed; the save button still mirrors the percentage (intentional).
- **Family variant list shows the full price-list description** (`83d088e`) — `.vc-desc` truncated
  at 320px with an ellipsis, hiding exactly the load-span/cabin/fuel details that distinguish CBNs
  within a family. Scoped override on `.vc-wide-modal .vc-desc` wraps it in full; the main Vehicles
  table keeps its ellipsis. (Tyres was already a column.) Fast-tracked from the 9.7 F3 spec.
- **Catalog UX brainstorm → Phase 9.7 plan** (`fdbb562` → `docs/backlog/phase97-catalog-ux.md`).
  Two rounds of interactive visual prototypes (artifact `aa2a498e-8d7f-46ad-ad71-9b927eb79d1f`);
  core reframe: **brochures are the catalog's primary job, one brochure ↔ many CBNs, the
  sub-segment (family) is the unit**. Owner approved: F1 search-first landing + per-user shelf ·
  F2 brochure wall (covers pre-rendered once at upload — never live PDF rendering) · F3 hierarchy
  fallback · S1 family-level WhatsApp share landing as an editable draft · A1 four-tab admin
  workbench (reshuffle with inline "+ new sub-segment", import triage queue, rules with NOT-terms,
  Families retire/reactivate lifecycle). Keystone: additive `vehicle_catalog.sub_segment_id` FK
  replacing the name-text linkage — which is also why the sub-segment Name/Segment edit fields are
  disabled today (BY DESIGN, not a bug; owner hit this on prod). Owner rejected: WhatsApp bot,
  QR-on-print, and all price-first ideas (price card / compare / quote-this / circular history /
  price book). 9.7 builds after 9.6 is live, own branch and PRs — only the two safe presentational
  pieces above rode the 9.6 release.


**Session 2026-07-16 (night) — 🚀 Phase 9.6 GO-LIVE. PR #78 squash-merged to portal; prod + CSP verified.**

- Owner gave the word ("let's go live" → "go"). Pre-flight: `origin/portal` had moved **+5
  commits** during the 9.6 build (the ERP-sync fixes `3bd278b`/`9e030b6` + docs/security
  `7cdbee6`/`f4924b0`/`6288473`) → rebased the branch onto latest portal per the
  parallel-changes rule. **Clean rebase of all 59 commits**, build green (432ms), force-pushed
  with lease.
- **PR #78** (`9.6-portal-redesign` → `portal`) opened with the full release summary. All
  checks green: CodeQL (+ JS/TS scan), npm-audit, gitleaks, trivy-fs, and all three Vercel
  builds completed — including the `portal` prod-candidate.
- **Squash-merged** on the owner's "go" → merge commit `29404b4` (2026-07-16T14:30Z).
- **Verified live:** Vercel production deployment for `29404b4` = READY (target=production,
  branch portal). Curled real page URLs — `team.parastrucks.in/` and `/login` both 200 with
  the **full CSP intact** (script-src self+Turnstile, fonts.googleapis/gstatic, frame-ancestors
  none, HSTS preload, X-Frame-Options DENY). Served HTML loads **Carlito** (no Inter) —
  confirming the new build, not a stale cache.
- **Phase 9.6 is COMPLETE.** 59 commits, 2 red-team rounds, a staging smoke-test, and a full
  owner screen-by-screen review, released in one shot.
  Next build: **Phase 9.7 Catalog UX** (`docs/backlog/phase97-catalog-ux.md`).


---

**Sessions 2026-07-17 → 2026-07-20 — 🔨 Phase 9.7 Catalog UX: BUILT & STAGING-VERIFIED (not yet on prod).**

Branch **`claude/phase-9-7-start-0c4b8d`** (26 commits, off `origin/portal`, worktree
`.claude/worktrees/suspicious-snyder-af9361`). Every sub-phase built and verified against the
**staging** Supabase project `klpnhpnlotcbbovwswmq` (migrations via `psql` Session Pooler; the
`admin-catalog` EF redeployed to staging several times via `npx supabase functions deploy … --no-verify-jwt`).
Owner reviewed direction throughout; **decided the whole package ships to prod as ONE release** (like
9.6), not incremental deploys. Full living plan + red-team log + cutover order: `docs/backlog/phase97-catalog-ux.md`.

**Discovery that reshaped the work:** staging is **NOT** a copy of prod. Twice, silently — (1)
`sub_segments` held a single fixture row (`ECOMET 1115`) against a full 906-row `vehicle_catalog`;
reseeded from a prod `pg_dump` of the 49 real families. (2) staging's `storage.objects` had **zero**
RLS policies for the `brochures` bucket, so every brochure read 404'd while uploads succeeded
(signed-upload URLs bypass RLS) — copied prod's four `brochures_*` policies verbatim
(`docs/db/staging_storage_policies.sql`). Standing lesson recorded: verify, never assume staging
mirrors prod. Also surfaced **R9**: `RECONSTRUCTION.md` cannot actually rebuild the portal — it never
creates the Storage bucket and the bucket row is not in `schema-current.sql`.

**9.7a keystone** (`1b99aa7`, `8902060`, `00261d3`, `1aaf1bb`): additive `vehicle_catalog.sub_segment_id`
integer FK (the 9.7 plan said uuid — wrong; `sub_segments.id` is a serial) + name-match backfill
(`sub_segments.name` is globally UNIQUE, so no fan-out). Reads/writes moved onto the id; **rename
unlocked** (was disabled by design because CBNs were tied by name text) via EF `renameSubSegment`
which syncs `sub_category` on every linked CBN — verified end-to-end (`renamed: 33`, text propagated,
32 active + 1 inactive reconciled). Prod prediction: **976/1006** CBNs link; the 30 that don't are 5
family names never created (the Import-triage opening queue). `SEGMENTS` gained `MBP Truck` as a
stopgap (11 prod families lived there but the constant omitted it → blank segment dropdown).

**MBP Truck → Long Haul Trucks consolidation** (`6ebd19a`): a prod reconciliation proved
`vehicle_catalog` has **zero** MBP Truck rows — the vehicles were migrated long ago and only 11
`sub_segments` rows lagged. So an 11-row `UPDATE`, not a data migration; guarded to abort if any
vehicle still claims MBP Truck. Owner decisions: retire the empty `Haulage – CNG 19T` leftover;
leave `Haulage – 19T`'s 6 CBNs for hand-triage in Reshuffle. (The retire step no-op'd on staging —
that family holds 6 CBNs there vs 0 on prod — so on prod it must print `UPDATE 1`, else STOP.)

**R2 fix** (`2a11a72`): **PostgREST silently caps every response at 1000 rows.** `vehicle_catalog` is
1006 on prod, so the admin catalog was already truncating ("897 of 1000" vs 1006) AND
Quotation/ProformaInvoice/FinancierCopy (897 active) were one circular from losing vehicles from
**quotation search** with no error. Extracted `fetchAllRows` to `src/lib/fetchAll.js`; paginated all
four readers (+ `.order('id')` tiebreak). Owner found the gap by noticing the 1000/1006 mismatch.

**9.7b workbench** (`2fefc8c`, `ffc6f28`, `b4abd8f`, `2f6c52a`): `catalog_assign_rules` table
(admin/back_office-only RLS, pattern + NOT-terms, unique per family) + the atomic
`move_cbns_to_family` RPC (EXECUTE revoked from anon AND authenticated — the project's known gotcha —
granted only to service_role; verified a real `service`-role user gets 403). EF actions: `moveCbns`
(writes **all three** placement columns id+text+segment together — **R10**: it originally omitted
`segment`, caught by a cross-segment test move, so a CBN moved across segments kept its old segment),
`setSubSegmentActive` (retire refused while active CBNs remain), `setSubSegmentSegment` (**R3**: syncs
`vehicle_catalog.segment` on linked CBNs). UI: **Reshuffle** tab (tokenised filter,
select-all-matching over the *full* paginated set — verified 797 matches → 797 selected, not the 200
rendered; cross-segment warning; inline "+ new sub-segment"), **Families** lifecycle
(retire/reactivate through the EF, empty flags), **Triage** tab (unassigned queue with rule-suggested
family, accept one/all, rule `hits` bump — a suggestion race fixed by deriving the value not
pre-seeding it), **Rules** tab (CRUD). Closed **R1** (`dd9e831`, the last armed landmine): the import
`bulkUpsertVehicles` used to upsert every column, so a circular's stale Sub-Category text overwrote
the DB (silently undoing renames + poisoning quotation search). Now NEW CBNs are inserted with their
resolved family; EXISTING CBNs get **price fields only** — family assignment stays with the human
(owner confirmed this trade). Also fixed a pre-existing data-loss bug: **blank Price Circular /
Effective Date sent null and ERASED those columns** on every imported row (verified by nulling then
restoring 797 staging rows). Guard-bypass holes closed: the sub-segment modal's Segment/Active fields
now route through the EF.

**9.7c find surfaces** — **c1** (`326876c`): rebuilt the employee SalesCatalog as search-first —
hero tokenised search (family + CBN + description; "1920 haulage" or a CBN fragment lands on the
family), per-user **shelf** (most-opened families, localStorage, namespaced by user id), **brochure
wall** (cover tiles grouped by segment). **c2** (`dea16a5`): real page-1 cover thumbnails —
`sub_segments.cover_url`, `signCoverUpload` EF action (webp), `src/lib/coverGen.js` (pdfjs, lazy
dynamic-import → separate admin-only chunk), generate at brochure upload + an admin "Generate N
covers" backfill; SalesCatalog batch-signs cover paths and renders `<img>` with typographic fallback.
Verified all 7 staging covers (real image/webp, 14-25 KB). **pdfjs cost a long debug session** — two
non-obvious setup requirements now documented in code + backlog: (1) exclude `pdfjs-dist` from Vite
`optimizeDeps` or the main/worker version constants mismatch and `page.render()` deadlocks; (2) render
steps via `requestAnimationFrame`, which the browser PAUSES in a hidden/backgrounded tab, so a scoped
rAF→setTimeout shim is required (the automated review browser runs hidden — the "deadlock" was a test
artifact; `getOperatorList` returning 748 ops in 189 ms was the clue). Sales-view verification used a
temp `?as=sales` toggle + temporarily scoping admin to AL + all verticals — **all reverted**.

**9.7d share** (`eb3a3d6`): family-level WhatsApp share button in the variant modal. Mobile:
`navigator.share({files,text})` → editable WhatsApp draft; desktop fallback: copy caption + download
PDF. **Family-level only — never a single CBN's price** ("prices on request" + PTB sign-off). Desktop
fallback verified (caption verbatim, PDF downloaded, clipboard degrades gracefully). **Mobile Web
Share files path needs an on-device Android check before S1 is "done."**

**State at session end:** 26 commits on the branch; staging clean & review-ready (real families, 7
brochures + covers, 0 drift, admin scope reverted, all temp toggles removed). **Nothing on prod** —
no prod migration, no prod EF deploy, not merged. Red-team findings R1–R10 all closed or scoped.
**Next:** pre-ship pipeline (smoke-test the 4 still-unverified EF actions — R5; red-team the full
diff; owner catalog screen-review) → the single strict-order cutover (see backlog) → prod cover
backfill (visible tab) → refresh the DB dumps. Separately parked: **rotate the prod `service_role`
key** (a live prod key sat hardcoded in two tracked scripts, now env-only in `f420425`, but valid in
git history until rotated — coupled-key caveat applies); the mobile-share on-phone check; the
post-9.7 provenance repair (blank-circular rows).


---

**Session 2026-07-20 (cont.) — ✅ Phase 9.7 SHIPPED TO PROD (one release).**

The pre-ship pipeline and the strict-order cutover both ran this session; 9.7 went live on
`team.parastrucks.in`. Final prod commit **`506d888`** (PR #79 squash-merged to `portal`); CI
all-green (CodeQL, gitleaks, npm-audit, trivy-fs), Vercel `portal` READY, prod `/` + `/login` = 200.

**Pre-ship pipeline.**
- **R5 EF smoke test** — signed-in staging admin JWT → deployed staging `admin-catalog` EF, exercising
  the 4 never-verified actions (createVehicle / updateVehicle / toggleVehicleActive /
  bulkUpsertVehicles) with read-back. First run FAILED immediately and usefully: **createVehicle threw
  `null value in column brand_id`** — the single-add form only ever wrote the legacy `brand` text, never
  the NOT-NULL `brand_id`. `git log -S brand_id` on the EF showed it was *never* set → a pre-existing
  prod bug (every "Add Vehicle" failed), latent because the action had never been exercised end-to-end.
  Fixed server-side (`745f093`, **R11**): resolve `brand_id` from the brand code, mirroring the import's
  client-side resolution. After redeploy: **19/19 pass** (incl. updateVehicle whitelist enforcement,
  bulkUpsert insert/update split, the null-erase guard, R1 no-refile-of-existing).
- **Four clean-room red-team lanes** (general-purpose subagents, each barred from reading `docs/`/CLAUDE.md
  so they rediscovered rather than parroted R1–R11): server/migrations, admin workbench, sales UI/covers/
  share, and a cross-cutting lane that deliberately read files the branch did NOT change. 57 raw
  candidates → deduped + code-verified by the main agent → **19 Tier1+2 fixes**, Tier 3 backlogged.
  Headline finds:
  - **T2 (worst):** `sales_vertical_id` — a 4th placement column nobody synced. RLS + the sales/quotation
    query both scope on it, so a cross-segment Reshuffle move (segment synced, vertical didn't) would make
    a vehicle vanish from the destination vertical's catalog AND quotation search while haunting the old
    one. Fix: EF resolves the vertical from the destination family's segment (`SEGMENT_VERTICAL_CODE` map
    → `resolveVerticalId`) and the RPC grew to **5 args** writing `sales_vertical_id`.
  - **T1:** import still erased `description`/`tyres`/`gst_rate`/`is_active` on a minimal "CBN+MRP" sheet
    (the earlier null-erase fix covered only price_circular/effective_date) — and silently *reactivated*
    hand-deactivated vehicles. Fix: `PRICE_FIELDS` trimmed to description/tyres/mrp/price_circular/
    effective_date; gst_rate + is_active never touched on existing rows (server-enforced).
  - **T3:** Add-Sub-Segment modal wrote placement direct via PostgREST (no segment, no retired-guard,
    unchunked `.in()`) → routed through moveCbns.
  - **T4:** Triage suggested retired families (blank-but-armed dropdown, Accept-all half-commit) → active
    filter + correct hits-bump.
  - **T6/T7/H10/H11:** rename/segment repair-on-unchanged (removed the no-op early-return); updateVehicle
    re-resolves brand_id; unknown segment rejected; activate-into-retired refused; retire refused with an
    active CBN present.
  - Sales/coverGen: **H4** text-only share no longer gated on `!file`; **H5** cover `<img>` onError →
    typographic fallback; **H6** corrupt-shelf guard; **H7** coverGen render mutex + single-flight worker.
- **Re-verified 25/25 on staging** after re-running the b1 migration + redeploying the EF (a
  comprehensive script: T2 vertical travels Bus→buses then Tipper→tipper and is preserved on unassign;
  T1 preservation; T7 brand FK; T6 resync-on-unchanged; H10/H11 guards; R5 regression).
- **Owner screen-by-screen review on staging** (login → Vehicles → Reshuffle → Rules → Triage →
  Sub-Segments → sales wall). All passed. Two "issues" were clarifications, not bugs: the Vehicles count
  reads 908 (staging < prod's 1006, so the 1000-row cap isn't observable there) and the "Generate covers"
  button only shows when brochures lack covers. One real enhancement landed mid-review (`2e99f9e`): an
  **admin "Browse" tab** rendering the exact employee wall at full-catalog scope — new `allBrands`
  (an admin has no user_brands rows but should see everything, matching RLS) + `embedded` (suppress the
  wall's own page-head) props on SalesCatalog.
- **Production build green** — 811 modules; pdfjs stays a lazy admin-only chunk (worker 1298 kB, pdf
  330 kB, coverGen 1.47 kB all separate from the main bundle), confirming employees never download it.

**Prod cutover (strict order, owner-run psql via prod Session pooler + `npx supabase functions deploy`,
guided step-by-step).** A first attempt hit `tenant/user not found` — the prod project is NOT in
staging's `aws-0-ap-south-1` pooler cluster; owner pulled the correct Session-pooler string from the
dashboard. Then:
1. **97a keystone** → `UPDATE 976`; verification **976/1006 linked**, 30 text_but_unmatched (the 5 orphan
   families: Haulage – Other ×10, MAV 45T/49T/46T Air Susp ×6 each, Garud 15M ×2 → the Triage opening
   queue), 0 no_family_text, integrity drift 0 rows. Exactly the prediction.
2. **97b consolidation** → guard passed (no MBP vehicles), `UPDATE 1` retire of `Haulage – CNG 19T`
   (id 27, 0 CBNs), `UPDATE 11` families → Long Haul Trucks, `families_still_mbp = 0`, family-vs-vehicle
   segment drift 0 rows.
3. **97b1 rules + 5-arg RPC** → table/RLS/4 policies/constraints/indexes all correct; V0 grantees =
   `postgres` (owner, not client-reachable) + `service_role`, **anon/authenticated absent** (the project's
   known revoke-from-both gotcha handled). **97c cover_url** → `ALTER TABLE`.
4. **`admin-catalog` EF** deployed to prod ref `mmmxvjaavdtwlpcnjgzy` (`--no-verify-jwt`).
5. **PR #79** squash-merged → `506d888`; Vercel `portal` deploy = success/READY; prod curl 200.

**Small tail left (non-blocking):** prod cover backfill (auto-generates on each brochure upload; owner
does granular prod uploads himself), refresh `docs/db/schema-current.sql` + `seed-reference.sql` (stale),
and the owner's on-phone Android Web-Share check (opted to test on prod; the mobile code was verified
correct by inspection — H4/H5 fixed). Staging left with harmless test data (`SMOKE97-A`/`B` inactive,
`SMOKE97-FAM` retired) the owner chose to keep.


---

**Session 2026-07-21 — `service_role` key retirement: investigation + corrected plan (no prod change).**

Owner opened the parked 🔴 item ("let's do service role") and, partway in, set the governing constraint:
**"make sure that the prod doesn't break due to your change in approach or intervention."** The session
was therefore **investigation and planning only — nothing was written to prod, staging, or any key
setting.** All actions were reads (code greps, Supabase docs, one dashboard screenshot from the owner).

**The finding that changed the plan.** The parked note (2026-07-17) assumed Supabase's **coupled-key**
model: rotating `service_role` would also invalidate `anon` and take prod down until Vercel's
`VITE_SUPABASE_ANON_KEY` was updated + redeployed. **That assumption is wrong for this project.** The
owner's dashboard screenshot of `…/project/mmmxvjaavdtwlpcnjgzy/settings/api-keys` showed prod is
already on the **new API keys** system — a `sb_publishable_…` key named `default` exists, and legacy
`anon`/`service_role` now sit on their own separate tab. Per Supabase's migration guide, **new and
legacy keys work simultaneously**, so clients can be swapped one at a time. The work is a **reversible,
additive migration, not a coupled outage rotation.**

**Code-grounded facts established (all verified, not assumed):**
- All **8 portal EFs** read the platform-injected legacy `SUPABASE_SERVICE_ROLE_KEY` via `Deno.env.get`
  — **none hardcode it**, so no secret lives in EF source.
- EFs validate callers with `userClient.auth.getUser(jwt)` (a GoTrue call), so user sessions do **not**
  depend on the anon/service_role key values.
- The **only standalone client key** is the browser's `VITE_SUPABASE_ANON_KEY`, baked into the Vercel
  build — that is the entire prod-outage surface.
- ERP EFs (`erp-sso`, `sync-erp-users`) use a **separate `ERP_SERVICE_ROLE_KEY`** for a different
  project (`cloghfqosoapqtltslrp`) → out of scope, untouched.
- supabase-js lockfile resolves to **2.100.1**, which understands `sb_publishable_`/`sb_secret_` formats.
- The Supabase MCP available in-session is authed **only to the ERP org**, not the portal project
  (`get_publishable_keys` on the portal ref → permission denied) — so portal key state must come from
  the dashboard, not tooling.

**The catch that sets the scope.** The leaked token only goes inert when **legacy keys are DEACTIVATED**,
and legacy `anon` + `service_role` deactivate **together** (a single toggle — cf. the Management API
endpoint "Disable or re-enable JWT based legacy (anon, service_role) API keys"). There is therefore **no
shortcut that kills only `service_role`**: the browser must first move off legacy `anon`. Crucially,
deactivation is **reversible** ("You can re-activate them if you find a client you missed"), which is
the safety net the whole plan leans on.

**Agreed runbook (recorded in `memory/project_next_session.md`; rehearse on STAGING
`klpnhpnlotcbbovwswmq` end-to-end FIRST, then replicate on prod in a quiet window):**
1. Confirm/create the `default` **secret** key; confirm EF Secrets expose `SUPABASE_SECRET_KEYS` +
   `SUPABASE_PUBLISHABLE_KEYS`.
2. Migrate all 8 portal EFs: `SUPABASE_SERVICE_ROLE_KEY` →
   `JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS'))['default']` (+ anon→`SUPABASE_PUBLISHABLE_KEYS`),
   redeploy. **Gotcha:** new keys must travel on the `apikey` header only — never `Authorization:
   Bearer`, which the gateway tries to parse as a JWT and rejects with `Invalid JWT`.
3. Migrate the browser: Vercel `VITE_SUPABASE_ANON_KEY` → the publishable key, redeploy.
4. Verify prod works with **both** key sets still active (login + an admin EF action + a sales read).
5. **Deactivate legacy** (reversible) → leaked token inert.
6. Delete the dead `VITE_SUPABASE_SERVICE_KEY` line from `.env`.

**Paused at step 1**, awaiting two zero-impact owner dashboard checks: (a) does a `default`
`sb_secret_…` key already exist, and (b) do `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` appear
under Edge Functions → Secrets. Owner elected to continue the next day.

**Note for later (separate, not required here):** migrating **JWT signing keys** (moving user session
tokens off the shared JWT secret) is an independent follow-on migration; it does not close this exposure.


---

**Session 2026-07-21 (cont.) — post-cutover finding: prod Storage bucket rejected every cover
(`brochures` MIME allow-list). Fixed; 8/8 covers backfilled on prod.**

Running the last 9.7 tail item (the prod cover backfill) surfaced a **real gap left by the 9.7
cutover**. Admin → Vehicle Catalog → Sub-Segments → "Generate 8 covers" failed with
`Cover generation failed for all 8 families.`, and the console showed 8 ×
`PUT …/storage/v1/object/upload/sign/brochures/<uuid>.webp → 400 (Bad Request)`.

**Diagnosis (evidence-led, no guessing).** The pdfjs console noise (`Knockout groups not supported`,
`TT: undefined function: 32`) was benign render chatter — the PDFs rasterised fine. The fault was the
*upload*. Decoding a signed-upload token showed a perfectly well-formed request —
`{"url":"brochures/<uuid>.webp","upsert":false,"scope":"upload",…}` — with a fresh `crypto.randomUUID()`
path (so "object already exists" was impossible) and a valid unexpired token, proving `signCoverUpload`
in the `admin-catalog` EF had done its job. A **400** (not 403) pointed at content validation rather
than auth, and signed upload URLs bypass RLS anyway. The dashboard confirmed it: the prod `brochures`
bucket had **`ALLOWED MIME TYPES = application/pdf`** (file size limit 20 MB, 4 policies). Storage was
refusing `image/webp` outright.

**Why staging never caught it.** The 2026-07-20 staging Storage repair copied prod's **4 policies**
(`docs/db/staging_storage_policies.sql`) but **not bucket settings** — so staging's bucket stayed
permissive and accepted webp, while prod's PDF-only allow-list stood. The "staging does NOT mirror
prod" lesson again, with the drift running the opposite way.

**Fix.** Owner added `image/webp` to the prod bucket's allowed MIME types in the dashboard — additive
(kept `application/pdf`), no code change, no migration, no redeploy, instantly reversible, and no new
exposure (signed upload URLs are only minted by `signCoverUpload`, gated to `admin`/`back_office`).
Re-ran the button → **`Covers generated: 8.`**, console clean of 400s.

**Severity note — this was systemic, not a backfill-only hiccup.** `uploadCoverBlob` is deliberately
best-effort (`catch { return null }`), so the same rejection would have hit **every future brochure
upload** on prod, silently, leaving `cover_url` null and the card falling back to the typographic tile
(the H5 fallback working as designed). Nothing was user-visibly broken, which is exactly why it could
have gone unnoticed indefinitely; the backfill button was simply the one place it failed loudly.

**Standing lesson (carry into R9 / RECONSTRUCTION.md's Storage section):** a prod↔staging Storage
comparison must cover **bucket settings — allowed MIME types and file size limit — not just policies**,
and `RECONSTRUCTION.md` must record them so a rebuild reproduces them.


---

**Session 2026-07-21 (cont.) — DB dumps refreshed from prod (9.7 tail item 2).**

`docs/db/schema-current.sql` + `seed-reference.sql` had been stale since before Phase 9.7. Regenerated
from prod `mmmxvjaavdtwlpcnjgzy` (PG 17.6) with local `pg_dump 18.4` — the same tool/flags that made the
originals (`--no-owner --no-privileges`, 0 GRANT / 0 OWNER lines), seed scoped to the same **14 public
reference tables**. Commit `b1fd93b`.

**Right-database verification (done BEFORE committing, not after).** Rather than trust the connection
string, the new dumps were diffed against the committed ones for 9.7 fingerprints — all matched the
prediction exactly: `sub_segment_id` 0→14 refs, `catalog_assign_rules` 0→27, `cover_url` 0→1,
`move_cbns_to_family` 0→2, `sub_segments` **44→49** families, `vehicle_catalog` **906→1006** rows (1006
being the exact prod count from the cutover's 976/1006 keystone backfill). A wrong-DB dump would have
failed these.

**Secret handling — the PR #75 lesson applied as method, not just a warning.** `pg_dump --schema-only`
captures DB-webhook triggers *with* their `Authorization` headers, and the `sync_erp_users` `pg_net`
trigger carries `SYNC_SECRET`. So the dumps were written to a **scratch directory outside the repo
first** — the live secret never entered the git working tree at any point — then scrubbed to the
existing placeholder `Bearer __REDACTED_ROTATE_SEE_RECONSTRUCTION__`, re-verified after the copy into
`docs/db/`, and swept for residuals: **0** raw `eyJ…` JWTs, **0** `sb_secret_`, **0** long hex/base64
runs, and a check that `sync_erp_users` is still the **only** `http_request` trigger (a new webhook
would have carried a new secret). `gitleaks` is not on PATH locally and did not catch this pattern in
PR #75 anyway — GitGuardian did — so the sweep is manual by design.

**Noted, not actioned:** `seed-reference.sql` includes `public.entities`, which carries GSTIN and bank
details. That was already true of the committed dump, so this changed nothing — but the owner was told,
in case that table should later be dropped from the seed scope. Also still open: `storage.buckets` is
**not** in the seed scope, so bucket settings (the allowed-MIME-types field behind today's cover bug)
still aren't captured by a rebuild — see the R9 entry.


---

**Session 2026-07-21 (cont.) — new-API-key migration: staging rehearsal, 4-lane red team, remediation.**

Branch `svcrole-new-api-keys` (worktree `suspicious-snyder-af9361`), 4 commits — `3c2efd0` keys.ts +
codemod · `6dcb0c1` EF red-team fixes · `0bc2457` UI fixes · `875e285` doc fixes. **Not merged; prod
untouched throughout.** Staging (`klpnhpnlotcbbovwswmq`) now runs the full END STATE:
`USE_NEW_API_KEYS=true` **and legacy keys deactivated**.

**Design decision — the cutover is a SECRET FLIP, not a deploy.** All 9 EFs resolve portal keys through
`_shared/keys.ts`, gated on `USE_NEW_API_KEYS`. Deploying the branch is therefore a **no-op**, which
decouples "ship the code" from "switch the keys" and means the deploy carries no cutover risk of its own.
**⚠️ Corrected mid-session:** I claimed repeatedly that rollback was instant. It is not — `Deno.env` is
snapshotted at **isolate boot**, so a flag change only reaches isolates as they recycle. Deterministic
flip *and* rollback both require a **redeploy**; the genuinely instant lever is re-enabling legacy keys.

**Rehearsal sequence (all owner-run where creds were needed).** Deploy 9 EFs (flag off) → credential-free
curl smoke → flip flag → login/catalog/write → swap `.env` to the publishable key → **deactivate staging's
legacy keys** → re-verify. That ordering matters: because legacy was *off*, a green result cannot be a
false positive from legacy quietly still being in use — the failure mode a red-team lane later identified
as the deadliest one. We got that right by sequence, not by luck alone.

**Two false alarms worth recording, both mine.**
1. Login failed with "Incorrect email or password" and I built a confident root-cause story around the
   `Authorization: Bearer` gotcha. The owner said *"I think you are simply using the wrong email ID."*
   He was right — staging is `@parastrucks.test`, not `@parastrucks.in`, and the correct address was
   **in my own memory file**. I had reconstructed it from the production domain instead of reading it.
   The evidence I cited never distinguished the two hypotheses; a non-existent user produces exactly the
   same symptoms. **Lesson: verify your own inputs before diagnosing the system.**
2. A later "failure" was CORS — Vite fell back to port **3001** because a stale dev server still held
   3000, and staging only whitelists `http://localhost:3000`.

**Four clean-room red-team lanes** (EF internals · React app · ERP login/users · forgotten consumers).

*Confirmed and fixed (`6dcb0c1`, `0bc2457`):*
- **`auditLog.adminLogoutUser` — found independently by 3 of 4 lanes.** A hand-rolled `fetch` sent the
  secret key on **both** `apikey` and `Authorization: Bearer`, and swallowed the failure into a
  `console.warn` while the caller returned `{ok:true}`. Post-cutover, deactivating an employee would
  silently not revoke their session. Now: Bearer only for legacy JWT keys, `console.error`, boolean return.
- **`keys.ts` fail-loud.** The silent fallback would have selected a **dead** key post-deactivation and,
  worse, made pre-cutover verification meaningless — everything passes green because legacy is quietly
  still in use, until deactivation breaks it all at once. Now throws, plus a boot log of flag + bag
  presence (no secret material) and a split-brain guard.
- **`verify()` ×5** reported a dead key as `403 "Profile not found"` — blaming the user for a platform
  failure. Now `503 backend_unavailable` + log.
- **Lockout (`auth_attempt_check`/`record`) and rate limiting** fail open **silently** — a dead key would
  have switched off brute-force protection on the one unauthenticated internet-facing endpoint with zero
  signal. Behaviour kept (deliberate), but now audible.
- **`AuthContext`** discarded its PostgREST error, rendering a key failure as an empty sidebar with no
  message — the worst diagnostic trap. Now surfaces "Couldn't load your profile" with a retry.
- **`Employees`** was **data-loss shaped**: reference tables *and* the three per-user join reads discarded
  errors, so the edit modal would open with everything unchecked and Save would strip real assignments.
  Both paths now refuse to open and say why.
- **`useErpVisible`** failed open on any error (every user would see the HD Hyundai card); now
  distinguishes auth rejection from a transient blip.
- **supabase-js pinned to `2.100.1`** in all 11 files — it was floating on `@2`, so each function bundled
  whatever resolved at its own deploy time.

*A claim of mine the red team disproved:* I said supabase-js "handles the `sb_` prefix". **It does not** —
`fetch.ts` sets `Authorization: Bearer <key>` whenever there is no user session, and a grep of
`node_modules/@supabase/*` for `sb_publishable`/`sb_secret` returns zero matches. It works anyway because
**the gateway tolerates it** — and our staging run with legacy fully deactivated is the proof. Right
outcome, invented mechanism; the correct reasoning is empirical, not from the SDK.

*Docs corrected (`875e285`):* every doc undercounted the Edge Functions — `RECONSTRUCTION.md` said **7**
and omitted `erp-sso` + `sync-erp-users` entirely, `CLAUDE.md`/`README` said 7, my own runbook said 8.
There are **9**. Deploy 7 or 8 and the missed function keeps reading the deprecated vars and dies at
deactivation. Also completed the EF secrets table (`SYNC_SECRET`, `ERP_*`, `USE_NEW_API_KEYS`) and
repointed the `.env` template + checklist off the retired legacy keys.

**TWO NEW INDEPENDENT SECURITY FINDINGS** (both logged in `memory/known_issues.md`, both deliberately
NOT bundled into the key cutover so its rollback stays clean):
1. 🔴 **`SYNC_SECRET` is unredacted in git history** — confirmed by scanning all history of the schema
   dumps: a 64-char hex value in pre-scrub commits. It is the sole gate on `sync-erp-users`, so a holder
   can drive arbitrary reconciles and **ERP deactivation sweeps**. Rotation is a coordinated 3-way flip
   (EF secret → DB trigger header → ERP repo GH Actions secret).
2. 🟠 **`adminLogoutUser` 404s — session revocation has NEVER worked.** Making the swallowed error audible
   immediately exposed an older bug underneath: `POST /auth/v1/admin/users/{id}/logout` returns
   **404 page not found**. Not a key problem (that would be 401), not new. supabase-js's admin API has no
   by-user-id logout — `signOut(jwt)` takes a JWT — so the fix needs a `SECURITY DEFINER` RPC clearing
   `auth.refresh_tokens` (the `auth` schema isn't reachable via PostgREST), i.e. a DB migration.
   Impact is bounded: `verify()` returns 403 `Account inactive` and RLS `is_active` gates still block
   access, so this was defence-in-depth running on one layer, not an open door.

**Verified on staging after remediation:** all 9 EFs return 401/400 (never 500) · the boot line reads
`USE_NEW_API_KEYS=true secretBag=true publishableBag=true -> using NEW keys` · login · catalog 798/909 ·
Employees edit modal fully populated (proving the ref + join reads succeed, and that "unchecked" now
provably means "no assignment" rather than "read failed") · **an employee deactivate wrote successfully
(ACTIVE 6→5)** · Vendor Jobs · console zero errors.

**Still open before prod:** the **token-refresh test (~1 h)** — refresh uses the key on `Bearer` with no
user JWT, and no rehearsal so far has lived long enough to exercise it. If it fails, every user is
silently signed out about an hour after a clean-looking cutover. Optional extras: `erp-sso` as a
**non-admin** PTB user (admins short-circuit `useErpVisible`), the three `next_*_number` RPC saves, TIV
upload. Cleanup: reactivate `abc / tester@parastrucks.test` on staging.

### 2026-07-23 — New-API-key cutover EXECUTED on prod; leaked service_role key retired & verified dead

**Outcome: the whole 7-step cutover ran on prod and the security objective is proven.** Prod
(`mmmxvjaavdtwlpcnjgzy`) is now on Supabase **new API keys**; legacy `anon`+`service_role` are
**deactivated**; the leaked `service_role` JWT is inert.

**Pre-flight correction to the deferred token-refresh test.** The "leave a tab idle 1 h" test was a
false signal: prod JWT expiry is **12 h**, so supabase-js never fires a refresh in an idle hour —
"still logged in" proves nothing. Auth logs confirmed **zero `POST /token` refresh calls**. Analysis
then showed the risk was near-zero anyway: refresh is a pure **GoTrue** operation signed by the JWT
signing secret (an API-key change doesn't touch it), and `Deno.env` snapshotting is irrelevant because
refresh never hits an EF isolate. Proceeded without the 12 h wait; a fresh **incognito login with
legacy fully off** later confirmed the whole auth path end-to-end.

**The 7 steps (all executed):**
1. **Merge + deploy 9 EFs, flag unset.** PR #81 squash-merged to `portal` (`1d9ba17`), CI green,
   Vercel prod READY (bundle `BRnxcawR`→`Bn6I3eLC`). All 9 EFs deployed. **Gotcha confirmed:** there is
   **no `supabase/config.toml`** — `verify_jwt:false` is enforced per-deploy by the `--no-verify-jwt`
   CLI flag; every deploy loop must carry it and `--project-ref mmmxvjaavdtwlpcnjgzy` (the worktree's
   linked project is *staging*). Deploy noise `!!! FAILED` / `exit != 0` was **PostHog telemetry
   shutdown timeout**, not a deploy failure — proven by `functions list` (all 9 ACTIVE, versions
   bumped) and an HTTPS probe (all 9 return *our* error shapes, so verify_jwt is off).
2. **Flip + redeploy.** Set `USE_NEW_API_KEYS=true` (EF Secrets), redeployed all 9 to force fresh
   isolates (`Deno.env` snapshots at boot).
3. **Prove NEW keys.** `sync-erp-users` boot log captured the transition: `12:32:27 (unset)→LEGACY`
   then `12:50:37 USE_NEW_API_KEYS=true …→NEW keys`. (Runtime `console.log` lives in the **function
   logs** stream, not the request-log rows and not the Postgres SQL editor — `auth_logs`/`function_logs`
   are BigQuery log sources, `42P01` in the SQL editor.)
4. **Vercel → publishable.** PATCHed `VITE_SUPABASE_ANON_KEY` (production target only; no Preview/Dev
   entries existed) to `sb_publishable_…` via Vercel API. **VITE vars are build-time inlined**, so a
   redeploy-from-`deploymentId` risked reusing stale output — verified by fetching the live bundle:
   new hash `index-DMOzaETt.js` contains `sb_publishable_` (×2) and **zero `eyJ` legacy JWTs**. Browser
   hard-reload → dashboard + catalog (897/1006) load on the publishable key.
5. **Verify (both key systems live).** Incognito login (verify-login booted NEW at 12:55:49/50),
   dashboard, Employees list (admin-users on new secret = privileged PII read). All clean.
6. **Deactivate legacy** (owner, dashboard). Immediately verified: all 9 EFs healthy; keyless
   PostgREST 401 / publishable 200; **the actual leaked `service_role` JWT (extracted from git
   `3dcbd75`, decoded `role=service_role`) → prod PostgREST `/rest/v1/users` = 401.** Objective met.
7. **Cleanup + bug-watch** (this entry + docs).

**Red-team (4 clean-room lanes + direct prod tests) — no cutover blockers.** (1) No dead-key code path:
every EF client routes through `keys.ts`, which throws rather than falling back; `src/`, `scripts/`, DB
webhook triggers clean. (2) No external/DB caller depended on legacy: the `sync_erp_users` trigger uses
`SYNC_SECRET` (not a Supabase key), no pg_cron/Realtime/rogue-webhook/CI dependency, Storage is
browser-or-EF-mediated. (3) **Verification-gap finding:** unauth probes reject before keys resolve, so
only key *resolution* is confirmed (boot logs, 5/9 seen `-> using NEW keys`), not each EF's new-key
*use* — closable by glancing the other 4 boot logs, no smoke test needed. (4) Residual register:
`SYNC_SECRET` in git history is the **already-rotated dead V1** (tested → 401; the "🔴 rotation pending"
note was stale); `adminLogoutUser` 404 unchanged by cutover (own DB-migration follow-up);
`VITE_SUPABASE_SERVICE_KEY` in Vercel is inert clutter (not referenced → not inlined → not in bundle);
`^2.39.7`-vs-lock-`2.100.1` is a non-issue under `npm ci`.

**Bug collector.** Owner can't run smoke tests, so cutover-bug checking is **opportunistic on any task**
(see `memory/post_cutover_bugwatch.md`). Passive collector already lives in-app: ErrorBoundary + global
handlers → `log-error` EF → `error_log` → **Access Rules → Error Log tab**. `log-error` confirmed on new
keys (boot log); the tab renders clean and empty = genuinely no bugs since cutover. A scheduled cloud
watchdog was considered and **declined** by the owner in favour of the opportunistic check.

**Corrected belief:** rollback is **NOT** instant — flip *and* rollback both need a redeploy
(`Deno.env` boot snapshot); the instant incident lever is re-enabling legacy keys (reversible).

---

### 2026-07-25 — Portal→ERP sales sync: PT sales department maps to the ERP `sales` tier (PR #83 → `bc72d83`)

The portal side of **ERP Phase 13c**. ERP-side 13a/13b/13b.2/13c/13d all shipped on 2026-07-25 (separate
repo `erp-parastrucks`) and gave the ERP a per-user credit/discount authority model plus a deliberately
powerless `sales` tier — but **no sales profile could exist**, because nothing created one. This change is
what does.

**The change** (`supabase/functions/sync-erp-users/index.ts`, 1 file, +27/-8):

| | before | after |
|---|---|---|
| `ERP_FUNCS` | service, spares, accounts | **+ sales** |
| tier for a sales-dept user | `TIER[permission_level]` (a sales GM → ERP `gm`) | pinned **`sales`** |
| branch-less tiers | gm, admin | **+ sales** (`BRANCHLESS_TIERS`) |

**Why the tier is pinned, not mapped.** A sales GM is a portal `permission_level=gm`, and ERP `gm`
**bypasses every functional gate at the DB level** — mapping by permission_level would have handed the
sales team the entire workshop. ERP `sales` can do exactly one thing: approve credit/discount up to the
per-user ceilings an ERP admin grants. The pin is deliberately **unconditional** — it also demotes a
portal *admin* who sits in the sales department — because department is the entitlement boundary here and
the intended exception path is the ERP's own `role_overridden` flag, which this sync already honours.

**Why sales must stay branch-less.** The ERP CHECK `sales_is_branchless_sales_func` **rejects** a sales
profile carrying a branch. Leaving `sales` out of the branch-less set would have sent it down the
outlet-resolution path and either failed that constraint on insert or skipped the user outright when
their outlet doesn't map to an ERP branch. This is the kind of cross-repo coupling that only bites at
runtime, in a nightly cron, days later.

**Mapping truth table** (checked before shipping, per `feedback_exhaustive_edge_cases`):

| dept | permission_level | tier | func | branch |
|---|---|---|---|---|
| service/spares/accounts | admin / gm | admin / gm | dept | null |
| service/spares/accounts | manager / executive | manager / executor | dept | resolved, else skipped |
| **sales** | admin / gm / manager / executive | **sales** | sales | **null** |
| any | unrecognised | — | — | **skipped** |

An unrecognised `permission_level` still skips the row **for sales too**, so a malformed portal record
can't quietly become a sales approver.

**Pre-deploy verification (ERP prod, read-only):** `user_tier` = admin,gm,manager,executor,**sales** and
`user_function` = service,spares,accounts,**sales** (both from migration `13c1`); `branch_required_below_gm`
and `sales_is_branchless_sales_func` both accept `tier=sales, func=sales, branch_id=null`; 18 profiles
exist, **0** at tier/func `sales`. Portal `departments` carries code `sales` (prod seed dump).

**Deploy:** `supabase functions deploy sync-erp-users --project-ref mmmxvjaavdtwlpcnjgzy --no-verify-jwt`
(all 3 assets uploaded — `index.ts` + `_shared/cors.ts` + `_shared/keys.ts`, so the new-key path travels
with it). Smoke-tested live: bad secret → **401 `unauthorized`**, `GET` → **405 `method_not_allowed`**,
i.e. the bundle imported and serves. PR #83 squash-merged → `bc72d83`; Vercel `portal` production READY;
`team.parastrucks.in/` + `/login` = 200.

**Two gotchas worth carrying forward:**
1. **The repo was 2 commits behind `origin/portal` at session start**, and the missing commit was `1d9ba17`
   — the one that routes every EF key through `_shared/keys.ts`. Deploying `sync-erp-users` from the stale
   checkout would have shipped `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, which is **DEAD** since the
   2026-07-23 legacy-key deactivation, silently breaking portal→ERP sync. `git pull --rebase` before
   touching a portal EF is not hygiene, it is the difference between a working and a dead function.
2. **`npm-audit` in CI is now red on every PR** for reasons unrelated to any branch — see
   `memory/known_issues.md`. PR #83 was merged with it red only after proving the base branch fails
   identically.

**✅ SYNCED AND VERIFIED THE SAME DAY — and the lever that made it possible.** I first wrote that a
functional dry-run was impossible here because `SYNC_SECRET` is owner-held and deliberately never in the
working tree. That was wrong: the 30-min backstop cron **in the ERP repo**
(`.github/workflows/sync-erp-users.yml`) exposes a `workflow_dispatch` with a **`dryRun` input**, and it
holds the secret as a **GitHub Actions secret**. So the deployed code can be exercised end-to-end without
the secret ever being visible:

```
gh workflow run sync-erp-users.yml -f dryRun=true --repo parastrucks/erp-parastrucks
→ {"created":4,"updated":16,"reactivated":0,"deactivated":0,"skipped":[],"dryRun":true}
```

That one call **bounded the only unknown in the whole change** — how many PT + `hdh` + sales-department
users exist (**4**) — and *proved* rather than argued the blast-radius claims: `deactivated:0` (the sweep
is untouched by a widening), `updated:16` (existing service/spares/accounts mapping unchanged), and
`skipped:[]` (nobody unmappable — without `BRANCHLESS_TIERS` any sales user whose outlet doesn't map to an
ERP branch would have surfaced here). **Reusable rule: before landing a scope change to a synced set, look
for a dry-run path that runs the deployed code; a `workflow_dispatch` holding the secret is one.**

Since the cron fires the real reconcile within 30 minutes regardless, running it **attended** was strictly
safer than letting it happen unwatched: `dryRun=false` → identical counts. Verified on ERP prod — the 4
new profiles are `tier=sales · func=sales · branch_id=null · source=portal · role_overridden=false` at
**0 / ₹0 / terms_unlimited=false**, and the pre-existing 18 are unchanged (admin 2, gm 1, manager 3,
executor 12, every manager/executor still branched). Inertness proven with the real guard, not inferred
from the ceilings: `fn_can_authorize_terms` returns **false** for all four at 0/0, 2%, ₹60k *and*
2%+₹60k — and **strict false, not NULL**, which is the 13d2 lesson (`(not f(...)) is true`) applied.

**⏭️ Left to the owner:** set the ceilings in ERP → User Management → "Approval authority", or the four
stay inert (every Approvals button disabled, and no notifications, since the 13d notifier only pings
people who can actually clear a request). Scope is gated on the `hdh` brand assignment — the owner's
chosen lever — so removing that brand (or deactivating in the ERP) is how to narrow the set of four.

### 2026-07-25 (same session) — CI `npm-audit` went red on every PR; cleared the high advisory (PR #84 → `71cfc5d`)

Surfaced the honest way: the owner said *"receiving failure mails"* — GitHub's `security: Some jobs were
not successful` notice on every push. Only `npm-audit` failed; `gitleaks`, `CodeQL` and `trivy-fs` passed.

**Not caused by any branch.** Newly-published advisories landed against the existing lockfile, so
`npm audit --audit-level=high` on `portal` itself failed identically (checked before merging PR #83 with
it red). Last green run on `portal` was 2026-07-23 (`01c8b64`) — **time-based, not change-based**. The real
cost of leaving it is that it trains everyone to ignore a security gate.

**Fix — `npm audit fix`, semver-compatible only, no `--force`, `package.json` untouched:**

| package | move | severity | scope |
|---|---|---|---|
| `postcss` | 8.5.16 → 8.5.23 | **high** — GHSA-r28c-9q8g-f849 (sourceMappingURL path traversal → arbitrary `.map` disclosure) | build-time |
| `nanoid` | 3.3.15 → 3.3.16 | postcss's dep | build-time |
| `dompurify` | 3.4.11 → 3.4.12 | low — GHSA-c2j3-45gr-mqc4 | runtime, via jspdf |

**Verified inert instead of trusting "it's only a patch":** rebuilt with the **pre-bump lockfile** and the
emitted CSS came out **byte-identical** — `sha256 caa1fb6c…`, right down to the same content-hash filename
`index-5tHxGrvK.css`. The ~20 changed JS chunk hashes are Rollup's cascade from the single changed leaf
(`purify.es`) through its importers, not 20 independent changes. **Technique worth reusing: to prove a
build-tool bump is safe, rebuild with the old lockfile and diff the emitted asset hashes — it beats
eyeballing a screenshot, and it works when the browser pane is unavailable.**

**Deliberately left open:** `react-router` 6.22.3 keeps **2 moderate** advisories (GHSA-wrjc-x8rr-h8h6
open redirect via backslash in `<Link>`/`useNavigate`; GHSA-337j-9hxr-rhxg `deserializeErrors`, SSR-only
and we don't SSR). The advisory range covers **all of 6.x**, so the fix is **react-router 7** — a major,
breaking upgrade that deserves its own routing-verification pass rather than riding a lockfile patch. CI's
gate is high/critical, so it passes meanwhile. Logged in `memory/known_issues.md`.

**Not exercised:** PDF output. dompurify's fix concerns `CUSTOM_ELEMENT_HANDLING` and the portal's PDF
templates use standard HTML, so no impact is expected — but no PDF was generated to confirm.

### 2026-07-25 — Session summary (2 changes shipped, both verified on prod)

| # | Change | PR → commit | Verified |
|---|---|---|---|
| 1 | **13c portal→ERP sales sync** — PT sales dept → ERP branch-less `sales` tier | #83 → `bc72d83` | EF deployed; 4 users provisioned + proven inert; Vercel READY; prod 200 |
| 2 | **`npm-audit` CI gate restored** — postcss 8.5.16→8.5.23 (+nanoid, dompurify) | #84 → `71cfc5d` | all checks green incl. `npm-audit`; CSS byte-identical; Vercel READY; prod 200 |
| — | Docs | `7e619c6`, `d21b0df`, `cb61945` | — |

ERP repo (separate) took the matching doc update: `64cff74`.

**Bug-watch progress (new-API-key cutover).** Change 1 also **cleared the `sync-erp-users` half of smoke
#8** with harder evidence than a boot log: two real reconciles returned HTTP 200 with `skipped:[]`, which
proves the portal **secret key** works for both a PostgREST privileged read (`public.users` + 5 joins) and
a **GoTrue admin endpoint on `Authorization: Bearer sb_secret_…`** (`auth.admin.listUsers` resolved an
email for every user — any failure there would have filled `skipped` with `no email for portal user …`).
That GoTrue-admin class is exactly what boot logs cannot cover. **`erp-sso` itself remains unexercised**,
so smoke #8 stays half-open. See `memory/post_cutover_bugwatch.md`.

**Environment facts learned (worth not re-discovering):**
- `supabase functions deploy` **does not need Docker** (only `db push` does) — it warns and proceeds.
  Watch that a function importing `_shared/*` uploads *all* its assets.
- The **Supabase MCP is scoped to the ERP project only**; the portal project returns *"You do not have
  permission"*. Portal DB questions must go through a dry-run of the deployed code, the CLI, or the
  dashboard.
- The prod-creds backup is **`.env .prod .bak`** (spaces, not dots) and contains **legacy `eyJ…` JWTs**
  for anon + service — **dead** since the 2026-07-23 cutover, so it is useless for prod work. Two earlier
  notes were wrong about this file: one called it `.env.prod.bak`, another said it did not exist.
- Local `.env` is correctly on **staging** (`klpnhpnlotcbbovwswmq`) and `npm run dev` boots on `:3000`.
- The repo carries **3 stale git worktrees** under `.claude/worktrees/` (`9.6-portal-redesign`,
  `claude/id-login-issue-logs-8810c0`, `docs-cutover-record`) — harmless, but they make repo-wide greps
  return duplicate hits from old branch copies. Grep with `--include` or ignore that path.

**Method notes carried into memory** (`feedback_prove_dont_argue`): prefer a command that *emits* the
claim over an argument for it — a `dryRun` `workflow_dispatch` bounded change 1's scope before it landed,
and an old-lockfile rebuild proved change 2 was inert when the browser pane was unavailable.
