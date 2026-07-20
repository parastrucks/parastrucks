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
  **Phase 9.6 visual redesign — LIVE 2026-07-16** (PR #78 → `29404b4`; Paras print-report language,
  Carlito, Lucide, new mobile shell). Build/review record: `memory/phase96_portal_redesign.md`.
- **🔨 Phase 9.7 — Catalog UX rework — BUILT & STAGING-VERIFIED, NOT YET ON PROD.** Branch
  **`claude/phase-9-7-start-0c4b8d`** (26 commits, off `origin/portal`, worktree
  `.claude/worktrees/suspicious-snyder-af9361`). Every sub-phase is done and verified against the
  **staging** DB (`klpnhpnlotcbbovwswmq`): **9.7a keystone** (additive `vehicle_catalog.sub_segment_id`
  FK + backfill; rename unlocked, verified `renamed:33` w/ text sync) · **9.7b workbench** — Reshuffle
  (tokenised filter, select-all-matching over the *full* paginated set, bulk `moveCbns` writing
  id+text+segment atomically via `move_cbns_to_family` RPC), Triage (rule-suggested family, accept
  one/all, hits-bump), Rules (`catalog_assign_rules` CRUD, admin-only RLS), Families lifecycle
  (retire/reactivate guarded at 0 active CBNs, empty flags) · **MBP Truck → Long Haul Trucks
  consolidation** (11 family rows; vehicles were already migrated) · **9.7c** — F1 search-first
  landing + per-user localStorage shelf, F2 brochure wall, F3 hierarchy; **c2 real cover thumbnails**
  (pdfjs page-1 → webp, generated once, lazy admin-only chunk) · **9.7d** — family-level WhatsApp
  share (editable draft; never a single CBN's price). Also **fixes 3 pre-existing PROD bugs** that
  ride the release: the **PostgREST 1000-row cap** silently truncating catalog + quotation search
  (`fetchAllRows`), the import **blank-field null-erase** of price_circular/effective_date, and the
  **`MBP Truck` blank segment dropdown**. Full record: `docs/backlog/phase97-catalog-ux.md` (build
  notes, red-team R1–R10, pdfjs gotchas, the strict cutover order). NOT merged; NO prod migration/EF
  deploy yet.
- **Planned, not started:** **Phase 10 — Vehicle Tracker** (`/tracker`) — `docs/backlog/phase10-vehicle-tracker.md`.
- **Separate project (not this repo):** the HD Hyundai **ERP** (`erp.parastrucks.in`, repo `erp-parastrucks`) — see `memory/project_hd_hyundai_vertical.md`.

## Next actions

- **Ship Phase 9.7 to prod — ONE release** (owner-decided). Order is strict; see
  `docs/backlog/phase97-catalog-ux.md` "Prod cutover order". First the **pre-ship pipeline** (full
  staging smoke test incl. the still-unverified EF actions createVehicle/updateVehicle/
  toggleVehicleActive/bulkUpsertVehicles — R5; red-team the complete diff; owner screen-by-screen of
  the catalog area; rebase onto latest `origin/portal`). Then the **cutover**: keystone migration →
  consolidation migration (expect `UPDATE 1` on the retire, else STOP) → b1 `catalog_assign_rules`
  migration → c2 `cover_url` migration → **`admin-catalog` EF deploy** (`--no-verify-jwt`) → merge/
  Vercel → **cover backfill on prod** (admin → Sub-Segments → "Generate N covers", visible tab) →
  refresh `docs/db/schema-current.sql` + `seed-reference.sql`. Expected prod backfill: **976/1006**
  CBNs linked. Migrations applied via `psql` Session Pooler; EF deploy via `npx supabase functions
  deploy` (needs `SUPABASE_ACCESS_TOKEN`).
- **On-phone check before S1 is "done":** the mobile Web Share (files → WhatsApp draft) path can't be
  tested from desktop — verify on a real Android phone (primary) + note iOS behaviour.
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
- **🔴 Parked (owner) — rotate the prod `service_role` key (now more than tidiness).** A live prod
  `service_role` JWT was hardcoded in two git-tracked scripts (`scripts/run_migration.cjs`,
  `scripts/fix_inactive.cjs`) — fixed 2026-07-17 (commit `f420425`) to read `SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY` from env, but the key stays valid in git history until rotated, so rotation
  is the only thing that closes it. **Caveat:** on Supabase's coupled-key model rotating
  `service_role` also invalidates `anon`, taking prod down until Vercel's `VITE_SUPABASE_ANON_KEY` is
  updated + redeployed — do it in a quiet window (check the API-keys page first). Also parked: delete
  the dead `VITE_SUPABASE_SERVICE_KEY` line from `.env`.
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
- All 7 Edge Functions deploy with **`verify_jwt: false`** (each runs its own stricter `verify()`).
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
