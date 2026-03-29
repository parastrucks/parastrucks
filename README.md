# Paras Portal — team.parastrucks.in

Employee portal for Paras Trucks and Buses group.
React + Vite · Supabase (Auth + PostgreSQL) · Vercel

---

## Setup (one-time)

### 1. Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Name it `paras-portal`, choose a region close to India (Singapore)
3. Once created, go to **SQL Editor** → paste and run `supabase_schema.sql`
4. Go to **Settings → API** → copy `Project URL` and `anon public` key

### 2. Local development

```bash
# Clone / create repo and cd into it
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from step 1

npm install
npm run dev
# Opens at http://localhost:3000
```

### 3. Create first admin user

In the Supabase dashboard:

1. Go to **Authentication → Users → Invite user**
2. Enter admin email (e.g. `dhruv@parastrucks.in`)
3. User receives invite link, sets password
4. Go to **SQL Editor** and insert the profile row:

```sql
INSERT INTO public.users (id, username, full_name, role, entity, is_active)
VALUES (
  '<uuid-from-auth-users-table>',
  'dhruv.ahm',
  'Dhruv Bothra',
  'admin',
  'PTB',
  true
);
```

### 4. Deploy to Vercel

1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → import your repo
3. Add environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
4. Deploy

### 5. Custom domain

In Squarespace Domains, add:
```
Type:  CNAME
Host:  team
Value: cname.vercel-dns.com
```

In Vercel → Project Settings → Domains → add `team.parastrucks.in`

---

## Project structure

```
src/
  lib/
    supabase.js          Supabase client singleton
  context/
    AuthContext.jsx      Session, profile, signIn, signOut
  components/
    ProtectedRoute.jsx   Auth guard with optional role check
    layout/
      AppLayout.jsx      Sidebar + main + bottom nav wrapper
      Sidebar.jsx        Desktop left nav (role-aware)
      BottomNav.jsx      Mobile bottom tabs (role-aware)
  pages/
    Login.jsx            Login screen
    Dashboard.jsx        Role-aware home dashboard
    Profile.jsx          View profile + change password
    [more pages added per phase]
  index.css              Global styles
  App.jsx                Route definitions
  main.jsx               React entry point
supabase_schema.sql      Full DB schema — run in Supabase SQL editor
```

---

## Roles

| Role | Access |
|---|---|
| `admin` | Everything + entity toggle + quotation log + access rules + catalog |
| `hr` | Employee management only |
| `back_office` | Quotation tool (editable) + catalog |
| `sales` | Quotation tool (MRP-locked) + bus calculator (if vertical=Bus) |

---

## Phase plan

- **Phase 1A** (current) — Auth, dashboard, profile, HR employee management
- **Phase 1B** — Truck quotation tool, PDF generation, quotation history
- **Phase 1C** — Bus calculator integration, access rules UI, deploy
- **Phase 2** — Training, referrals, careers management, Switch/HDCE brands
