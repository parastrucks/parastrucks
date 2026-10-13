# Cloud answer to Briefs 1 + 3 (2026-10-13)

Pasted back by the owner. It came from the **pre-mortem session**, not the red-team-4 session —
Brief 1 never reached that one; this session read Brief 1's text from
`docs/backlog/cloud-session-briefs.md` and answered both. Read at `81bca72`.

**Verified on the PC before use (2026-10-13), all hold:** `confident` is never read by the screen
(`MatchScreen.jsx:46` default only) · `payments_manual_receipt` takes no `client_request_id`
(`20260908_payments_a1_rpcs.sql:752-756`; Brief 3 had said every write carries one — wrong) ·
the ₹2 lakh / Sec 269ST block is in the plan (`service-payments-plan.md:397`) and nowhere in
`supabase/` or `src/` · the import hash gate blocks re-importing the same file
(`importPlan.js:221-223`) · service staff have no tab row (`PaymentsPage.jsx:317`) · the "only"
label carried over to the next bill — **seen on staging** after the MEHUL SHAH undo; fixed in
`2243129` ("Only other bill at this amount in 3 days"), along with the unranked-list sentence.

---

Two corrections before anything else. I am the pre-mortem session, not the red team 4 session, so Brief 1 never reached me. I found its text in `docs/backlog/cloud-session-briefs.md` on the branch and answer both below. And the brief's statement that "every write carries a client_request_id for safe retry" is false for the one verb Q5 (3) depends on: `payments_manual_receipt` has no idempotency key at all. That changes the cash design (part 3).
Everything below was read at `81bca72` (two commits past `1b9fc87`). No commits, no pushes.

## Critique of what is built (1b9fc87)

The "confident off for good" switch is almost inert. [Read in code] `MatchScreen.jsx:84` destructures only `candidates` and `refuse_to_rank`; `confident` appears nowhere else in the screen except the default prop at line 46. Nothing renders it and nothing disables a button on it. Its only route to the screen is `hasStrong` (`matchCandidates.js:314-316`), which lifts `refuse_to_rank` when the top two are within 5 points (lines 317-318). A card with `amount_unique` scores 90 against 55 for the next same-amount card, so that tie is rare. The F1 loop was broken by the exclusion, not by this. The commit message presents it as a second safeguard; it is a no-op with a comment. Keep it, but do not count it as protection.

A side effect worth knowing. For HDFC there is no note field, so `reg_full` and `reg_last4` never fire, and `payer_memory` is never written (no INSERT anywhere under `supabase/`, F8 holds at this commit). So on prod `hasStrong` is `amount_unique` or nothing. After the first undo on a payment, every near-tie for it is shown unranked. That is probably right. It is also a behaviour nobody designed. [Read in code] + [Inferred]

Leave out versus demote: leaving out is right, with one hole. The F1 mechanism is a person re-trusting a label. A demoted card still shows the same amount and the same name, and its warning would be the third line in 13 px blue, which R4-24 found reads as a link. The demoted path already exists as Search, and the search pick says when and why it was taken off (`matchQueue.js:201-212`). Hiding the order card when any member was undone (`matchCandidates.js:187, 209`) is correct; the order card would otherwise re-offer the pair.

The hole: exclusion is keyed on `reversed_at IS NOT NULL` alone (`paymentsData.js:84-89`). An undo made by mistake, or an undo made to re-split a part payment, bans the right bill from the shortlist for ever. Search is the only way back, and the search pick then warns the person off the bill that is correct. Fix without a database change: the undo reasons are canned (below), and the page drops from `undone` any row whose reason is one of two re-offer reasons. A typed "other" reason excludes, the safe side.

The "only" label migrates. `matchCandidates.js:242-249` counts same-amount bills in the window excluding the ruled-out one. If a second same-amount bill is in the window, it is now labelled "Only bill at this exact amount" the next morning, in the same words that were wrong yesterday. The hint at line 326 says a bill was left out, but the card wording is unchanged. Suggested card text when `hidden > 0`: "Only other bill at this amount in 3 days". [Read in code]; the migration itself is [Inferred], not reproduced.

Smaller points. When the list is unranked, line 325 wins over 326, so the "not offered again" fact goes unsaid. The extra read (`PaymentsPage.jsx:96-100`) runs inside the same `Promise.all` as bills and memory, so it adds no latency. The waiting split uses `undone` too (lines 131-137), so a waiting payment does not bounce back for the banned bill. Both fine.

## The screens (Brief 3, parts 1 to 4)

**1. The undo list: a fold at the bottom of the Match screen, not a tab, not the toast.**

Why not the others. Service users have no tabs (`PaymentsPage.jsx:317`), and a segmented row costs 44 px plus 12 px margin above the first card at 360 px, which R4-7 just spent 87 px to win back. The toast API is `(type, message, duration)` only (`ToastContext.jsx:29-41`), so an Undo there means changing a portal-wide component, and R4-11 measured that toast sitting over Skip for 4 seconds. A money verb does not belong in a thing that vanishes. The Import clash row is accounts-only; service staff never see Import.

Where it sits. A `<details>` in the `.pay-import-fold` style, after the ways out, on the Match screen and open by default on every end screen ("Nothing left to match", "N skipped", "All matched except…"). Cost on the default view: one 13 px summary line, about 28 px with margin, below the escape buttons. Nothing above it moves. [Inferred from `index.css:3618-3634` and `.pay-hint` line height]

Strings.
- Summary closed: `Matched today: 3 ▸`
- Row: `₹3,400 → MEHUL SHAH · MPI…1448 · 9:41 am` and on the next line `by Ramesh` when the maker is not the viewer. Button: `Undo`.
- Parts plus labour: one row, `₹11,650 → DEMO FLEET CARRIERS · 2 bills`. One Undo reverses both allocation rows. Group by `client_request_id`; one confirm writes one id onto every row it creates (`payments_allocate`, rpcs.sql line 420 region, schema line 348). Two Edge Function calls in sequence. If the second fails the row reads `Half undone — tap Undo again`; a retry on the already-reversed row returns "already reversed" (`rpcs.sql:494-498`, predicate `reversed_at IS NULL`), which the page treats as done.
- When Undo is not theirs: grey text instead of the button, `Only Ramesh or accounts can undo this`, from `reverseAllowed` (`authority.ts:93-105`), imported into `matchQueue.js` the way `ROLE_GATES` already is (lines 15-17), so the page never offers a button the server refuses.
- Beyond today: a last line `Show the last 7 days`. Everything is pre-export today, so all of it is undoable by the maker or accounts.

Who sees whose. RLS lets anyone in service or accounts read every allocation in the entity, maker included (`schema.sql:735-739`). Default the list to "mine" for service staff and "everyone's" for accounts and GMs. That is a screen choice, not a security boundary, and the owner should know a mechanic can be shown the whole day's matches if asked.

Reason in one tap. A `.pay-reasons` list like `NOT_SERVICE_KINDS` (`signalLabels.js:135-141`), five rows:
- `Wrong bill — same amount`
- `Wrong customer`
- `Bill not raised yet — it was an advance`
- `Bill cancelled in SAP` (accounts)
- `Undo by mistake — offer it again`

and `Match again with a different amount`. The last two are the re-offer reasons that do not ban the bill. After "Bill not raised yet" the page should offer the waiting verb straight away; today the person would have to find the payment again at the front of the queue.

**2. The F2 clash row: yes, give it Undo, with the reason preset.** The clash text already names the bill and the stuck amount (`importPlan.js:144`) but has no allocation id; the row needs one read of active allocations for that invoice, which accounts may do. One 44 px button inside the Clashes fold, which R4-2 opened by default: `Undo this match`, reason preset to `Bill cancelled in SAP`. The catch, which the brief did not mention: after the undo, the same morning's file cannot be imported again, because `importGates` blocks a hash already committed (`importPlan.js:221-224`, `ImportPanel.jsx:56`). The cancellation lands with tomorrow's month-to-date file. Say so on the row: `Undone. Tomorrow's Billing Report will cancel the bill.` Do not weaken the hash gate for this; it is the re-sent-file protection the pre-mortem proved.

**3. Cash and cheque: one form that makes two calls, built on top of (a).** The receipt call first; then the normal allocate. The half-done state is nothing special: a cash receipt with no bill is simply a receipt in accounts' own queue, because `load()` keeps every receipt whose mode the viewer may match (`PaymentsPage.jsx:93`, `allocateModeAllowed` `authority.ts:81-82`). So if the second call fails the form says `Saved as receipt R-0042. It is in your Match list — place it on the bill there.` No new state machine.

The real problem is the first call. `payments_manual_receipt(p_entity_id, p_row, p_actor)` (`rpcs.sql:752-756`) takes no `client_request_id`, inserts unconditionally (lines 785-799), and burns a gap-free serial each time. A retry after a lost response creates a second cash receipt. So the form must never auto-retry that call. Two ways out, the owner picks:
- (i) a client-side guard: on a lost response, re-read `payment_receipts` for the same amount, mode and `entered_by` in the last two minutes before asking the user whether to send again; or
- (ii) add `p_client_request_id` to the RPC with the same replay-return pattern `payments_allocate` uses (`rpcs.sql:346-357`). This is a database change, which contradicts "no database work for any of the three" in the owner's Q5 record. I lean (ii); (i) is a guess about timing dressed as a check.

Fields: payment type (Cash / Cheque / Bank transfer, mapping to `cash`, `cheque`, `netbanking`; the CHECK at `schema.sql:241`), amount, received on (date, today by default), payer name, cheque number or bank reference (`instrument_ref`), outlet (from `fetchOutlets`), note. Then "Which bill?" reusing `SearchPanel` with the amount prefilled, optional. Never offer UPI here: a hand-keyed UPI without the RRN is exactly the double count the import rules fixed, and that also makes the stale BharatPe/Google Pay message at `rpcs.sql:781` unreachable until the RPC is next touched.

Where it lives: a third tab for accounts, `Cash & cheque`, beside Match and Import. Accounts already has the tab row, so service phones pay nothing.

Two things the plan requires that the form would make reachable and the server does not enforce: the ₹2 lakh cash block under Section 269ST is in the plan (`service-payments-plan.md:397-399`) and absent from every RPC and the Edge Function (grep over `supabase/`: no hit). A cheque that bounces is `void_receipt`, which exists accounts-only and has no screen. Neither needs building before go-live; the first needs at least a warning line on the form at ₹2 lakh per payer per day.

**4. Skip, with no new line.** The end screen already carries the sentence (`PaymentsPage.jsx:418-423`); change it to `They come back tomorrow morning. Accounts sees them too.` Zero lines. I would not rename the button to "Skip till tomorrow": a skip is session state (`PaymentsPage.jsx:58, 265-269`) and the payment is back at the end of today's list first. The ₹1 test payment that sat 27 days in the simulation is cleared by R4-9's accounts reason `Test / top-up`, not by Skip.

## Ranking, Brief 1 items, and what both of us missed

Where Brief 1 and Brief 3 collide. R4-3 and Q5 (1) are the same item; the toast Undo from R4-11 is dropped in favour of the fold. R4-5 (date and plate on the card) matters more now than when I would have ranked it in Brief 1: after an undo removes the amount cue, the plate is the only truck signal an HDFC payment has.

Order, by value in the first month. Severity is money first.
1. Undo list with canned reasons and the re-offer exception. Makes F3 catchable and F2 clearable. Builds R4-3.
2. R4-5 date and plate on every card, replacing the two-codes line (codes move into the selected state). Zero added lines. F3's tool-led misplacements were all among same-amount bills.
3. Cash and cheque form, with the idempotency decision taken first. F5.
4. Clash-row Undo. Rides on 1.
5. R4-12 plus R4-6 as one change: the selected card expands with the parts/labour split and the remainder; button `Confirm ₹10,000 · ₹15,000 still due`. One line in the selected card only.
6. R4-14 a Payments tab in the service bottom nav. Adoption; zero page cost.
7. R4-21 wordlist. Zero px. "Bill not raised yet" to "Bill not made yet" carries no product risk; the owner saw it working, staff have not; the string sits in two self-tests and the docs.
8. R4-24 grey reason line. CSS only.
9. R4-9 not-service confirm in the bar, plus the `Test / top-up` reason. Accounts only, low volume.
10. R4-18 lists behind counts. Accounts tie-out comfort.

Not before go-live: Undo in the toast; the demoted-card variant; a void-receipt screen; on-account, TDS, groups; a "show earlier than 7 days" history; R4-29 and R4-31 polish; the `confident` flag doing anything on screen.

Missed by both.
- `payments_manual_receipt` has no idempotency key [Read in code `rpcs.sql:752-799`]. The brief asserts the opposite.
- The ₹2 lakh cash block is in the plan and nowhere in the code [Read in code].
- `confident` is a dead output on the screen [Read in code `MatchScreen.jsx:46, 84`]. The plan's "confident bucket disabled while stale" is enforced by `feedIsStale` on the button, not by this flag.
- An undo bans a bill for ever with no way back except Search [Read in code `paymentsData.js:84-89`].
- After an undo, today's file cannot be re-imported; the fix lands tomorrow [Read in code `importPlan.js:221-224`].
- The undo reason is shown verbatim to the next person (`matchQueue.js:210-211`). Canned reasons close it; a typed one would not.
- One confirm, two allocation rows, two reversals: a half-undone order is a reachable state. Group by `client_request_id`.
- When the Busy export arrives, undo of exported rows becomes GM-only. Leave one word of room on the row (`sent to Busy`) now; build nothing.

Unsure: I have not rendered any of this, so every px figure is from the stylesheet, not a screenshot. The "only label migrates" point is read, not reproduced. Whether a mechanic should be shown colleagues' matches is the owner's call, not mine.

---

## Owner decisions on this answer (2026-10-13, PC session) — do not re-ask

1. **Undo exceptions: yes.** Two canned reasons — `Undo by mistake — offer it again` and
   `Match again with a different amount` — keep the bill on offer; every other reason hides it
   from that payment's list. Reasons are tapped from a fixed list, never typed.
2. **Who sees which matches in the "Matched today" list:** service staff see their own; accounts
   and GMs see everyone's. A screen choice, not a security boundary (RLS already lets service read
   all allocations in the entity).
3. **Cash/cheque duplicates: fix it in the database.** `payments_manual_receipt` gains a
   `p_client_request_id` with the replay-return pattern of `payments_allocate`. This is the
   **8th prod migration**; it replaces the function (drop the 3-arg signature in the same
   migration, or Postgres keeps both as overloads and the EF's named-argument call becomes
   ambiguous). No data touched.
4. **₹2 lakh cash (Sec 269ST):** the SERVER refuses a single cash receipt of ₹2,00,000 or more;
   the form WARNS before saving when the same payer's cash for the day would reach ₹2 lakh (payer
   names are typed by hand, so a hard per-day block could be dodged or wrongly triggered). Goes in
   the same 8th migration.

**Build order (the cloud's ranking, which the PC agrees with):** ✅ undo list — `8838dab`, seen on staging (+ exceptions, + offer
"Bill not raised yet" right after that reason) → ✅ R4-5 date + plate on cards (`7230a53`; SAP code kept beside the name — owner rule) → ✅ cash & cheque tab
(+ migration 8) — `19e49ad`, seen on staging → Import clash-row Undo → R4-12 + R4-6 in the selected card → R4-14 nav tab →
R4-21 wordlist → R4-24 grey reason line → R4-9 not-service confirm + `Test / top-up` → R4-18.
Skip's explanation: reword the existing end-screen sentence, zero lines. **Not before go-live:**
toast Undo, a demoted-card variant, void-receipt screen, on-account / TDS / groups, history older
than 7 days, R4-29 / R4-31 polish, `confident` doing anything on screen.
