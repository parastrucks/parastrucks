# Paras Portal — System Reconstruction Blueprint

> **Purpose:** rebuild the entire team portal (`team.parastrucks.in`) from scratch —
> database, backend, frontend, and all out-of-git configuration — using only this repo
> plus the artifacts it references. If the live system were lost, following this file
> end-to-end recreates it.
>
> **Authoritative artifacts** live in [`docs/db/`](db/) and the repo itself. Where a value
> is a **secret** (keys, passwords), this document tells you *where to get it*, never the
> value itself.

---

## 0. What recreates what — artifact inventory

| Layer | Source of truth | Notes |
|---|---|---|
| **DB schema** (tables, RLS, functions, triggers, extensions) | [`docs/db/schema-current.sql`](db/schema-current.sql) | **Gold standard.** Full `pg_dump --schema-only` of prod (75 tables, 112 RLS policies, 66 functions, 9 triggers). Apply this to a fresh project — do **not** replay the migrations. |
| **Reference / config data** | [`docs/db/seed-reference.sql`](db/seed-reference.sql) | `pg_dump --data-only` of config tables: entities, brands, departments, designations, outlets, operating_units, sales_verticals, access_rules (106 rows), sub_segments, vehicle_catalog (906). **No user PII, no transactional rows.** |
| **Backend logic** | [`supabase/functions/`](../supabase/functions/) | The 7 Edge Functions + `_shared`. |
| **Frontend** | `src/`, `index.html`, `vite.config.js` | React 18 + Vite SPA. |
| **Web/CDN config** | [`vercel.json`](../vercel.json) | SPA rewrites, CSP + security headers, cache rules. |
| **Schema evolution (historical only)** | [`supabase/migrations/`](../supabase/migrations/) | 18 incremental migrations (Phase 5→9.5). **Not a full base** — the earliest is `20260401`; Phases 1–4 DDL is only in `schema-current.sql`. Use for history/audit, not for a fresh build. |
| **Legacy seeds (superseded)** | [`docs/db/schema-phase1-base.sql`](db/schema-phase1-base.sql), [`docs/db/seed_vehicles-legacy.sql`](db/seed_vehicles-legacy.sql) | Phase-1 base schema + old vehicle seed. Kept for provenance; `schema-current.sql` + `seed-reference.sql` supersede both. |
| **Build tooling** | [`scripts/`](../scripts/) | `apply_migration.cjs` (Docker-free migration apply via `pg`), `create_access_rules.cjs`, `generate_seed.cjs`, etc. |

> **⚠️ Secrets in `schema-current.sql` — scrub before committing.** A `pg_dump --schema-only`
> captures **DB-webhook triggers with their `Authorization: Bearer …` headers** (e.g. the
> `sync_erp_users` trigger's `SYNC_SECRET`). Before committing any refreshed dump, redact those
> tokens: `sed -E 's/(Authorization":"Bearer )[A-Za-z0-9._-]+/\1__REDACTED__/g'`. The value in this
> repo is already redacted; the real secret lives only in the Supabase webhook config + the
> matching Edge Function secret (rotate both together if it ever leaks).

---

## 1. Prerequisites

- Accounts: **Supabase** (free tier OK), **Vercel** (Hobby OK), **Cloudflare** (free) for DNS + Turnstile.
- Local tools: Node.js `^20.19 || >=22.12` (vite 8 requirement), npm, `psql`/`pg_dump` (PostgreSQL 15+ client), the Supabase CLI (optional — the repo's `scripts/` avoid it).
- The repo cloned, `portal` branch.

---

## 2. Database

1. **Create the Supabase project** in region **`ap-south-1` (Mumbai)** (DPDP-friendly; matches prod).
2. **Apply the full schema** — connect via the **Session pooler** (port 5432) and run:
   ```bash
   psql "postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-<N>-ap-south-1.pooler.supabase.com:5432/postgres" \
     -f docs/db/schema-current.sql
   ```
   This creates every table, RLS policy, function, trigger, and required extension
   (`pgcrypto`, etc. — see the `CREATE EXTENSION` lines in the dump). Do this on a fresh
   project so there are no conflicts.
3. **Load reference/config data:**
   ```bash
   psql "<same session-pooler URI>" -f docs/db/seed-reference.sql
   ```
   This seeds the 2 entities (PTB/PT), 3 brands (AL/HDH/Switch), departments, designations,
   outlets, operating units, sales verticals, sub-segments, the 906-row vehicle catalog, and
   all 106 `access_rules`.
4. **Create the singleton admin.** The `users_single_admin` partial unique index enforces
   exactly one `permission_level='admin'`. Create an auth user (Dashboard → Authentication →
   Add user, or the Admin API), then insert its `public.users` profile row with
   `permission_level='admin'` and the admin `department_id`. (See `scripts/` for the original
   bootstrap pattern.)

> **Reconstruction note:** the migrations folder is *not* a clean-room base — apply
> `schema-current.sql` instead. The migrations exist for audit and to understand how the
> schema evolved (Phase 5→9.5); a from-scratch rebuild skips them.

---

## 3. Edge Functions (7)

Deploy each function in [`supabase/functions/`](../supabase/functions/): `verify-login`,
`admin-users`, `admin-access-rules`, `admin-catalog`, `admin-tiv`, `log-error`, `service-jobs`.

- **All 7 MUST deploy with `verify_jwt: false`.** Each function runs its own stricter
  `verify()` (the gateway's JWKS check mismatches). This is critical — see
  `memory/project_edge_function_auth.md`.
- Set the **Edge Function secrets** (Dashboard → Edge Functions → Secrets, or CLI):
  | Secret | Prod value | Purpose |
  |---|---|---|
  | `ALLOWED_ORIGINS` | `https://team.parastrucks.in` | CORS allow-list (comma-separated; add localhost only on staging) |
  | `REQUIRE_CAPTCHA` | `true` | Fail-closed Turnstile on login (unset/false for local dev) |
  | `TURNSTILE_SECRET` | *(from Cloudflare Turnstile)* | Server-side CAPTCHA verification |
- The service-role key is available to functions automatically; never ship it to the client.

---

## 4. Auth configuration (Supabase Dashboard → Authentication)

- **JWT expiry:** `43200` seconds (12 h).
- **Minimum password length:** `10` (raise to 12 per hardening T4 if desired).
- **Refresh-token reuse detection:** ON.
- **Leaked-password protection** (HaveIBeenPwned): ON if available on the plan.
- Per-IP / per-email rate limits on `/auth/v1/token` as available.

---

## 5. Turnstile (Cloudflare)

1. Create a **Turnstile** widget (Managed mode) for `team.parastrucks.in`.
2. **Site key** → frontend env `VITE_TURNSTILE_SITE_KEY` (and Vercel env).
3. **Secret key** → Edge Function secret `TURNSTILE_SECRET`.

---

## 6. Frontend build & environment

1. `npm install` (Node `^20.19 || >=22.12`).
2. Create `.env` (see [`.env.example`](../.env.example) — note the service key is intentionally
   **not** used by the client; service-role ops go through Edge Functions):
   ```
   VITE_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key from Dashboard → API>
   VITE_TURNSTILE_SITE_KEY=<Turnstile site key>
   ```
3. `npm run dev` (port 3000, see `.claude/launch.json`) for local; `npm run build` for prod.
   - Production builds strip `console`/`debugger` via `vite.config.js` `esbuild.drop`.

---

## 7. Hosting & CDN (Vercel + Cloudflare)

- **Vercel project** auto-deploys from the `portal` branch. Set the three `VITE_*` env vars
  in Vercel (Project → Settings → Environment Variables). See `memory/feedback_vercel_api.md`
  for the account/project IDs and API command templates.
- **`vercel.json`** already defines SPA rewrites, the CSP + security headers (HSTS, X-Frame-Options
  DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), `no-cache` for HTML, and
  `immutable` for hashed `/assets/*`. **Verify headers by curling the real page URLs** (`/`, `/login`)
  — the CSP is delivered with the document.
- **Custom domain** `team.parastrucks.in` → Vercel. DNS on Cloudflare (free): publish **SPF/DKIM/DMARC**
  for `parastrucks.in`; optionally the 5 free WAF custom rules (rate-limit `/auth/v1/token`, Bot Fight Mode).

---

## 8. Verification (smoke)

1. `curl -I https://<domain>/` → CSP + HSTS + X-Frame-Options present.
2. Login as admin (Turnstile challenge passes) → Dashboard renders.
3. Create + save a quotation → PDF downloads; a `quotations` row appears.
4. An Edge Function call from each role works; unknown-origin CORS is rejected:
   ```bash
   curl -i -H "Origin: https://evil.example" https://<PROJECT_REF>.functions.supabase.co/verify-login -d '{}'
   # → no Access-Control-Allow-Origin echo
   ```
5. Reference data visible: brands, entities, catalog all populated.

---

## 9. Out-of-git values checklist (gather before you start)

These are **not** in the repo — collect them from their consoles:

- [ ] Supabase project ref + **DB password** (Dashboard → Settings → Database)
- [ ] Supabase **anon key** + **service-role key** (Dashboard → Settings → API)
- [ ] **Turnstile** site key + secret (Cloudflare Turnstile)
- [ ] Vercel account/team/project IDs (`memory/feedback_vercel_api.md`) + `VERCEL_TOKEN`
- [ ] Domain registrar / Cloudflare DNS access for `parastrucks.in`
- [ ] The admin user's email + initial password (rotate after first login)

---

## 10. Full history & rationale

Every phase, the Phase 9 security programme, and per-session change logs are in
[`docs/history/PORTAL_HISTORY.md`](history/PORTAL_HISTORY.md). Subsystem specs:
[`docs/history/tiv-forecast-migration-spec.md`](history/tiv-forecast-migration-spec.md) (TIV Forecast),
[`docs/history/phase9-verification-report.md`](history/phase9-verification-report.md) (VAPT),
[`docs/backlog/`](backlog/) (tabled ideas + Phase 10).
