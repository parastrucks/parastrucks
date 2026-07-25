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

## Current state (2026-07-23)

- **🔐 Prod is on Supabase NEW API keys (cutover LIVE 2026-07-23, PR #81 → `1d9ba17`).** Legacy
  `anon`+`service_role` DEACTIVATED; the leaked `service_role` JWT is verified DEAD (401). Browser uses
  `sb_publishable_…`; all 9 EFs use the injected secret/publishable bags via `_shared/keys.ts`
  (`USE_NEW_API_KEYS=true`). See Next actions + [[post-cutover-bugwatch]].
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
- **Planned, not started:** **Phase 10 — Vehicle Tracker** (`/tracker`) — `docs/backlog/phase10-vehicle-tracker.md`.
- **Separate project (not this repo):** the HD Hyundai **ERP** (`erp.parastrucks.in`, repo `erp-parastrucks`) — see `memory/project_hd_hyundai_vertical.md`.

## Next actions

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
- **🔗 ERP sales sync DEPLOYED 2026-07-25 (PR #83 → `bc72d83`; EF live on the portal project, Vercel
  READY, prod 200) — two things left, both owner-side:**
  1. **Trigger the first sync.** The code is live but inert until a sync runs. Cleanest trigger is the
     real user path: the sales GM signs in to the portal and clicks the **HD Hyundai Service ERP** card
     → `erp-sso` JIT-provisions them via a **single-user** sync (skips the deactivation sweep). Other
     triggers: re-save the user in Employees (users-table DB webhook → full reconcile), or the nightly
     cron. ⚠️ If the SSO click errors, suspect a **stale pre-cutover browser session** — full sign-out
     + sign-in (see `memory/post_cutover_bugwatch.md`).
  2. **Set their ceilings** in the ERP → User Management → "Approval authority", or they stay inert
     (every Approvals button disabled, no notifications).
  **Not verifiable from here:** a functional dry-run needs `SYNC_SECRET` (owner-held, never in the
  working tree). Deploy + auth gate were smoke-tested (401 on a bad secret, 405 on GET); the *mapping*
  is proven by the first real run — check `profiles where tier='sales'` on the ERP project afterwards.
  **Unbounded number:** how many PT + `hdh` + sales-dept portal users exist is unknown from here, and
  every one of them gets an inert ERP account on the next full reconcile.
- **Post-9.7 follow-up (owner-deferred):** provenance repair — count prod rows with null
  `price_circular`/`effective_date` (from past blank-field imports); every active row reflects the
  current price list, so one filled import re-stamps them all. See backlog.
- **Task A — restore localhost dev:** keep local `.env` pointed at the **staging** Supabase
  project (`klpnhpnlotcbbovwswmq`); staging EFs whitelist `http://localhost:3000` in `ALLOWED_ORIGINS`.
  **Do NOT add localhost to the prod project's `ALLOWED_ORIGINS`** (owner-rejected). Prod creds
  live in `.env.prod.bak` for occasional prod work.
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
  pure GoTrue op (safe). Runbook/record: [[next-actions]], [[post-cutover-bugwatch]], `known_issues.md`.
- **🐛 BUG-WATCH (until cleared) — `memory/post_cutover_bugwatch.md`.** Owner can't run smoke tests, so we
  **check for cutover bugs opportunistically on any task**. Gap: for most EFs the unauth probe rejected before
  keys resolved, so only key *resolution* is confirmed (via boot logs: 5/9 show `-> using NEW keys`; glance the
  other 4). Passive collector already live = **Access Rules → Error Log tab** (`log-error` EF confirmed on new
  keys; empty = genuinely no bugs). Failure signature = one EF 500/503 while others work → redeploy that ONE EF.
- **Post-cutover follow-ups (each its own change):** 🟠 `adminLogoutUser` 404 — session revocation never worked
  (needs a DB migration; NOT caused by cutover); cleanup — delete dead `VITE_SUPABASE_SERVICE_KEY` from Vercel
  prod + `.env` files; optional `package.json` supabase-js caret bump to `^2.100.1`. ✅ RESOLVED: `SYNC_SECRET`
  git-history value proven DEAD (401) = the already-rotated V1, no rotation pending. `.env.prod.bak` does NOT exist.
- **Open issues:** see `memory/known_issues.md` (e.g. C1 PII-read RLS; `next_proforma_number`/
  `next_financier_copy_number` still `anon`-executable).

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

**Design/verification habits:**
- CSP is enforced from the header on the **document** — verify by curling real page URLs (`/`,
  `/login`), not by reading `vercel.json`.
- When offering design options, span the real solution space including non-obvious architectures
  (`memory/feedback_mece_innovation.md`).
