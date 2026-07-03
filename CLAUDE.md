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
