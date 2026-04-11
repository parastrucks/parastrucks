---
name: phase5_auth_config
description: Manual Supabase Auth dashboard settings required as part of Phase 5 hardening (U2). These cannot be expressed in code/migrations and must be applied by a human in the Supabase dashboard.
type: reference
---

# Phase 5 — Supabase Auth Dashboard Configuration

These settings must be applied **manually** in the Supabase dashboard for project
`mmmxvjaavdtwlpcnjgzy` (team.parastrucks.in portal). They complement the security
headers shipped in `vercel.json` (Phase 5 U2) and the CAPTCHA wiring from U8.

## Checklist

### 1. Leaked password protection — ENABLE

- Navigate: **Authentication → Policies → Password Protection**
- Toggle **"Check passwords against HaveIBeenPwned"** → ON
- Rationale: rejects credentials that appear in known breach corpora; zero cost,
  no UX regression for legitimate users choosing strong passwords.

### 2. Minimum password length — SET TO 10

- Navigate: **Authentication → Policies → Password Requirements**
- Set **"Minimum password length"** → `10`
- Rationale: portal stores commercially sensitive dealership data (price lists,
  customer records, sales forecasts). 10 chars is the current OWASP floor for
  low-privilege business apps; keeps brute-force cost high without punishing
  mobile users.

### 3. JWT expiry — RAISE TO 12 HOURS

- Navigate: **Authentication → Sessions → JWT expiry limit**
- Set to **`43200`** seconds (12 hours)
- Rationale: addresses the known issue where users lose session mid-work
  (e.g., mid-way through a TIV Forecast entry or a multi-page PDF export).
  Cross-reference: `memory/known_issues.md` — "session expiry" open item.
- Refresh-token rotation stays on; 12h JWT + rotating refresh keeps the
  threat window tight while eliminating the mid-task logout UX failure.

### 4. CAPTCHA provider — CLOUDFLARE TURNSTILE

- Navigate: **Authentication → Attack Protection → CAPTCHA protection**
- Provider: **Cloudflare Turnstile**
- Site key + secret: stored in Vercel env vars (see U8 PR for variable names)
- Scope: login + signup flows
- Rationale: rate-limits credential stuffing against the admin/staff login
  surface. Turnstile chosen over hCaptcha/reCAPTCHA for privacy + zero-friction
  invisible challenges. **Coordinates with U8** — do not enable in dashboard
  until U8 ships the `captchaToken` field in the sign-in client call.

## Verification (after applying)

1. Attempt sign-up with password `password123` → should be rejected (leaked).
2. Attempt sign-up with 9-char password → should be rejected (length).
3. Sign in, leave tab open 6 hours, interact → should still be authenticated.
4. After U8 deploys, confirm Turnstile widget appears on the Login page.

## Cross-references

- `vercel.json` — HTTP-level hardening (CSP, HSTS, X-Frame-Options, etc.)
- U8 PR — Turnstile client integration
- `memory/known_issues.md` — session expiry item resolved by step 3
