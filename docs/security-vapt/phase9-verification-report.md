# Phase 9 Security Verification — Plain-English Report

**Date:** 2026-05-18
**What this is:** After deploying the Phase 9 security fixes, we ran a simulated attack against the live portal (team.parastrucks.in) to check whether the fixes actually work. This report explains — in plain language — what we found.

**How we tested:** Three independent reviewers attacked three different "doors" into the system at the same time:
1. The **front door** — the public website and its 6 server functions (anyone on the internet can knock here).
2. The **server logic** — the rules that decide who is allowed to do what.
3. The **database + app code** — where the actual data lives and how the app is built.

We did **not** do anything destructive (no password guessing against real accounts, no changing real data). Think of it as a locksmith checking your locks, not a burglar breaking in.

---

## The headline

**Good news:** The Phase 9 fixes did their job. Every control we deployed is working correctly. The front door is solid.

**The catch:** We found problems that Phase 9 was never designed to look at. They are one layer *deeper* — in the rules about who can see and edit what. None of them can be exploited by a random stranger on the internet. They all require someone to **first have a valid login** to the portal (i.e. an employee, or someone who stole an employee's password).

Think of it like this: Phase 9 reinforced the building's outer walls and main gate — and that worked. But inside the building, a few interior doors that should be locked are standing open. Only people already inside the building can walk through them — but they shouldn't be able to.

---

## The findings, explained simply

Each finding below has: **what it is**, **a real-world analogy**, **how serious it is**, **who could abuse it**, and **the fix**.

---

### 🔴 Finding C1 — Every employee can see every coworker's personal details

**What it is:**
The portal has a rule that is supposed to say: *"You can only look up a coworker's full profile if you are an Admin, if it's your own profile, or if you are HR."* But a quick patch made back in April (to fix an unrelated crash) accidentally widened that rule to: *"...or if that coworker is in the same company entity as you."*

Because almost everyone is in the same entity, the practical result is: **any logged-in employee — even the lowest-level staff — can pull up the full profile of every other employee in their company**: email address, phone number, employee code, their permission level, and whether their account is active.

**Real-world analogy:**
Imagine the office HR filing cabinet was supposed to be locked, with keys only for HR and management. Someone fixing a stuck drawer left the whole cabinet unlocked. Now any employee can browse everyone's personnel file. Nothing is *stolen* — but information that should be private is now visible to people who shouldn't see it.

**How serious:** High — but **not** "the internet can see it." A stranger cannot. You need a working portal login first.

**Who could abuse it:**
- A disgruntled employee harvesting colleagues' phone numbers and emails.
- An attacker who phished *one* staff password — they could then download the entire company contact list and use it to phish *everyone else* much more convincingly ("Hi, this is IT, I see your employee code is X...").

**Important caveat before we fix it:**
This needs a 30-second product decision from you first. The April patch may have been done because some screen in the app (an employee picker, a dropdown of colleagues) genuinely needs to show a list of coworkers. If we simply slam the door shut, that screen might go blank. **The right fix is probably:** keep the door shut for *sensitive* fields (phone, email, permission level) but allow a limited "name only" view if a screen needs it. We will confirm what the app actually needs before changing anything.

**The fix:** Remove the accidental "same entity" clause from the database rule. It's a one-line change. The crash it was added to fix is already prevented by another mechanism, so removing it is safe technically — we just need to confirm no screen depends on it.

---

### 🟠 Finding M-1 — The "bulk upload vehicles" feature accepts any data, unchecked

**What it is:**
When an authorized user edits **one** vehicle in the catalog, the system carefully checks each field — it only accepts the specific fields it expects (price, model, brand, etc.) and ignores anything else.

But the **bulk upload** feature (uploading many vehicles at once via a spreadsheet) skips that check entirely. It takes whatever columns are in the uploaded data and writes them straight into the database — up to 5,000 rows at a time.

**Real-world analogy:**
The single-item checkout counter inspects every item you buy. The bulk-order desk next to it just waves the whole pallet through without looking. Someone could slip extra items — or tamper with internal labels like the database ID or creation date — onto that pallet.

**How serious:** Medium. Requires a logged-in user who already has catalog-editing rights (a "back office" user). They could corrupt catalog records — overwrite internal IDs, timestamps, or fields they shouldn't control.

**Who could abuse it:** A back-office staff member, either maliciously or by uploading a badly-formed spreadsheet.

**The fix:** Make the bulk upload run every row through the **same field check** the single-item edit already uses. Straightforward — the checking code already exists, it just isn't applied to the bulk path. (This is an Edge Function change and needs a redeploy.)

---

### 🟠 Finding M-2 — A user from one company branch can write data tagged to another branch

**What it is:**
The portal serves more than one company entity (PTB and PT). The data is supposed to be kept separate — entity A's users work with entity A's data, entity B's with entity B's.

Most of the system enforces this strictly. But the **TIV Forecast** data-injection function does not. It accepts an "entity" label directly from whoever is calling it and trusts it — it never checks "wait, are you actually allowed to write data for *that* entity?"

**Real-world analogy:**
A courier is supposed to only deliver to their assigned neighbourhood. This particular dispatch desk lets the courier write *any* address on the parcel, no questions asked — so they could drop a package into a building that isn't on their route.

**How serious:** Medium. Requires a logged-in back-office user. They could inject or overwrite forecast figures belonging to the *other* company entity.

**Who could abuse it:** A back-office user of one entity, tampering with the other entity's forecast numbers.

**The fix:** Add the same "do you own this entity?" check that the rest of the system already uses. (Edge Function change, needs redeploy.)

---

### 🟡 Finding H-1 — A safety check is missing, but harmless *for now*

**What it is:**
The access-rules function is supposed to prevent someone from creating a rule that grants a permission level *equal to or higher than their own*. Right now that comparison check is simply absent.

**Why it's not currently dangerous:** Only **Admins** are allowed to use this function at all, and Admin is already the highest level — so there is nothing higher for them to wrongly grant. The missing check causes no harm today.

**Why we should still fix it:** It's a trap waiting to spring. The day someone decides "let's also let GM-level users manage access rules," this missing check instantly becomes a way for a GM to promote themselves to Admin. It's much cheaper to add the check now than to remember this landmine later.

**How serious:** Low today, but worth fixing as cheap insurance.

**The fix:** Add the caller-vs-target permission-level comparison.

---

### 🟡 Finding H-2 — Some admin actions aren't recorded in the audit log

**What it is:**
Phase 9 added a "security audit log" — a tamper-resistant record of sensitive changes. It correctly logs things like permission changes. But several admin actions are **not** logged: turning departments on/off, turning brands on/off, and creating or editing operating units.

This matters because turning a department on/off actually changes what every user in it is allowed to do. So an authorization-relevant change can happen with **no trace**.

**Real-world analogy:**
The security camera covers the vault door but not the side office where the master keys are reconfigured. If something goes wrong, there's no footage of who changed what.

**How serious:** Low. This is not an attack *path* — it's a gap in your ability to *investigate* later. Only Admins can do these actions anyway.

**The fix:** Add an audit-log entry to each of those admin actions.

---

### 🟡 Finding: ACAO wildcard — a header on the website is set too loosely

**What it is:**
The static website sends a technical header (`Access-Control-Allow-Origin: *`) that is more permissive than it should be. (Note: the **server functions** — the more sensitive part — are correctly locked down. This is only the static site files.)

**How serious:** Low. For a login-protected app like this, it's an inconsistency rather than a real hole. We flag it because it doesn't match the tightened-everything intent of Phase 9.

**The fix:** A small change to the Vercel configuration.

---

### 🟡 Finding M-3 — A spec item was written down but not implemented

**What it is:**
Phase 9's plan said users shouldn't be able to edit their own "account active" status. The code blocks them from editing their own permission level, entity, and department — but the "active status" item from the list was left out.

**Why it's not exploitable:** Through a separate quirk of how the code is built, there is currently no actual path for a user to flip their own active status anyway. So no harm — but the written plan and the code don't match.

**The fix:** Add the missing item, for completeness and to keep code matching the plan.

---

### 🟡 Finding L-1 — Brute-force protection "fails open"

**What it is:**
The portal limits how many login attempts you can make. But if the database has a hiccup while checking that limit, the system currently decides "allow the attempt" rather than "block it." This is called "failing open."

**How serious:** Low. It would only matter during a database problem, and an attacker would have to *cause* that problem. But for a *login* limiter specifically, the safer default is "fail closed" — when in doubt, block.

**The fix:** Make the login lockout fail *closed* (deny when uncertain).

---

### ⚪ Known residual items (no action needed)

Two software libraries (`postcss` and `dompurify`) have publicly-known minor vulnerabilities. We checked: **neither is exploitable the way this app uses them** — they're used only at build time / in ways the vulnerability can't reach. They were already noted as "deferred" and that decision still stands. They can be patched whenever convenient, with no urgency.

---

## What Phase 9 got right (the wins)

It's worth being clear about what *passed*, because it's a lot:

- ✅ The CORS allow-list correctly **rejects** unknown websites trying to talk to the server functions.
- ✅ All security headers (HSTS, anti-clickjacking, content-type protection, etc.) are present and correct — on the home page **and** deep pages.
- ✅ The Content-Security-Policy (which blocks injected scripts) is correctly configured.
- ✅ `security.txt` (the standard "how to report a vulnerability" file) is published.
- ✅ The server functions correctly **reject anyone without a valid login** with a clean error — no data leaks.
- ✅ Error messages don't leak internal details, stack traces, or "attempts remaining" hints.
- ✅ Every server function properly **verifies the identity** of the caller against a cryptographically-checked token — it never just trusts whoever *claims* to be someone.
- ✅ The HR-edit guardrails (HR can't edit other HR, can't promote above their own level) work.
- ✅ Deactivating a user immediately kicks them out of all their sessions.
- ✅ When the system can't determine someone's role, it **denies** access (fails safely).
- ✅ No dangerous code patterns in the app that could allow script injection (XSS).
- ✅ No secret keys accidentally shipped to the browser.
- ✅ Company entities A and B can't read each other's quotations, invoices, or catalog.

---

## Summary table

| ID | Finding | Severity | Exploitable by | Internet-exposed? |
|----|---------|----------|----------------|-------------------|
| C1 | All employees can read coworkers' PII | **High** | Any logged-in user | No — login required |
| M-1 | Bulk vehicle upload skips field checks | Medium | Logged-in back-office user | No |
| M-2 | TIV function allows cross-entity writes | Medium | Logged-in back-office user | No |
| H-1 | Missing tier check (harmless today) | Low | Nobody currently | No |
| H-2 | Some admin actions not audit-logged | Low | N/A (visibility gap) | No |
| — | Website CORS header too loose | Low | N/A | Minor |
| M-3 | Spec item not implemented (harmless) | Low | Nobody currently | No |
| L-1 | Login limiter fails open on DB error | Low | Theoretical | No |
| — | postcss / dompurify known CVEs | Info | Not reachable in this app | No |

---

## Recommended priority order

1. **C1** — confirm what the app needs, then narrow the rule. This is the only finding exposing real personal data today.
2. **M-1 and M-2** — close the two cross-tenant write paths. One combined Edge Function change + redeploy.
3. **H-1, H-2, M-3, L-1, CORS header** — a cleanup batch. Low urgency, low risk, can be done together in one pass.
4. **postcss / dompurify** — patch whenever convenient. No urgency.

*Nothing here is an emergency. The portal is not exposed to anonymous internet attackers. Every finding requires someone to already hold a valid login. But C1 is leaking personal data right now and should be the next thing addressed.*
