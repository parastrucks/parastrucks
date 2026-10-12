# Service Payments — red team 4: end-to-end UI/UX from a layman's seat

**Status: FINDINGS CONSOLIDATED (2026-10-12). First batch of fixes landed (`e49ea7b`); design items
await the owner.**
Raw lane outputs: `docs/backlog/redteam4-lanes/` (L1–L6, X1). Rig: `scripts/payments/redteam4-rig/`.

### Fix status (2026-10-12, PC session)

| Item | Status | Note |
|---|---|---|
| R4-1 desktop bar pill | ✅ `e49ea7b` | measured in the pane at 1024: 560 px, centre = column centre (630 = 630) |
| R4-2 fold marker | ✅ `e49ea7b` | own ▸/▾; Clashes open by default. Not seen on screen (no clash on staging) — CSS contract |
| R4-8 picked card | ◐ `e49ea7b` | 4 px bar + ✓; toast names the customer. **Button naming the customer: owner** |
| R4-10 stale said twice | ✅ `e49ea7b` | one message, who loads; bar "Confirm is off — bills not loaded yet" even after a pick |
| R4-11 after Confirm | ◐ `e49ea7b` | Skip fades; reload skips who-am-I, bills + memory in parallel. Toast position + "Undo" in it: with R4-3 |
| R4-13 same name "similar" | ◐ `e49ea7b` | identical names say "matches". **"Name is different" line: owner (wording)** |
| R4-15 opened block off-screen | ◐ `e49ea7b` | scrolls into view above the bar (measured at 360: all 5 reasons above it). Per-escape explainer lines: owner |
| R4-16 waiting flow | ◐ `e49ea7b` | strip padding fixed. **"Stop waiting" button + grey returned line: owner** |
| R4-17 end screens | ◐ `e49ea7b` | "All matched except 1 waiting…", "could be its own", skipped ≠ waiting. "When did the file come in" on M12a: owner |
| R4-19 denied | ✅ `e49ea7b` | says what is wrong and who fixes it |
| R4-20 search | ◐ `e49ea7b` + batch 2 | returns picked (seen in the pane: tick, 4 px bar, "Confirm ₹30.00 · part-paid"); "10 Oct" dates incl. the picked card; <3 digits = amount only. **Struck: "the big number changes meaning"** — Match cards (`matchCandidates.js:89`) and search (`matchQueue.js:245`) BOTH show what is still due; the rig shot the same bill before and after a part payment. Tap-chips + "due" wording: owner |
| R4-22 contrast | ✅ `e49ea7b` | 6.2–7.3:1 (was 1.84–4.13), measured |
| R4-25 dead scroll | ✅ `e49ea7b` | measured contract in `selftest-mobile-render` |
| R4-26 a11y | ✅ `e49ea7b` + batch 2 | stale banner is a status; the confirm bar is `aria-live=polite` ("Saving…" is announced); the strip no longer wraps a button in a live region |
| R4-27 TypeError | ✅ `e49ea7b` | "No connection. Check the internet and try again." |
| R4-28 blank names | ◐ `e49ea7b` | "No name on the payment / on the bill". "Sister concern", refund direction: with the wordlist |
| R4-4 landscape | ✅ batch 2 | `max-height: 480px` puts Confirm + Skip side by side: bar 73 px (was 123), 184 px between the bars at 667×375 (was 134) — measured in the pane |
| R4-7 phone head | ✅ batch 2 | crumb + repeated sub-title hidden < 760 px, title 20 px: head 30 px tall (was 117) — measured at 360 |
| R4-18 tie-out | ◐ batch 2 | "18 owed by customers, ₹…" labels the rupees; tie-out box has a Total line and says overlapping days are included; done screen shows rupees (only when the server matched the preview); the duplicate-file message gives the stored time instead of "most likely". Lists behind counts, naming the odd row: owner |
| R4-23 keyboard | ✅ batch 2 | Confirm is next in Tab/reading order after the bills (bar is fixed, nothing moves on screen); Enter on the picked card focuses Confirm — seen in the pane |
| R4-30 "billed yesterday" | ✅ batch 2 | "Billed the day before the payment" / "N days after the payment" |
| R4-3 undo, R4-5 date + plate on cards, R4-6 part-pay remainder, R4-9 not-service confirm, R4-12 "2 bills" breakdown, R4-14 nav, R4-21 wordlist, R4-24 link-blue reasons + the + button, R4-29/31 | ⏭️ owner | design choices — see the chat; R4-3 needs no server work (`reverse_allocation` exists: reason required, maker/accounts pre-export, GM after) |

## Why this round

Rounds 1–3 (`service-payments-plan.md`, `service-payments-redteam3-cleanroom.md`) attacked the
design: money logic, security, workflow, adoption. The screens have since been built and walked
through once in a browser (2026-10-10), which found nine screen defects that seventy green checks
had missed. This round attacks only what a mechanic, a service advisor or an accounts clerk
**sees**, with no training, on the phone they actually carry. Owner's brief: *"approach it from a
layman's perspective — this will mostly be used by mechanics and ground staff."*

Decisions taken before the run (owner, 2026-10-12): static renders in the cloud, no live app
(interaction is out of scope and listed for a later live run) · layman lanes see screenshots and
on-screen text only, one expert lane reads code · all screens in scope, including the entry path
and the Import tab · language: **simpler English, never another language** · output = ranked
findings, no fixes · plan delivered in chat, record kept here.

## Method

**Rig** — `scripts/payments/redteam4-rig/` (`render.mjs`, `shoot.mjs`, `README.md`). Renders 46
states to static HTML inside a replica of the app shell (top bar, bottom nav, sidebar on desktop)
and screenshots each at 360×640, 390×844, 412×915, 667×375 landscape and 1280×800, plus
scroll-step shots at 80% of the viewport height so a reviewer sees what a thumb sees. Also dumps
each state's visible text in reading order. `MatchScreen` and `SearchPanel` are the **real
components**; the page head, tabs, empty states, Import preview/done, nav, Create sheet and
drawer are **hand-copied replicas** (same classes and strings; marked in `index.json`).

**Rig limits, stated:** static markup only — no taps, toasts, timing, focus or scroll feel. The
"selected" states patch the real render's class the way the component would emit it. The Import
screens are replicas because `ImportPanel` keeps its stage in state. Overlays (Create sheet,
drawer) were shot 80 ms into a 200 ms slide animation, so they look clipped — two lane findings
about that were struck. The logo image sometimes failed to paint in scrolled shots (lanes were
told to ignore it). The rig needed its own `node_modules` because the repo's `xlsx` tarball host
is blocked from the cloud container (`npm ci` 403s on `cdn.sheetjs.com`).

**Lanes** — seven agents, each cold-started with `briefs/common.md` + its own brief
(`scripts/payments/redteam4-rig/briefs/`), run in parallel, no cross-talk until consolidation:

| Lane | Persona | Viewport | Sees | Raw findings |
|---|---|---|---|---|
| L1 | Floor mechanic, 10th pass, Gujarati-first, cracked 5.5" phone | 360 | screenshots + text | 14 |
| L2 | Service advisor at the counter, 20 s per payment | 390, landscape | screenshots + text | 15 |
| L3 | Accounts clerk, 52, Excel and Busy, counts paise | desktop + 390 | screenshots + text | 15 |
| L4 | First day, no training, asks what every word means | 412 | screenshots + text | 14 |
| L5 | Plain-English editor for 8th-grade Indian-English readers | text dumps + 390 | text + screenshots | 30 |
| L6 | Supervisor once blamed for a wrong entry: "can I undo?" | 390, 360 | screenshots + text | 12 |
| X1 | Mobile web engineer: measurements only | all five | code + CSS + screenshots | 16 |

116 raw findings. Layman lanes had a banned-word list and a list of owner decisions they may not
re-litigate. Every finding had to cite a state ID and a screenshot. Consolidation: dedupe by
state + symptom → verify each against its screenshot and, where it claims a cause, against the
code → strike anything that re-litigates a frozen decision or that the rig caused → rank.

Severity: **Blocks** (cannot finish, or wrong money action unknowingly) · **Confuses** (stops,
would ask or guess) · **Slows** · **Polish**. Each item says what its fix pushes down the page.

## States rendered

E1a–c entry (home bottom nav · Create sheet · drawer) · E2 page head with tabs · E3 service
view with "Not a service payment" opened · E4 denied · E5 loading · M1/M1s one clear bill ·
M2 part payment · M3 no bill · M4 two equal bills · M5 "2 bills" job · M6 five identical ranked
· M7 four identical unranked · M8 stale banner · M9a/b wait question · M10 waiting view ·
M11 returned payment · M12a–d empty states · M13 not-service reasons · M14a saving · M14b
load error · M15 no name · M16 selected with reasons · M17 long names · M18 partly matched ·
S1–S5 search · I0–I9 import.

---

## Findings — consolidated and ranked

**The one-sentence verdict:** the core loop (big amount → one bill → blue button with the
amount on it → done) reads well to every persona; what fails is everything around it — the
desktop layout is broken, the Import detail a clerk must act on is invisible, a wrong confirm
cannot be seen or undone by the person who made it, and the words assume the reader knows
accounts English.

### A. Blocks

**R4-1 · Desktop: the confirm bar shrinks to a 132 px pill and floats over the list**
State M13, M6, E2 · `M13-desk.png`, `M6-desk.png` · desk · from L3-3, X1-1.
"Nothing to confirm / Skip for now" sits in a 132 px box over "Not a customer payment" and
"Something else", clipping both; on M6 it covers the fourth bill. Cause (verified in CSS): the
`@media (min-width: 721px)` rule sets `left: 50%; right: auto; transform` and `max-width: 560px`
but no `width`, so a fixed element shrink-wraps its label; and 50% of the viewport is not the
centre of the content column once the 236 px sidebar is in play. `selftest-mobile-render` checks
`position: fixed` and `bottom: 0` only. Accounts clears the morning on a PC.
Change: `width: 100%` under the max-width, and centre on the content column at ≥760 px; add a
self-test that the bar is ≥320 px wide at 1280. Pushes down: nothing.

**R4-2 · Import: the fold headings have no marker, so the only line a clerk must act on is invisible**
State I5, I3 · `I5-desk.png`, `I3-desk.png`, `I5-390-s1.png` · all · from L3-1, L3-2, L6-3, L5-24, L5-25, X1-7.
"Clashes (1)", "Changed since last import (1)", "Failed attempts — not money (1)" render as bold
lines with blank space under them, on phone and desktop. The clash text — *"MPI…0501 — cancelled
in SAP, but ₹1,930.00 is matched to it. Reverse that match first, then import again"* — and the
amount change *"₹745 → ₹845"* are inside a closed `<details>`. Cause (verified): `.pay-import-fold
summary { display: flex }` replaces the `list-item` display that draws the browser's ▸. Three
personas read it as broken and would not press Import with a ₹100 change and no bill number
showing. Change: restore a marker (`summary::before "▸"/"▾"`), and open "Clashes" by default.
Pushes down: the Import button, by one 13 px line per clash.

**R4-3 · There is no screen where a match can be seen again or reversed**
State M1s, M14a, I5, M12a · `M1s-390.png`, `I5-desk.png` · all · from L6-1, L3-7, L6-3, L1-11, L3-10.
After Confirm the payment leaves and no screen lists what was matched today; the clash text tells
the clerk to "reverse that match first" and nothing in the UI reverses (verified: no reverse/undo
in `pages/` or `components/`; the RPC `payments_reverse_allocation` exists and the plan gives the
maker and accounts the right). The careful persona's exact words: *"until that exists I would
press Skip on anything I was not 100% sure of, and the pile would never shrink."* Change: a
"Matched today (3)" fold or link on the Match tab listing payment → bill with an Undo per row
(pre-export only, per the plan), and the clash line linking to it. Pushes down: a fold adds one
line under "N left to match"; nothing else until opened.

**R4-4 · Phone sideways: two-thirds of the screen is bars; the payment and a bill never fit together**
State M4, M6, M9a · `M9a-land.png`, `M4-land.png`, `M6-land.png` · land · from L2-1, X1-2.
Opening shot shows the page head and the grey button, no amount, no bill; 56 + 123 + 62 = 241 px
of 375 (64%) is bars, leaving 134 px, which the page head alone fills. "Search all bills" is
three scrolls away. Rated Blocks only when sideways; the advisor says he would turn the phone
upright, which is the honest workaround. Change: a `(max-height: 480px)` rule putting Confirm
and Skip side by side (bar 72 px instead of 123) and the one-line page head from R4-7. Pushes
down: nothing; reclaims ~51 px.

### B. Confuses — money decisions

**R4-5 · Bills with the same amount: nothing on the card tells them apart, and nothing says "this is a guess"**
State M4, M6, M7 · `M4-360.png`, `M6-390.png`, `M7-390.png` · all · from L1-1, L4-4, L6-6, L2-10, L2-11, L1-7.
Two ₹3,400 bills for MEHUL SHAH, neither in his name; five ₹1,930 bills, four identical. The
card shows amount, customer, two codes, and "Same amount as N other bills" in the same calm blue
as "Only bill at this exact amount". No bill date, no truck number — and both exist on the
candidate (`invoice_date`, `vehicle_reg_no` are carried, verified in `matchCandidates.js:90-93`;
`SearchPanel` already shows both). A mechanic knows trucks by plate, not by firm. M7's hint "Pick
by name, or skip" appears when no listed name matches NIRAV PATEL. Change: on every card, the
bill date and the truck number (one line, where the codes are now); when ≥2 bills share the
amount, one amber line above the list: "N bills at this amount. Pick only if you know which;
otherwise Skip"; when no name matches, say so. Pushes down: one line per card (the codes line
becomes date · plate; codes can move into the selected state), one line above the list.

**R4-6 · Part payment: the screen never says what happens to the rest**
State M2, M18 · `M2-390.png`, `M18-390.png` · all · from L2-7, L3-11, L6-2, L5-4, L5-5, L2-3.
"Confirm ₹10,000.00 · part-paid" against a ₹25,000 bill, and ₹15,000 appears nowhere; every
persona asked whether the bill stays open. On M18 the big number is the remainder (₹15,000) with
"left of ₹25,000.00 — the rest is already matched" in small grey; two personas read "left of" as
a position and the advisor cross-checking the bank app expected the bank's figure. (The second
half of L2-3, that a bill whose balance equals the remainder is not offered, is struck: the
matcher uses `total − allocated`, verified.) Change: on the selected card "₹10,000 of ₹25,000 —
₹15,000 stays due, bill stays open"; button "Confirm ₹10,000 · ₹15,000 still due"; on M18 lead
with "₹15,000 still to match" and "₹10,000 of this ₹25,000 payment is already matched". Pushes
down: one line in the selected card; one line in the payment card on M18.

**R4-7 · On the cheapest phone, screen 1 shows one bill cut in half, with its "same amount as…" line under the bar**
State M4, M6, M7, E2 · `M4-360.png`, `M6-360.png` · 360 (worse with tabs) · from L1-2, L2-12, X1-10.
The first card starts at y 383 at every phone width (page head 117 px + margins, measured), the
visible window ends at 455 at 360, so 72 of the card's 105 px show and the blue reason line is
hidden. The mechanic's words: *"I would confirm it without knowing there is a second."* With the
accounts tabs, 10 px of the first card shows. The sub-title "Which bill did each UPI payment
pay?" is repeated 170 px lower by "Which bill is this?". Change: on <760 px collapse the page
head for this page to one line ("Match Payments · 9 left"), ~34 px instead of 145; first card
then starts ~272, one full card plus 70 px of the second at 360, three at 390/412. Pushes down:
nothing moves down; the sub-title leaves the page (it is repeated).

**R4-8 · Confirm names an amount, never the bill; the picked card is marked by a 1 px edge**
State M1s, M16 · `M1s-412.png`, `M16-360-s1.png` · all · from L4-1, X1-4.
First-day persona: *"with a rupee amount on the button it reads like a payment app — I'd put the
phone down."* Expert: the selected card differs by a 1 px blue border, a 2 px ring at 1.25:1 and
a background at 1.07:1 — after scrolling to the button among five ₹1,930 cards the picked one is
off-screen and the button says only "Confirm ₹1,930.00"; the toast names the invoice number, not
the customer. Change: button "Confirm ₹1,930 · DEMO ASHA ENT…" (ellipsis), a ✓ or 3 px left bar
on the picked card, customer name in the toast; one grey line once per session "This only
records which bill was paid. No money moves." Pushes down: nothing (button is fixed; mark is
inline; the hint line is one line above the bar).

**R4-9 · "Not a service payment": for service it only prints a sentence; for accounts one tap acts with no confirm and no note**
State E3, M13 · `E3-390-s1.png`, `M13-390.png` · all · from L1-4, L2-5, L4-6, L3-12, L6-5, L5-20.
Service exec taps it, the button stays, grey text appears 13 px below ("Accounts decides…
queue"); two personas would tap again thinking it missed. Accounts taps a reason and it fires at
once (verified: `onClick={() => { setMenuOpen(false); onNotService(k.value) }}`), the big button
still reads "Nothing to confirm", "Something else" takes no note, no reason called "test /
top-up" although Import flagged the ₹30 as one. Change: service — hide the button or label it
"Only accounts can mark this"; accounts — a tap picks, the bar becomes "Mark ₹30 · Sister
business" and confirms there; a note box for "Something else"; a "Test / top-up (₹50 or less)"
reason. Pushes down: one reason row; the note box only when "Something else" is picked.

**R4-10 · "Bills are out of date": said twice in two vocabularies, the button still invites a pick, and after a pick it reads "Confirm ₹…" while dead**
State M8 · `M8-360.png`, `M8-390.png` · all · from L1-5, L2-2, L5-8, X1-5.
Banner: "Bills are out of date (last imported 11 Oct, 11:59 pm). You can still look, but
confirming is off until today's bills land." Then 400 px lower: "The invoice feed is out of date
— confirm is disabled until fresh bills land." The bar says "Pick a bill above"; once a card is
picked the label becomes "Confirm ₹1,930.00" at 1.84:1 and does nothing (verified in
`MatchScreen.jsx:263-270`). Nobody is told who loads bills. Change: one message, in the box:
"Today's bills are not loaded yet (last loaded 11 Oct, 11:59 pm). You can look; confirming is off
until accounts loads them." Bar label while stale: "Confirm is off — bills not loaded", regardless
of selection. Delete the second message. Pushes down: nothing; lifts the list ~60 px.
*Owner call, not a finding:* the advisor asks to confirm a bill that is already in the list and
dated before the last import; that widens the money rule and was not red-teamed here.

**R4-11 · The moment after Confirm: Skip looks live during "Saving…", the toast lands on Skip, and the next card sits greyed through six sequential fetches**
State M14a · `M14a-360.png`, `M14a-390.png` · all · from L1-8, L6-7, X1-9, X1-11.
During "Saving…" the cards fade but `.pay-skip` keeps its full colour; the mechanic on weak
Wi-Fi *"would press Skip, or press Confirm again."* From code: on success `load({quiet})` runs six
awaited calls in sequence, two of which cannot change between confirms, while the next receipt
is already shown at opacity .55 with "Updating the list…"; the 4 s success toast is positioned
72–116 px from the bottom on phones, exactly over "Skip for now". Change: fade Skip while busy;
show "Saved — ₹2,150 → DEMO JAY BATTERIES · Undo" for a moment (ties to R4-3); cache dept and
entity, refetch receipts + feed + invoices in one `Promise.all`; move the toast above the bar
(`bottom: nav + 123 + 8`) or shorten it. Pushes down: nothing.

**R4-12 · "2 bills": one confirm pays two bills and the card shows neither**
State M5 · `M5-390.png` · all · from L2-4, L6-4, L5-14.
"₹11,650.00 [2 bills] DEMO FLEET CARRIERS Job 5756001234 · 0099000440 — Only bill at this exact
amount". Is ₹11,650 the sum or one of them? Which two? The advisor puts the phone down for the
job card. Change: under the card "Parts ₹6,150 + Labour ₹5,500 = ₹11,650 · both bills close"
with both bill numbers; button "Confirm ₹11,650 · 2 bills". Pushes down: the card grows two
lines; the escape buttons move two lines.

**R4-13 · Payer name ≠ customer name: silence when they differ, "similar" when they are identical**
State M1, M6 · `M1-390.png`, `M6-390.png` · all · from L2-6, L4-5, L2-11, L1-7.
JAYESH PATEL → DEMO JAY BATTERIES says only "Only bill at this exact amount"; the one time the
names are off, the screen says nothing about names, and a first-day user stops. On M6 the payer
DEMO ASHA ENTERPRISE and the bill DEMO ASHA ENTERPRISE read "Payer name is similar" (the
walkthrough shows the same on staging: the rarity-weighted name score falls short of "strong" in
a small demo corpus). Change: always say something about the name — "Name is different: a driver
or owner may pay for a firm" / "Name matches" / "Name is close"; use "matches" when the
normalised names are equal regardless of score. Pushes down: nothing (same line).

### C. Confuses — finding the page and the way out

**R4-14 · Match Payments is not in the service bottom nav and is filed under "CREATE NEW"**
State E1a, E1b, E1c · `E1a-412.png`, `E1b-412.png` · phones · from L4-2, L4-3.
A service user's bar is Home · + · Jobs (verified in `BottomNav.jsx`: service tabs are Home,
Jobs, Profile, and Profile is dropped to keep the + centred). First-day persona's first guess was
Jobs, second the +, where "Match Payments" sits under "CREATE NEW" — *"does tapping it create a
new payment?"* The grey description line there is the clearest sentence in the whole tool. The
drawer does have it, with a ₹ icon, as the third guess. Change: a "Payments" tab with the ₹ icon
in the service and accounts bars (the bar has room: 2 tabs + the +), or a Home tile; rename the
sheet heading to "Quick actions". Pushes down: nothing on the page; the bar gains a tab.

**R4-15 · Four ways out, none explained; the wait question opens off-screen and under the wrong button**
State M1, M3, M9a · `M1-412.png`, `M9a-360.png`, `M9a-360-s1.png` · all · from L4-6, L6-10, L1-6, L1-3, L6-11, X1-15.
"Search all bills / Bill not raised yet / Not a service payment" + "Skip for now". First-day
persona's confidence: 80 / 60 / 40 / 90 %; the difference between Skip and Bill not raised yet
is the one that matters and nothing explains it. Skip never says it is safe until the very last
screen (M12d). Tapping "Bill not raised yet" renders the question *after* all three buttons, i.e.
under "Not a service payment" (verified in JSX order), and at 360 below the bar with no
`scrollIntoView` — the mechanic *"would tap it again"*. Change: a grey line under each escape
("comes back when a matching bill is loaded" / "accounts will handle it" / "you'll see it again
today"); render the question directly under the button that opened it; scroll it into view.
Pushes down: three grey lines under the escapes (room exists at 390/412; one more scroll at 360).

**R4-16 · The waiting flow: no "stop waiting" button, and the waiting strip pushes the payment under the bar at 360**
State M10, M9b, M11 · `M10-360.png`, `M9b-390.png` · all · from L6-8, X1-6, L6-12, L2-14, L5-11, L5-12.
On the waiting view the only way back to today's list is to tap "Still not raised" first — the
button that means the opposite. At 360 the strip "Looking at payments waiting for their bills /
Back to today's list" is `class="pay-match pay-waiting-strip"` with no own rule, so it inherits
the 212 px bottom padding (verified; measured 298 px) and the receipt starts below the bar: no
amount, no name on screen 1. The amber "Was waiting for its bill — a bill imported since could be
it" reads as a warning for the easiest match of the day. Change: `.pay-waiting-strip
{ padding-bottom: 0 }`; a "Stop waiting — back to today's list" button on the waiting view;
returned-payment line in plain grey: "Bill has come in since you waited — check and confirm".
Pushes down: one more escape button on the waiting view; the strip fix lifts the card 212 px.

**R4-17 · End screens: "Everything is matched" when one is waiting, "Nothing left" cannot tell done from not-loaded, "waiting" means two things, and "could be its." is not English**
State M12a–d · `M12a-412.png`, `M12b-412.png`, `M12d-412.png` · all · from L4-7, L4-11, L3-13, L5-13, L1-11.
M12b: tick + "Everything is matched" + "1 payment is waiting… when a newly imported bill could
be its." (verified: `PaymentsPage.jsx:401-402` ends the sentence on `its`). M12a at 9 am before
the file lands says done. M12d calls skipped payments "waiting". Change: "All matched except 1
waiting for a bill"; M12a shows when the last payments file came in and who loads it; "skipped"
for skipped, "waiting" only for waiting-for-its-bill; "could be its own"; and the matched-today
list from R4-3. Pushes down: nothing (screens are empty below).

**R4-18 · Accounts cannot tie out: unlabelled totals, no list behind a count, no rupees on the done screen, "most likely"**
State I1, I3, I6, I7, I9, E2 · `I1-desk.png`, `I3-desk.png`, `I7-desk.png` · desk · from L3-4, L3-5, L3-6, L3-8, L3-9, L3-10.
"20 · 18 to be paid · ₹1,09,876.72" — which count does the rupee figure belong to? The clerk
re-derived 20 − 1 − 1 = 18 and added the four tie-out days by hand (they do equal ₹56,012.67;
the box never says so, nor that already-imported days are included on an overlapping file). Done
screens carry counts and no amounts; I7 names no row. I9 says "most likely" where I2 gives a
time. No way to see the 20 bills or the 9 open payments as a list. Her verdict: *faster for
deciding, slower for tying out; fix these and I stop keeping a parallel sheet.* Change: label
both totals ("₹1,09,876.72 owed, 18 bills · file total ₹1,13,126.72, 20 bills"); a total line and
"tick against the bank statement" title on the tie-out box; rupees on done screens; name the
odd row in I7; time/who/count in I9; a folded "show the bills / show the 9" list. Pushes down:
one line each; lists only when opened.

**R4-19 · "Matching payments is for the service and accounts teams" is a grey footnote that tells a service user nothing**
State E4 · `E4-412.png` · all · from L4-12.
*"I AM service"* — it does not say the account is in another department or who fixes it.
Change: "Your account isn't set up for this page. Ask HR or your manager to add you to the
service team." as the main text. Pushes down: nothing.

**R4-20 · Search: the box starts empty, the big number changes meaning, the found bill comes back unselected with a vague warning, and 2-digit input churns**
State S1, S4, S5 · `S1-390.png`, `S4-390.png`, `S5-390.png` · all · from L2-13, L2-8, L2-9, L6-9, L5-15, L5-16, X1-16.
The screen states the amount and payer, then offers an empty box. In results the big number is
the balance due while on the Match card it is the bill total (bill 418: ₹15,000 here, ₹25,000
there). Back from search the bill is not selected ("Pick a bill above") and the warning "Check
the customer and amount" shows even when both match; the one real oddity (billed four days after
payment) is not stated. Dates read "2026-10-10" here and "10 Oct" everywhere else. Two typed
digits already fire `ilike *19*` across bill numbers (verified in `parseSearch` + 350 ms
debounce), returning 20 wrong bills mid-typing. Change: tap-chips for the amount and the first
name word; "₹25,000 bill · ₹10,000 paid · ₹15,000 due"; return selected; a specific warning
("raised 4 days after the payment — normal for an advance") or "name and amount match"; one date
style; 3 digits before the fragment search. Pushes down: one chip row above results.

### D. Slows

**R4-21 · The words assume accounts English** — from L5 (30 findings), L1-14, L4-8, L4-9.
"raised", "imported/import" on the service side (eight states; service never sees the Import
tab), "payer", "exact", "queue", "land", "feed", "invoice", "part-paid", "left of", "clash",
"stored", "left as it is", "whose answer was lost", "the current picture", "top-up", "HDFC QR",
"·" and "—" read aloud, "2026-10-10", ".00" on whole rupees, two unlabelled codes
("MPI5756260000431 · 0099000431") with no word saying which is "the bill number" the search box
asks for. Full string-by-string proposals and the **wordlist** are in
`redteam4-lanes/L5.md` (appendix); the wordlist is reproduced at the end of this file. Pushes
down: nothing — the replacements are the same length or shorter.

**R4-22 · The text that carries meaning is the smallest and lightest** — from X1-3, X1-8, X1-14.
`.pay-candidate-ref` 12 px at 2.81:1 (the only unique identifier on five identical cards; 1.69:1
while disabled); `.pay-confirm:disabled` white on gray-300 = 1.84:1 and it carries "Pick a bill
above", "Saving…", "Nothing to confirm"; `.pay-hint`/`.pay-daystatus` 4.13:1 on the page ground;
escape buttons and reasons 13 px; nav labels 10 px at 2.81:1. Change: ref → 13 px text-secondary;
disabled button gray-600 on gray-100 with a border (6.2:1); hints gray-600; escapes/reasons 14 px.
Pushes down: ~5 px over five cards.

**R4-23 · Keyboard on the PC: Enter on the picked card un-picks it; Confirm is four Tabs away** — from X1-12.
Cards are toggles; tab order runs card → card → three escapes → (Confirm skipped while disabled)
→ Skip. Change: Enter on a selected card moves focus to Confirm; DOM-order the bar before the
escapes with CSS `order`. Pushes down: nothing.

**R4-24 · Blue reason line looks like a link; the + beside Confirm is the same blue and unexplained** — from L1-12, L4-10, L1-9, L3-15.
Two personas would tap "Only bill at this exact amount" first; the mechanic fears the round +
*"makes a new money entry."* Change: reason line in grey or as a chip; hide the + on this page or
label it. Pushes down: nothing.

### E. Polish

**R4-25** · 105 px of dead scroll under the last button (`.pay-match` padding 212 + `.app-main` 78 against a 123 px bar) — X1-15.
**R4-26** · Stale banner is `role=alert` and fires on every receipt remount every morning of the 1st–5th; "Saving…" is announced by nothing; the waiting strip is a live region wrapping a button — X1-13.
**R4-27** · "TypeError: Failed to fetch" shown to a mechanic — L4-13, L5-21.
**R4-28** · "No name given" vs "Unnamed customer" for the same blank; "Sister business" (say "sister concern"); "Refund coming back" (which way?) — L5-17, L5-30.
**R4-29** · A 62-character payer name takes three lines at 360 and pushes the bill's name under the bar; nothing clips — L1-13, X1 overflow check.
**R4-30** · "Billed yesterday" — from today or from the payment? Use the date — L2-15.
**R4-31** · I0 does not say the file is recognised from its columns; I2 "This file cannot be imported.This exact…" has no space after the full stop (replica text — confirm in the real render) — L3-14, L5-26.

### Struck (rig-caused or re-measured)

- L4-14 drawer clipped at the left / L4-3 "row sliced": the rig shot overlays 80 ms into a 200 ms
  slide-in. Check the resting position on a device; not a finding.
- L2-3 second half (a bill whose balance equals the remainder is not offered): the matcher scores
  on `total − allocated` (`matchCandidates.js:150-154`); M18's "no bill" was the rig's fixture.
- Logo as alt text in scrolled shots: screenshot artifact.

### Raised, out of scope (frozen decisions, or wider than the screen)

- Confirm a bill already in the list while the feed is stale (L2-2): changes the staleness money
  rule; owner's call, not a UI finding.
- "Send to accounts" tagging from the service view (L2-5): a new write path and a new state;
  listed here so it is not re-raised, decision owner's.
- Skip with a one-line note (L2-10): a new field; useful, not red-teamed.
- Nothing re-litigated auto-matching, English, next-day rhythm, the QR-as-ranking rule, the
  waiting flow's existence, or Import being accounts-only.

## What works (every lane agreed)

The big amount and name at the top are read in one glance and are the right thing. The grey
"Pick a bill above" that only turns blue with the amount on it ("Confirm ₹10,000.00 · part-paid")
means nobody confirms by accident — every persona called it the one thing that felt safe. "Which
bill is this?", "Skip for now", "9 left to match", "Same amount as 4 other bills", "Billed the
same day" need no explaining. The "Wait for its bill?" question is the one place the tool states a
consequence before the tap — do that everywhere. I2 (same file twice) is exactly right. The
confirm bar really does clear the phone nav, every tap target measures ≥44 px, and the `key` on
MatchScreen genuinely prevents a selection surviving into the next receipt.

## Needs a live run (not judgeable from stills)

- What follows "Saving…": does a "Saved" line appear, how long "Updating the list…" lasts on a
  workshop connection, whether people tap the greyed next card, whether Skip during saving does
  anything.
- Whether the toast lands on "Skip for now" and anyone taps through it.
- Whether tapping "Bill not raised yet" / "Not a service payment" below the bar scrolls the
  opened block into view or opens it off-screen.
- Whether a tap on a reason row in M13 acts at once (code says yes) and what the person sees.
- Whether a part-pay confirm remounts the same receipt as "left of" and how long that takes.
- Whether the found-by-search bill really comes back unselected (markup says yes).
- Whether the M8 banner clears by itself when accounts imports, or needs a reload.
- Whether "Skip for now" changes "9 left to match", and where skipped payments reappear in the
  same sitting.
- Create sheet and drawer resting positions (the rig caught them mid-animation).
- Whether `.pay-candidate:hover` sticks after a tap on Android and reads as "selected".
- The 350 ms debounce feel; `enterKeyHint="search"` has no submit handler, so the Search key
  only hides the keyboard.
- The selected-card edge in bright sun on a cracked screen.
- The role checks still pending from 2026-10-10 (`svc.exec@`: no Import tab; `pt.mgr@`: no page).

## Wordlist (from L5; align every screen to it)

| Term | Use it for | Do not use |
|---|---|---|
| payment | money that came by QR/UPI (one row in the bank file) | receipt, transaction, credit |
| bill | what the workshop charged the customer (SAP invoice) | invoice, document, feed |
| bill number | the 10-digit number, e.g. 0099000412 | the long MPI/PCR/LCS code (call it "SAP code" if shown) |
| job | one job card that has 2 bills (parts + labour) | — |
| match / matched | tie a payment to a bill | allocate, settle, link |
| confirm | the button that saves your match | OK, submit, apply |
| part of | "₹10,000 as part of ₹25,000" | part-paid, partial, left of |
| still to match | money from a payment not yet tied to a bill | left, remaining, balance |
| unpaid bill | a bill the customer has not fully paid | open bill, outstanding |
| skip / skipped | leave this payment for later today; it stays in the list | defer, park, waiting |
| bill not made yet | the customer paid before the bill was made in SAP | not raised, pending invoice |
| waiting / waiting for its bill | a payment that left today's list until a new bill of its amount is loaded | queued, on hold |
| comes back | a waiting payment returning to the list | returns by itself, re-appears |
| load / loaded | putting a bill or payment file into the tool (the tab may stay "Import") | import, upload, ingest, feed, land, store |
| today's bills | the latest Billing Report loaded | fresh bills, invoice feed |
| out of date | today's bills are not loaded yet, so confirm is off | stale, disabled |
| name | the name on the payment or the bill | payer |
| name matches / name is close | the two names are the same / nearly the same | similar, fuzzy |
| not a service payment | money that is not for a workshop bill (accounts decides) | unrelated, non-service |
| failed payment | a QR scan that did not send money | failed attempt, not money |
| does not agree | a bill in the file that disagrees with the saved one | clash, conflict |
| changed | a saved bill whose amount changed in the new file | amended, updated |
| QR / UPI / SAP / HDFC / .xlsx | keep; SAP, HDFC and .xlsx only on the Import tab | — |

## Resume log

- 2026-10-12 — Plan agreed in chat (seven questions answered by the owner). Local branch
  `redteam4` cut from `origin/claude/payments-reconciliation-tool-6eaab4` (`12450a3`). GitHub
  refused pushes from this session (403, app access); all commits are local until the owner
  reconnects.
- 2026-10-12 — Rig built and verified by eye; 46 states, 393 screenshots in the session
  scratchpad (not committed). Scroll steps needed a 300 ms settle.
- 2026-10-12 — Seven lanes run in parallel (116 raw findings), raw outputs committed to
  `docs/backlog/redteam4-lanes/`. Consolidated into the 31 items above; four lane claims
  verified against code (confirm-bar CSS, fold summary display, reverse UI absence, matcher
  amount basis), three struck. **Next:** owner ranks which of R4-1…R4-31 to build; a local
  session runs the "needs a live run" list on a device; builder session applies fixes on the
  payments branch, each fix stating what it pushes down the page.
