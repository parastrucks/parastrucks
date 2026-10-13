# Cloud-session briefs (Service Payments)

The owner runs a second Claude session in the cloud (Fable model) for **second opinions and open
discovery** — it found two layout defects in red team 4 that every test and the browser walkthrough
had missed. Owner, 2026-10-12: *"Whenever you need a second opinion, we can use the cloud session …
be sure to ask for second opinions, as there is always room to improve."* (memory
`feedback_second_opinion_cloud.md`).

**How the relay works:** the cloud session cannot see the PC conversation and cannot message back.
The PC session writes a self-contained prompt; the owner pastes it and pastes the answer back.
A cloud session's GitHub write credential is minted at session start and does NOT refresh on
reconnect (403 on every push) — so either start a FRESH cloud session for work that must push, or
bring commits over as a verified git bundle (never the GitHub-API route, which rewrites SHAs).
Method: memory `reference_cloud_session_handoff.md`, PORTAL_HISTORY 2026-10-12 (red team 4 entry).

Briefs 1 and 2 were written 2026-10-12, Brief 3 on 2026-10-13. **Status (2026-10-13):** Brief 1 —
answer not back yet · Brief 2 — ✅ done, merged `6809c5e` (`docs/backlog/service-payments-premortem-1.md`),
owner answered its Q1–Q6 · Brief 3 — written, to be sent to the Brief 1 session.

---

## Brief 1 — second opinion on the open red-team-4 design items

Sent to the red-team-4 cloud session (its write credential is dead; answer in chat only).
When it answers: put the decisions to the owner with both views side by side (AskUserQuestion).

```text
Second opinion needed. Answer in chat only; no commits or pushes.

Context: your red team 4 findings (docs/backlog/service-payments-redteam4-uiux.md on your redteam4 branch) are on GitHub now, and the PC session has fixed the clear defects in commit e49ea7b. You won't have that commit:
R4-1 desktop bar; R4-2 fold marker, with Clashes open by default; R4-10 stale banner said once, and the bar reads "Confirm is off — bills not loaded yet"; R4-15 an opened block scrolls into view above the bar; R4-16 strip padding; R4-17 end-screen wording; R4-19 denied text; R4-22 contrast; R4-25 dead scroll; R4-27 "No connection"; R4-13 identical names say "matches"; R4-20 a search pick comes back selected, and fewer than 3 digits searches amounts only; R4-8 the picked card gets a 4px bar and a tick.

Still open, all design choices: R4-3 seeing and undoing a match; R4-5 date and plate on cards; R4-6 part-payment remainder; R4-9 confirm for not-service; R4-12 the "2 bills" breakdown; R4-14 nav entry; R4-21 wordlist; R4-4/R4-7 phone head and landscape; R4-18 accounts tie-out; R4-23 keyboard; R4-24 link-blue reasons and the + button.

Facts that constrain the design:
- The server already has reverse_allocation. It requires a reason. The person who made the match, or accounts, can undo it before export; after export, only a GM. No database work is needed for undo.
- A hard lesson from this portal: a TIV page was rejected by the owner as "too much information — employees feel intimidated rather than informed", because every finding was fixed on its own merits and nothing checked the total. The rule now: every UI addition states what it pushes down the page, and the default view answers the question while everything else folds one tap away.
- Users are mechanics and ground staff on cheap phones (360px); accounts uses a PC. The owner chose "simpler English, never another language".

What I want:
1. Rank the open items by value to a mechanic's first week, and say which ones should NOT be built.
2. For R4-3, R4-5, R4-6 and R4-12, give the smallest design that answers each, with the exact strings, and the px or lines it adds. Can any of them share one change? For example, could the selected card become the place where the date, plate, remainder and breakdown appear, so the unselected list stays as it is?
3. For R4-3: where should "matched today" with Undo live (a fold on the Match tab, an Undo in the toast, both, something else), and how is the reason asked for in one tap?
4. For R4-21: which renames matter most, and does renaming "Bill not raised yet" to "Bill not made yet" carry any risk? The owner has already seen it working.
5. Anything I've missed, or a route that isn't on this list.
```

> **Since this brief was sent,** batch 2 (`93995d1`) also fixed R4-4, R4-7, R4-23, R4-26, R4-30 and
> part of R4-18 — the brief still lists some of those as open. Ignore its answers on those, or use
> them as a check on what was built.

---

## Brief 2 — "Pre-mortem: Service Payments, 30 days after go-live"

For a **fresh** cloud session started on `claude/payments-reconciliation-tool-6eaab4` (so its push
works). Freedom in HOW it looks; guardrails on WHAT counts as a finding. It pushes to its own
branch `premortem-1`. When it finishes: verify its branch exactly as the red-team-4 bundle was
verified (base = our tip, no `src/`/`supabase/`/package changes, no secrets/hosts, 0 deletions),
then go through its findings with the owner.

Facts checked when writing it (2026-10-12): `docs/db/schema-current.sql` is the prod snapshot of
2026-07-21 (`b1fd93b`); 14 migrations post-date it (7 TIV/security, 7 payments); probes
`probe-allocation.sql`, `probe-import-parity.sql` (generated by `gen-probe-import-parity.mjs`),
`probe-awaiting-invoice.sql`, `probe-read-gates.sql` (refuses on prod by design).

```text
MISSION — "Pre-mortem: Service Payments, 30 days after go-live"

It is 30 days after Service Payments went live on prod (team.parastrucks.in). Something went wrong: money was placed on the wrong bill, counted twice, lost, or the morning routine stopped working. Your job is to find out what, before it happens. You have wide freedom in HOW to look. You have strict rules about WHAT counts as a finding (below).

START BY READING (in this order; nothing else is required reading):
1. CLAUDE.md: the current-state blocks dated 2026-10-12 back to 2026-08-30, and "Next actions" item 9 (the prod rollout).
2. docs/backlog/service-payments-plan.md (v4): Part 1, plus the Part 2 sections on money rules.
3. docs/backlog/service-payments-redteam4-uiux.md (screen findings already known; do not repeat them).
4. The code: src/service-payments/lib/*, supabase/functions/service-payments/*, supabase/migrations/2026083*..20261012*, scripts/payments/* (the existing self-tests and probes).

TWO TRACKS ARE SUGGESTED, AND A THIRD IS YOURS:

Track A: rehearse the prod migration on a database shaped like prod.
- Prod gets these seven files in order: 20260830_payments_a1_schema, 20260908_payments_a1_rpcs, 20260926_payments_read_gates_and_route, 20260926_payments_views_for_match, 20260926_payments_import_rules, 20261009_payments_hdfc_source, 20261012_payments_awaiting_invoice.
- Staging received them in pieces, re-applies and fixes along the way, so staging proves less than it seems.
- Build a local Postgres in the container. @electric-sql/pglite from npm is one way; a real postgres is fine if you can install one.
- Load docs/db/schema-current.sql (a prod snapshot from 2026-07-21). Then apply every migration dated after it, in filename order, as prod would.
- FIRST, measure how far your rehearsal database is from prod, and write it down:
  - what the snapshot predates;
  - which Supabase pieces you had to stub (auth schema, roles anon/authenticated/service_role, auth.uid(), extensions such as btree_gist);
  - what that stubbing could hide.
  A rehearsal that hasn't stated its own gaps proves nothing.
- Then run the self-aborting probes (scripts/payments/probe-allocation.sql, probe-import-parity.sql, probe-awaiting-invoice.sql). Hunt for problems that only show on prod's shape: ordering dependencies, a migration that isn't safe to re-run, grants and RLS that differ, objects the snapshot has that staging lacked, a view or function that breaks.
- probe-read-gates.sql refuses on prod by design. Find out why from its header, and decide whether it is meaningful in your rehearsal.

Track B: live the first month.
- Using ONLY the real pure modules (parsers, matcher, matchQueue, importPlan, signalLabels) and the demo generator's file shapes (scripts/payments/make-demo-files.mjs), simulate 30 working days of the routine:
  - morning Billing Report import, then HDFC report import (overlapping days), then matching by a realistic but imperfect person (skips, wrong picks later reversed, part payments, "bill not raised yet", search);
  - plus month-end, SAP cancellations, a bill amended after payment, a re-sent file, a day with no file, midnight IST, Sundays and holidays, a ₹1 test payment.
- Where the database decides, either drive your Track A database or state clearly that you modelled the rule.
- Look for slow drift, not single-day bugs: open counts that never fall, a waiting payment that never returns, memory that learns the wrong payer, a window that silently stops covering, totals that stop tying to the bank.

Track C: anything else your reading tells you is the real risk. Say why you chose it.

GUARDRAILS (hard; breaking one voids the finding):
1. NO LIVE SYSTEMS.
   - Do not touch Supabase (no MCP database tools, no URLs, no keys), team.parastrucks.in, Vercel, Gmail or any real account.
   - Network access is limited to package registries and GitHub.
   - There is no real customer data in the repo. If you ever see a real-looking customer file, stop and report its path without opening it.
2. EVIDENCE OR IT DIDN'T HAPPEN. Every finding carries one tag:
   - [Reproduced]: a committed script plus the exact command plus the relevant output lines. Where you can, also show a negative control: the check passes on fixed or alternative code, or fails on deliberately broken code.
   - [Read in code]: file:line quotes that prove it.
   - [Inferred]: reasoning only. These go in their own section and are never ranked above "Slows".
3. DO NOT INVENT THE OUTSIDE WORLD.
   - What SAP, HDFC, Busy or the bank do is known only from the repo (parsers, fixtures, the plan's measurements).
   - Anything beyond that is written as an open question for the owner, never as a fact.
   - Never claim a number you didn't compute in this session.
4. FROZEN OWNER DECISIONS: do not re-litigate them (they're listed in CLAUDE.md and the plan). These include:
   - PTB first; UPI = HDFC only; next-day batch matching; humans pick, no auto-match; QR/branch only ranks, never filters; SAP gives a date, never a time.
   - Accounts uploads the HDFC report daily until the API; warranty and AMC are excluded; simpler English, never another language; dummy data only on staging.
   You MAY report that a decision has a cost you measured.
5. WRITE SCOPE:
   - New files only, under scripts/payments/premortem/ and docs/backlog/.
   - No edits to src/, supabase/, package.json or package-lock.json. Your scratch dependencies go in a folder outside the repo, as in the redteam4 rig.
   - Findings, not fixes. You may sketch a fix inside a finding.
6. Severity, by money first:
   - Wrong money: misplaced, double-counted or lost, or a total that won't tie to the bank.
   - Breaks the day: the routine can't be finished.
   - Hides a problem: wrong but silent.
   - Slows.
   - Polish.
7. When a question is the owner's to decide, write it as a question with options and your lean. Don't guess.

DELIVERABLES:
- docs/backlog/service-payments-premortem-1.md, containing:
  - a one-paragraph verdict;
  - "what would most likely go wrong first";
  - ranked findings using the tags above;
  - the rehearsal database's own gaps;
  - owner questions;
  - a "proved safe" section (claims you tried to break and could not; this matters as much as the bugs);
  - a resume log.
- Repro scripts under scripts/payments/premortem/, each runnable with one documented command.

WORKING RULES:
- Commit as you go. Use commit author "Dhruv Bothra <ceo@parastrucks.in>", set per command with -c, never globally.
- Push to a NEW branch premortem-1. Never push to claude/payments-reconciliation-tool-6eaab4 or portal.
- If a push returns 403, do not use the GitHub API. Make a git bundle and say so.
- Keep the resume log current, so another session could continue if this one dies.
- If something blocks you for more than ~20 minutes, write down what you tried, move on, and list it as an open item.
- At the end, print: the branch tip SHA; git diff --stat against your base; the top 5 findings, one line each with their tags; and anything you are unsure of.
```

**What it will NOT prove (said to the owner when it was written):** real Supabase behaviour —
a locally built copy has to imitate Supabase's sign-in system and roles, and that can hide
differences. Prod still gets its real checks (the self-aborting probes + md5 of function bodies),
run as planned and only with owner approval. Nor how real people behave — it simulates a person.

---

## Brief 3 — follow-up to Brief 1: the correction screens the pre-mortem made necessary

Written 2026-10-13, after pre-mortem 1 was merged (`6809c5e`) and the owner answered its six
questions. For the **same session as Brief 1** (it already knows red team 4; answer in chat only).
When it answers: put the screen decisions to the owner beside our own view, then build.
**Status at writing: not sent yet.**

```text
Follow-up to my last question (the 8 open design items). Answer in chat only; no commits or pushes. If you have not answered the first question yet, answer both in one reply, and say where one answer changes the other.

What happened since: a separate cloud session ran a pre-mortem ("30 days after go-live, what went wrong?"). It rehearsed the prod migrations on a prod-shaped database and simulated a month of mornings through the real code. Its record is docs/backlog/service-payments-premortem-1.md on branch claude/payments-reconciliation-tool-6eaab4. Fetch that branch and read the code at commit 1b9fc87 or later; your own red team 4 branch does not have it.

What it found:
- The ledger held: nothing was counted twice or lost, and every day tied to the bank.
- The loop around it failed. F1: an advance was confirmed onto the only same-amount bill in the 3-day window ("Only bill at this exact amount", confident), was undone, and the next morning the same bill was offered again, still confident, three times running.
- F2: when SAP cancels a bill that already has money on it, Import shows the same clash every morning ("reverse that match first"), and no screen can reverse a match.
- F3: wrong picks are kept, because no screen shows yesterday's matches.
- F5: bills paid in cash or by cheque stay "open" for ever (1,800 open bills after a month, 95% never paid by UPI).

The owner's decisions (final, do not re-open):
- Q5: before go-live, build three things:
  (1) a list of matches with Undo;
  (2) a bill a payment was taken off is never offered to that payment again;
  (3) a way for accounts to record cash and cheque payments.
- Q6: Skip stays as it is, with an explanation that a skipped payment comes back tomorrow. There is no "not mine" button.
- The SAP export covers the month to date. The match window stays ±3 days, and late payers are found by Search.

(2) is BUILT (1b9fc87):
- The page reads the undone matches for the payments in its queue.
- matchCandidates() takes `undone` (bill ids). It leaves out any card holding one (order cards too), and does not count it when deciding another bill is "the only one".
- Once a payment has been undone, "only bill at this amount" no longer makes it confident.
- When a bill was left out, one hint line says "The bill this payment was taken off before is not offered again."
- A waiting payment does not come back for that bill.
- A search pick of it says "This payment was taken off this bill before on 13 Oct ("reason"). Check it is really the one before you confirm again."
Critique this. In particular: leaving the bill out versus showing it demoted with a warning, and switching off "confident" for good on that payment.

Facts the design must respect (verify them in the code; cite file:line for any claim you make about the code):
- Undo is payments_reverse_allocation(allocation id, actor, reason). The reason is required ("a reversal must say why"). Who may undo is reverseAllowed() in supabase/functions/service-payments/authority.ts:
  - before export to Busy: the person who made the match, accounts, or a GM;
  - after export: only a GM, and it travels to Busy as a correcting entry.
  The Busy export does not exist yet, so for now everything is "before export".
  One payment split over a parts + labour pair is one confirm but TWO allocation rows.
- A cash or cheque receipt is payments_manual_receipt(entity, row, actor). It is accounts-only and creates a RECEIPT, not a match. Placing it on a bill is a second call (allocate). Two calls are not atomic, and every write carries a client_request_id for safe retry.
  Its UPI-mode error message still names BharatPe and Google Pay, both retired; HDFC is the only UPI source now.
- Service staff (mechanics, counter staff) use 360px phones. Accounts uses a PC.
- The TIV clutter lesson: every addition states what it pushes down the page; the default view answers the question and the rest folds one tap away.
- Simpler English, never another language.

What I want:
1. The undo list. Where does it live: a fold on the Match tab, the toast after Confirm, the Import clash row, its own tab, or something else? Who sees whose matches? How is the reason asked for in one tap (canned reasons, like the four Skip reasons in signalLabels.js)? How is a parts + labour confirm shown and undone (as one thing or as two rows)? Give exact strings and the px or lines it adds to the default view.
2. The clash in F2: should the clash row on Import carry its own "Undo this match", so accounts clears it where they see it?
3. Cash and cheque (accounts, PC). Which is better:
   (a) record the receipt, then match it in the normal queue;
   (b) one form, "record a cash payment against this bill", making both calls;
   (c) something else?
   Name the fields. Say how a half-done (b) is avoided or recovered (receipt saved, match failed). Say where the form lives.
4. Q6's explanation of Skip: where, if anywhere, can it go without adding a line?
5. Rank all of it plus the 8 items from my first question, by value in the first month on prod, and say what you would NOT build before go-live.
6. Anything the pre-mortem and I have both missed.

Tag every claim [Read in code] (with file:line), [Measured] or [Inferred]. Say plainly where you are unsure.
```

---

## Brief 4 — pre-mortem 2: re-run the month on the fixes, and review them

Written 2026-10-13 at `0bf648a`, after the undo list (`8838dab`), R4-5 (`7230a53`) and the cash &
cheque tab + migration 8 (`19e49ad`) were built. For the **pre-mortem session** (it knows its own
rig; its push is dead, so it delivers a bundle). Verify the bundle as before, then triage with the
owner. **Status at writing: not sent yet.** ➕ Since written: `40e2f3f` (Import clash-row Undo) —
add it to Track C if the brief has not gone yet, or send the one-line addendum given in chat.

```text
Pre-mortem 2. Same rules as your first mission (no live systems; evidence tags [Reproduced] / [Read in code] / [Inferred]; don't invent SAP/HDFC/Busy behaviour; frozen owner decisions; findings, not fixes). Your push is refused, so deliver a git bundle as before. Answer in chat as well.

Fetch claude/payments-reconciliation-tool-6eaab4 at 0bf648a or later and branch premortem-2 from it. Since your run, the PC built your findings' remedies. The owner's decisions and the build order are in docs/backlog/cloud-answer-briefs-1-3.md; read that file first.
- 1b9fc87 + 2243129: matchCandidates(…, { undone }). A bill a payment was taken off is never offered to it again. Two canned reasons re-offer it ("Undo by mistake — offer it again", "Match again with a different amount"), and the newest undo of a pair decides (undoneByReceipt in matchQueue.js). After an undo, the remaining same-amount bill says "Only other bill at this amount in 3 days".
- 8838dab: "Matched today" fold (MatchedFold.jsx, groupMatches). One row per confirm, grouped by client_request_id. Undo reverses each allocation in turn, and the server's reverseAllowed() decides who may. Six tapped reasons; "Bill not raised yet — it was an advance" also marks the payment waiting.
- 7230a53: R4-5. Cards say "Billed 8 Oct · GJ15AV9044"; the SAP code stays beside the name.
- 19e49ad: "Cash & cheque" tab (CashPanel.jsx, lib/cashReceipt.js) and migration 8, 20261013_payments_manual_receipt_safe.sql.
  - payments_manual_receipt gains p_client_request_id: a replay returns the first receipt, a mismatch is refused, under an advisory lock.
  - New column payment_receipts.client_request_id with a unique index; the 3-argument function is dropped.
  - A single cash receipt of ₹2,00,000 or more is refused (269ST).
  - The form does receipt, then allocate, and warns when a payer's cash for the day reaches ₹2 lakh.
  - Probe: scripts/payments/probe-manual-receipt.sql (24/0 on staging).

Track A — the rollout is now EIGHT migrations. Rehearse all eight on your prod-shaped PGlite (rehearse-db.mjs and run-probes.mjs), and add probe-manual-receipt.sql to the runner. Report per-file statements and failures, and anything specific to prod's shape: the DROP FUNCTION inside the transaction, grants, and the unique index on a table that already has rows.

Track B — live the month again with the remedies in place. Extend simulate-month.mjs; don't fork it:
- the undo path: the person reverses through payments_reverse_allocation with one of UNDO_REASONS, and the page's undone list is fed to matchCandidates exactly as PaymentsPage does;
- the non-UPI half of the money: accounts records cash, cheque and bank receipts with payments_manual_receipt (with a client_request_id), then allocates them to their bills.
Then report F1 (re-offered after reversal), F3 (misplaced and kept, in ₹), F4 and F5 (open bills at day 30; never paid by UPI) next to your first run's numbers, same seeds. Also model at least one lost response with a retried save.
Say plainly which remedies moved which number, and what got worse or newly broke.

Track C — review the four commits above for defects, money paths first. Places I am least sure of:
- a half-undone parts + labour confirm;
- groupMatches when the cash form's allocate uses a different client_request_id from its receipt;
- an undo of a cash match by a service user;
- the payer-day cash lookup (ilike escaping, IST day bounds, receipts typed on another day);
- receivedAtFor for a past day;
- CashPanel's save id being renewed only after success;
- the advisory lock and replay semantics in migration 8;
- whether any new screen string fails the plain-English wordlist in the red team 4 findings.

Deliverables: docs/backlog/service-payments-premortem-2.md (verdict, before/after table, ranked findings with tags, rehearsal gaps, proved safe, owner questions, resume log) and scripts under scripts/payments/premortem/. Write scope as before: no edits to src/, supabase/ or package files. At the end print the bundle's sha256, its head and commit count, git diff --stat against 0bf648a, your top 5 findings, and what you are unsure of.
```
