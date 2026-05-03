# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in the Paras Trucks
Team Portal (https://portal.parastrucks.in), please report it privately to:

- **Email:** hr.guj@parastrucks.in
- **Subject prefix:** `[SECURITY]`

Please do **not** open a public GitHub issue for security-impacting bugs.

When reporting, include as much of the following as you can:

- A description of the issue and the security impact you believe it has.
- Steps to reproduce, including any specific account / role / browser
  required.
- A timestamp (in IST, UTC, or both) — helps us correlate with logs.
- Any proof-of-concept payload (please do not exfiltrate or modify data
  belonging to other users).

We will acknowledge receipt within **3 working days** and aim to provide a
preliminary assessment within **10 working days**. Disclosure timelines
beyond that depend on the nature of the issue and the remediation
required.

## Scope

In scope:

- The portal at `https://portal.parastrucks.in` and its Supabase backend
  (Edge Functions, RLS policies, database schema).
- The codebase in this repository.

Out of scope:

- Findings that require physical access to a logged-in user's device.
- Self-XSS that requires the victim to paste attacker-supplied JavaScript
  into their own browser console.
- Reports about missing security headers on third-party assets we don't
  control (e.g. `https://challenges.cloudflare.com`).
- Reports on the public marketing site (`https://parastrucks.in`); that's
  a separate property.

## Safe-harbour

We will not pursue legal action against good-faith research that:

- Does not access, exfiltrate, modify, or destroy data belonging to
  other users beyond what is strictly needed to demonstrate the issue.
- Does not degrade availability for other users (no DoS, no automated
  load testing).
- Notifies us privately before any public disclosure.

This is a small-team, single-property programme — please be patient with
response times. We're not running a paid bug-bounty programme yet.

---

See also: `/.well-known/security.txt` (RFC 9116).
