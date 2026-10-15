# Service Payments — pre-mortem 2 (the cloud's final report, as relayed)

**Status (2026-10-15, PC):** the cloud ran Brief 4 (`docs/backlog/cloud-session-briefs.md`) and
delivered branch `premortem-2` as a git bundle — sha256
`66147c51fadc8c1d5e8ed90fac4910a0c0e5d61f97ccad734729c3c17762ecd6`, head `7fc5750`, 3 commits on
`ee57624`. **The bundle never reached the PC:** the file downloaded was pre-mortem 1's bundle again
(`c75e141d…`, head `4553305`), and the owner's cloud allowance ended with that session, so it could
not be re-sent. `premortem-2` is not on GitHub (the cloud's push is refused).

**So the full findings document (`service-payments-premortem-2.md`, with the owner questions Q1–Q5)
and the extended simulation scripts are NOT in the repo.** What survives is the cloud's final chat
reply, kept below word for word. If the bundle is ever found (the attachment on the cloud's LAST
message), verify it against the sha256 above and merge it as pre-mortem 1 was.

---

## The cloud's final report (verbatim)

Pre-mortem 2 is complete and delivered as a bundle. The push was refused (403) as expected.

The weakest part first. The remedies fixed what they targeted and made the money picture worse in total. ₹ sitting on wrong bills at day 30 roughly doubled in both seeds, and all of the increase is cash. The cause is structural, not the clerk: the cash form takes one bill. [Certain for the mechanism; the count is persona-dependent]

Bundle. sha256 `66147c51fadc8c1d5e8ed90fac4910a0c0e5d61f97ccad734729c3c17762ecd6`, head `7fc5750`, 3 commits on base `ee57624` (two past `0bf648a`, so the clash-undo commit is reviewed too). [Certain]

Diff against `0bf648a`: 16 files, 1,246 insertions, 64 deletions, of which this session's own change is 8 files, 999 insertions, 50 deletions (the rest is the PC's `40e2f3f`). No edits to `src/`, `supabase/` or package files from here. [Certain]

Top five findings

1. G1 [Reproduced]+[Read in code] Wrong money. The cash form picks one bill (`CashPanel.jsx:145`), so a parts and labour pair paid by one cheque leaves a remainder 115 times a month. Those, plus receipts keyed without a bill, go through the amount matcher in accounts' Match tab and are misplaced like UPI: 17 and 25 cash confirms on the wrong bill, kept ₹ at day 30 up from ₹28,295 to ₹51,860 and ₹34,758 to ₹78,707. [Certain]
2. G2 [Reproduced] Wrong money. After "Undo this match" on a cancelled bill, the freed payment has no verb. It sits open and unmatched to day 30 in both seeds, skipped every morning. The clash moved from Import to Match. [Certain]
3. G3 [Reproduced]+[Read in code] Hides a problem. A ₹2,10,000 cash payment is refused by the form and the server, so cash already in the drawer never enters the books and the tie-out. The bill stays open all month. [Certain]
4. G6 [Reproduced] Hides a problem. Open bills fall from about 1,770 to about 1,275 and stop. The floor is the go-live backlog, about 1,100 bills paid before the portal existed. Nothing closes them; `openingBalanceAsOf` is parsed but never passed. [Certain]
5. G4 [Reproduced]+[Read in code] Hides a problem. Migration 8's replay compares amount and mode only. A save repeated after a lost answer with a corrected name or day silently returns the first receipt, and the done screen prints the form's values, not the server's. [Certain]

Proved safe. Eight migrations 230/230 on the prod shape, migration 8 also on a populated table and applied twice. Probes 26/41/30/57/24, residue 0, receipt counter 0. F1 went from 4 and 10 re-offers to 0. Undo by mistake re-offered and re-confirmed 11 of 11. F2 clashes 9 to 0, cancellation lands the same morning. 27 retried saves and 20 retried matches, 0 duplicates. Ledger 0 double, 0 lost, 0 drift, totals tie on all days. Repo self-tests green at the tip. [Certain]

Unsure.

* Before/after columns are fair to each other (same world, same UPI dice), but not comparable to pre-mortem 1's published numbers; that world had no cash payments. [Certain]
* The Match-tab persona has no paper in hand. A real clerk matching her own cheque remainder would search the job number, so G1's count is high; its path is not. [Likely]
* The advisory lock in migration 8 and the PostgREST `ilike` escaping were read, not run. PGlite has one connection and no PostgREST. [Certain]
* The half-undone pair and the "Bill not raised yet" undo reason never occurred in the simulated months. Both are covered statically only. [Certain]
* Three scoring bugs of my own surfaced and were fixed before the final runs; they are in the resume log. The first table I produced was wrong on "undo not in list". [Certain]

The owner questions, with leans, are Q1 to Q5 in `docs/backlog/service-payments-premortem-2.md`. The CLAUDE.md state bullet and the PORTAL_HISTORY entry are in the same commit.

---

## Checked on the PC against our code (2026-10-15)

- **G1 holds:** the cash form places on one picked bill (`CashPanel.jsx:93`, `cashTargets(bill, …)`).
- **G4 holds:** the replay compares `amount_paise` and `mode` only
  (`20261013_payments_manual_receipt_safe.sql:88`); the done screen prints the form's `row`, not
  the server's answer (`CashPanel.jsx:106`).
- **G6 holds:** `parseBillingReport` supports `openingBalanceAsOf`
  (`parseBillingReport.js:61-67,183`); `ImportPanel` never passes it.
- **G2, G3:** behaviour, not a code defect — they need owner decisions (G3 challenges the owner's
  2026-10-13 "server refuses one cash receipt ≥ ₹2 lakh").
- **Proved safe** above is the cloud's claim; the PC has not re-run it.

---

## Owner decisions (2026-10-15, PC session) — do not re-ask

The cloud's own Q1–Q5 were in the lost document; these were put to the owner from its findings,
each with a lean and the counter-case.

- **G3 → record ₹2 lakh+ cash, flagged for the GM.** Supersedes the 2026-10-13 "server refuses".
  The form states the 269ST rule and offers "Record anyway" with a reason; the receipt is marked
  as a 269ST case (shown to the GM). Books must match the drawer: refusing to record does not undo
  receiving. The per-payer-day warning stays.
- **G1 → the cash form offers the whole order.** A picked bill with an open partner on the same
  job is offered as one choice ("the whole order, 2 bills"), as Search does on Match, with the same
  split rule as Confirm.
- **G2 → leave the freed payment in the Match list.** No automatic "Bill not raised yet" after a
  cancelled-bill undo.
- **G6 → leave old bills open.** No go-live date on the first import.
- **G4 → fixed as a defect (no question):** a repeated save must agree on every field the clerk
  typed, and the done screen shows what the server saved.
