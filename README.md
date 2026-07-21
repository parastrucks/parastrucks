# Paras Portal — team.parastrucks.in

Internal employee portal for the **Paras Trucks & Buses** group (commercial-vehicle
dealer — Ashok Leyland, Switch Mobility, HD Hyundai CE).

**React 18 + Vite · Supabase (Auth + PostgreSQL + Edge Functions) · Vercel · Cloudflare Turnstile**

- **Live:** https://team.parastrucks.in (auto-deploys from the `portal` branch)
- **Supabase:** project `mmmxvjaavdtwlpcnjgzy`, region `ap-south-1` (Mumbai)

> `main` is the unrelated public marketing website. All portal work lives on the `portal` branch.

---

## Status

Phases **1A → 9.5 are live** (quotations, proforma & financier invoices, vehicle catalog,
bus calculator, TIV forecast, employee management, access rules, and the Vendor-Jobs service
tracker at `/vendor-jobs`). **Phase 10 — Vehicle Tracker** is planned. See the full record in
[`docs/history/PORTAL_HISTORY.md`](docs/history/PORTAL_HISTORY.md).

## Documentation

| I want to… | Read |
|---|---|
| Understand how to work in this repo / current state | [`CLAUDE.md`](CLAUDE.md) |
| **Rebuild the entire system from scratch** | [`docs/RECONSTRUCTION.md`](docs/RECONSTRUCTION.md) |
| See the full project history + Phase 9 security programme | [`docs/history/PORTAL_HISTORY.md`](docs/history/PORTAL_HISTORY.md) |
| Canonical DB schema + reference-data dumps | [`docs/db/`](docs/db/) |
| Report a security issue | [`SECURITY.md`](SECURITY.md) |
| Tabled feature ideas + Phase 10 | [`docs/backlog/`](docs/backlog/) |

## Local development

```bash
cp .env.example .env    # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY
npm install             # Node ^20.19 || >=22.12
npm run dev             # http://localhost:3000
```

Local dev points at the **staging** Supabase project (prod Edge Functions reject `localhost`
via CORS by design). The client never uses a service-role key — privileged operations go
through Edge Functions. Full setup, deployment, and reconstruction steps are in
[`docs/RECONSTRUCTION.md`](docs/RECONSTRUCTION.md).

## Access model

Access is data-driven via the `access_rules` table, evaluated by `canAccess(route)` in
`AuthContext`. A user carries a `permission_level` (`admin` / `gm` / `manager` / `executive`),
an `entity_id` (PTB / PT), a `department_id`, and brand / sales-vertical / outlet associations
(join tables). See `memory/terminology.md` for the exact column model.

## Project structure

```
src/
  lib/supabase.js            Supabase client (anon; custom storage adapter)
  context/AuthContext.jsx    Session, profile, access rules, canAccess()
  components/                ProtectedRoute + layout (Sidebar, BottomNav)
  pages/                     One file per tool (Quotation, Catalog, BusCalculator, ServiceJobs, …)
  utils/pdfGenerator.js      jsPDF document generation (entity-aware)
  tiv-forecast/              TIV forecasting module
  index.css                  Global design system (no Tailwind)
supabase/
  functions/                 9 Edge Functions (all deploy verify_jwt:false)
  migrations/                Incremental schema history (Phase 5→9.5)
docs/                        History, reconstruction blueprint, DB dumps, backlog
```
