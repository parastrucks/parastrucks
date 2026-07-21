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

## Current state (2026-07-20)

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
- **🔴 IN PROGRESS (started 2026-07-21) — retire the exposed prod `service_role` key.** A live prod
  `service_role` JWT was hardcoded in two git-tracked scripts (`scripts/run_migration.cjs`,
  `scripts/fix_inactive.cjs`) — fixed 2026-07-17 (commit `f420425`) to read `SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY` from env, but **the key stays valid in git history until the legacy keys are
  retired**. **⚠️ The old "coupled-key → prod outage" caveat is SUPERSEDED:** prod is already on
  Supabase's **new API keys** system (verified in the dashboard 2026-07-21 — a `sb_publishable_…`
  `default` key exists; legacy `anon`/`service_role` are a separate tab). New + legacy keys **work
  simultaneously**, so this is a **reversible, additive migration**, not a coupled rotation
  ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
  **Verified:** all 8 portal EFs read the injected legacy `SUPABASE_SERVICE_ROLE_KEY` (none hardcode
  it); the only standalone client key is the browser's `VITE_SUPABASE_ANON_KEY`; ERP EFs use a separate
  `ERP_SERVICE_ROLE_KEY` (untouched); supabase-js = 2.100.1 (understands new formats). **Catch:** the
  leaked token only dies when **legacy keys are deactivated**, and legacy `anon`+`service_role`
  deactivate **together**, so the browser must move to the publishable key first. Deactivation is
  **reversible** (safety net).
  **✅ STAGING REHEARSAL COMPLETE 2026-07-21** on branch `svcrole-new-api-keys` (4 commits, **not merged,
  not on prod**). Staging now runs the **end state** — `USE_NEW_API_KEYS=true` *and legacy keys
  deactivated* — with login, catalog reads, an Employees write, and all 9 EFs verified healthy.
  **Cutover = a secret flip, not a deploy** (`USE_NEW_API_KEYS`); ⚠️ **rollback is NOT instant** —
  `Deno.env` is snapshotted at isolate boot, so flip *and* rollback both need a redeploy; the instant
  lever is re-enabling legacy keys. **4 red-team lanes** ran against the migration and all fixes are
  applied — headline: `adminLogoutUser` sent the secret key on `Authorization: Bearer` and swallowed the
  failure, and `keys.ts` silently fell back to a dead key (which would have made pre-cutover
  verification meaningless). supabase-js does **not** special-case `sb_` keys — it does send them on
  `Bearer`; it works because the **gateway tolerates it**, proven by running staging with legacy off.
  **Before prod:** the **token-refresh test (~1 h)** — the only path staging structurally hasn't covered.
  Full runbook, prod ordering and the orders that break prod: `memory/project_next_session.md`.
  **Two NEW independent security items found, each needing its own change** (see `memory/known_issues.md`):
  🔴 `SYNC_SECRET` is unredacted in git history (3-way coordinated rotation) · 🟠 `adminLogoutUser` 404s,
  so session revocation has **never** worked (pre-existing; needs a DB migration; not a cutover blocker).
  The dead `VITE_SUPABASE_SERVICE_KEY` line is gone from the worktree `.env` (the main checkout's and the
  9.6 worktree's still have it) — and **`.env.prod.bak` does not exist**, contrary to the Task A note above.
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
