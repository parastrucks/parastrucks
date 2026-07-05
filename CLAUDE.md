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

## Current state (2026-07-05)

- **Deployed & live:** Phases 1A–9 + **Phase 9.5 Vendor Jobs** (`/vendor-jobs`) + the 2026-07-04
  changes (Service/Spares require Brands; bus-calc sticky fix; gitignore `.env*`). CI + Vercel green.
- **Built, NOT yet live — Phase 9.6 visual redesign** (Paras Group print-report language: paper/ink/
  hairline/one-blue-accent, Carlito, Lucide; 4-section sidebar; new mobile shell; PageHead; mobile
  card tables). Branch **`9.6-portal-redesign`** (off `origin/portal`, 21 commits, builds green),
  smoke-tested on staging + red-teamed (ship-safe). Visual/structural only. **Next = open PR → owner
  one-shot merge to `portal`.** Detail: `memory/phase96_portal_redesign.md`; open owner decisions in
  `memory/known_issues.md`. Old-portal designer handoff on the branch: `docs/PORTAL_UI_HANDOFF.md`.
- **Planned, not started:** **Phase 10 — Vehicle Tracker** (`/tracker`) — see `docs/backlog/phase10-vehicle-tracker.md`.
- **Separate project (not this repo):** the HD Hyundai **ERP** (`erp.parastrucks.in`, repo `erp-parastrucks`) — see `memory/project_hd_hyundai_vertical.md`.

## Next actions

- **Phase 9.6 redesign go-live:** open PR `9.6-portal-redesign` → `portal` (runs CI + Vercel
  prod-candidate) → **owner merges** for the one-shot release → verify prod + CSP. Optionally action
  the open owner design-decisions first (drawer Profile / sidebar auto-expand / drawer focus-trap /
  mobile-card designation — `memory/known_issues.md`). Worktree `.claude/worktrees/awesome-kare-7d6c1b`
  has dev-local `.env`→staging + `launch.json`→port 5173 (uncommitted).

- **Task A — restore localhost dev:** keep local `.env` pointed at the **staging** Supabase
  project (`klpnhpnlotcbbovwswmq`); staging EFs whitelist `http://localhost:3000` in `ALLOWED_ORIGINS`.
  **Do NOT add localhost to the prod project's `ALLOWED_ORIGINS`** (owner-rejected). Prod creds
  live in `.env.prod.bak` for occasional prod work.
- **Phase 9 residual hardening (9h/9i):** MFA, new-device email, active-sessions page,
  security-monitor cron, file-upload virus scan, PII encryption; plus process items. Untouched.
  Full specs in `docs/history/PORTAL_HISTORY.md` (Phase 9 programme).
- **Parked (owner):** delete the dead `VITE_SUPABASE_SERVICE_KEY` line from `.env`; rotate the
  prod `service_role` key.
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
