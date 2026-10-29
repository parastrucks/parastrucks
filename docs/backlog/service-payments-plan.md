<!--
REPO COPY of the approved planning document (session 2026-08-29).

⭐ 2026-10-29 — ONE TOOL (owner): Service Payments matching and credit release (invoice
sending, release approval, the gate) are ONE tool, "Invoices & Payments". Matching is now its
Match / Import / Cash & cheque tabs (/payments opens the Match tab). Credit release goes live
first; matching joins it with credit-release step 3, where an invoice released on credit is
"paid" ONLY when payments are matched to its bills (no "mark paid"). Branch `cr3-one-tool`
(merges this payments branch). Record: docs/backlog/credit-release-plan.md → "Step 3 — as built".

⚠️ BUILD STATUS 2026-09-08 — THIS PLAN IS NO LONGER AHEAD OF THE CODE.
Phase A1's core is BUILT and PROVED ON STAGING (klpnhpnlotcbbovwswmq): 14 tables,
28 policies, 2 views, 10 SECURITY DEFINER RPCs, probe 24/0 with zero residue; plus
parsers, matcher and the mobile Match screen at 239 offline self-tests.
NOT on prod · Edge Function written but NEVER DEPLOYED OR CALLED · NO ROUTE, so
none of it is reachable in the running app.
Current state lives in CLAUDE.md; the full build record is the 2026-09-08 entry in
docs/history/PORTAL_HISTORY.md.

⭐ READ THE "⭐ CORRECTION" SECTION before trusting this document's matcher signals:
the number a customer types into a payment note is a VEHICLE NUMBER PLATE, not a
bill number (17 of 28 measured). This plan's original claim was wrong.

Companion files:
  · docs/backlog/service-payments-redteam3-cleanroom.md  — the 12-lane clean-room sweep digest
  · scripts/payments/measure-join.cjs                    — UPI × SAP end-to-end match measurement
  · scripts/payments/measure-billing-report.cjs          — Billing Report analysis + join
  · scripts/payments/diag-invoice-series.cjs             — invoice/order series diagnosis
  · scripts/payments/diag-note-numbers.mjs               — what a typed note number actually refers to
  · scripts/payments/measure-matcher.mjs                 — the real matcher over the real files
  · scripts/payments/probe-allocation.sql                — the money truth table, self-aborting
-->

# Service Payments — UPI attribution, customer ledger & reconciliation (v4, final)

> **Part 1** is the plain-language story. **Part 2** is the technical specification.
> v4 absorbs THREE red-team rounds: rounds 1–2 (nine informed lanes: workflow · money logic ·
> security · adoption · premise · fraud/audit · operations · self-consistency · people) and
> **round 3 — a 12-lane CLEAN-ROOM sweep** (independent experts designing blind from the brief,
> diffed against this plan; full digest kept at `scratchpad/redteam3-digest.md`). Plus the SAP
> wrapper exploration and measurements on real July+August data. *(owner)* = owner decisions.
>
> **Round-3 verdict:** the blind designers independently reinvented the plan's core decisions
> (strong validation) and contributed: the **Busy integration path (now solved)**, a cleaner
> ledger document-model, temporal group membership, the daily cash tie-out, GST advance/return
> obligations, session/step-up policy, and a richer pilot playbook — absorbed below. Their
> capture-at-counter, WhatsApp-experiment, and paise-tagging proposals were **rejected by the
> owner** after daily volumes were measured: **~37 payable bills/day vs ~18 UPI receipts/day,
> 76% of same-day bills amount-unique → next-day matching by one person (~15–30 min) is the
> design**, not a real-time workflow.

---

# PART 1 — The plain story

## The problem

When a customer pays a workshop bill by UPI, the money lands as `rajukumar1987@ybl` and an amount —
nothing says which bill it pays. Until someone works that out, it can't go into Busy. Most payments
are UPI, so most of the reconciliation day is this sorting. And both the bills (from SAP) and the
payments are typed into Busy by hand, twice over.

## What the tool does

One portal page with five jobs:

1. **Sort the payments.** The day's UPI credits appear as a list; the tool suggests which bill(s)
   each one likely pays; a person confirms with one click. Money that isn't service income (a
   vehicle booking advance) is set aside with one tap. Nothing is ever matched automatically.
2. **Know who owes what — a proper customer master.** Every customer carries their **SAP customer
   code**, so two customers with the same name are never confused. **You or the GM** create
   customer groups and set their **credit limits** — e.g. Ramesh, Pankaj and Kamal Sharma all sit
   under *Avenue Roadways*, one balance, one limit. The tool proposes likely groupings (it spots
   the shared trucks and GSTINs, since the firm's name won't resemble the individuals'), and you
   confirm. Crossing a limit shows red.
3. **Handle the awkward cases honestly.** Companies that deduct TDS get a "TDS" closure (capped at
   5% of the bill — real TDS is 1–2%, so bigger gaps need GM). A customer who pays ₹5,900 against
   ₹5,913 keeps the ₹13 on their account for next time. Nothing is quietly written off.
4. **Prepare Busy's day.** Accounts reviews the matches (can return a doubtful one with a canned
   reason — "amount differs", "need job card no."), then downloads one file for Busy.
5. **Keep an honest diary — with a reader.** Every action is recorded; fixes are reversals, never
   erasures. Cash/cheque receipts get an automatic **serial number** (a skipped number leaves a
   gap), and a **one-page weekly summary of unusual actions** (deleted receipts, changed matches,
   TDS closures) goes to you/GM — ten minutes a week that makes the diary worth keeping.
   Customer SMS/WhatsApp confirmations come later, once messaging is integrated *(owner)*.

## What the real data already told us ✅

August UPI payments were joined against August SAP invoices — both real, both on disk:

- **Amount alone is not enough.** Only **13 in 100** payments match exactly one bill by amount;
  another 28 match several. So the tool's job is to *narrow it to a short list fast*, and a person
  picks — not to guess for you.
- **The right invoice list has been found.** The **Billing Report** you supplied is a far better
  input than the two reports the nightly automation pulls: one row per bill, counter sales
  included, and a cancellation flag. Using it, payments that match *nothing* dropped from **6 in 10
  to 1 in 4**. Making that report a regular export is now the top job.
- **The remaining difficulty is identical amounts, not missing data.** ₹1,930 (DEF) appears on
  **114 bills in one month** — on the worst day, **17 identical ₹1,930 bills**. The customer's name
  on the payment already resolves many of these.
- **SAP gives a date but no time, and that is final.** So the tool cannot separate 17 identical
  ₹1,930 bills on one day by itself. What *can* separate them is the person who took the payment —
  which is exactly why the next point matters.
- **⭐ This is a phone tool.** Most matching will be done by staff on their mobile phones, so the
  matching screen is designed for a thumb first: one payment at a time, big amount, a short list
  of likely bills, one tap to confirm. A desktop view exists for accounts to clear the tail, but
  the phone comes first — the opposite of every other tool in the portal.
- **A quarter of workshop orders bill as two separate invoices** (parts and labour). The tool shows
  them as one total, which is what the customer actually pays — confirmed, not assumed.
- **Two mistakes were caught before a line was written.** The draft's rule for excluding Ashok
  Leyland warranty bills would have discarded **9 out of 10 genuine customer bills**. And the plan
  to group customers automatically by shared vehicles measured **zero** — no truck is billed to two
  customers — so grouping stays a human decision with the tool only offering hints.

- **The daily volumes settle the working rhythm.** ~37 bills and ~18 UPI payments a day, with 76%
  of bills amount-unique within their own day: matching is a **15–30 minute next-morning session
  for one person**, not a live all-day workflow. At-the-counter capture ideas and paise-tagging
  were considered and dropped for exactly this reason *(owner)*.
- **The Busy route is known.** Busy's own "Import Vouchers From Excel" (Standard/Enterprise
  editions) is the path — one screenshot of the accountant's Utilities menu confirms the edition,
  and the pilot rehearses imports on a **copy of the Busy company**, never the live books. The
  export carries receipts AND the journal entries for TDS/corrections in Busy's own voucher shapes.
- **A daily cash check** *(owner: yes)*: the tool's cash total against the bank deposit slip, one
  line, signed by the GM in-app daily; cash unbanked beyond a day flags red.
- **Customer groups double as the contact book** *(owner)*: each group carries the customer's
  common email(s) and WhatsApp number(s), ready for the planned bills-and-ledgers-to-customer
  channel.

Still to do before building: schedule the Billing Report as a regular export, confirm the Busy
edition + collect its sample import format (five ready-made questions for the accountant), ask
accounts how parts returns should behave, and a two-week dry run of the daily routine.

## Who does what

| Person | Their part |
|---|---|
| **Owner** | Uploads UPI exports **during the pilot**, then formally hands the logins to accounts *(owner)*. Sets credit limits. Reads the weekly summary. |
| **Accounts** | Primary user: matches, triages, curates groups, enters cash/cheque receipts, reviews and exports, runs the **monthly Busy comparison** *(owner: yes, monthly)*. |
| **Service** | Matches UPI **on their phones**, ideally while the customer is still at the counter — and gets something back: a per-outlet **"payments pending for my jobs" chase list**, so the tool tells them who to call. |
| **GM** | Outstanding view + the weekly summary. |

## What it deliberately does NOT do

No invoice creation (SAP), no direct writes into Busy (file only), no vendor payments, no
vehicle-sale money, no warranty/AMC bills (billed to Ashok Leyland), no auto-matching, no bank
statements in v1. UPI = **two apps: Google Pay Business and BharatPe** (both real July exports are
in hand and measured — about **21 payments a day, ₹43.7 lakh a month** between them). The owner is
working on consolidating to one provider and later an API feed, and will say when *(owner)*.

## Honest caveats

- The invoice feed comes from the nightly SAP automation, measured at roughly **4 out of 5 nights
  clean**; it runs on a laptop for now, moving to an always-on PC later *(owner)*. The tool treats
  a stale feed as a first-class state: it says so on the matching screen and **switches off
  one-click confirm** until fresh data lands, so stale data can't cause confident wrong matches.
- Until the Busy import format is proven, cash/cheque receipts are keyed twice (portal + Busy).
  This period is bounded: getting the Busy format is a **pre-build task**, not an afterthought.
- Advances (payment before the bill exists) sit visibly as "awaiting invoice" — by design.

## Rollout

- **Phase 0 — unblock** (before building): ✅ measurement done, invoice source settled ·
  **schedule the Billing Report as a regular export, and ask for a billing-time column** ·
  get the Busy import format + customer-ledger export · ask accounts about parts returns ·
  two-week dry run.
- **Phase A1 — the working core:** bills in, receipts in (both UPI apps + manual entry with serial
  numbers), search-and-click matching, customer groups, opening balances from Busy, outstanding
  view, service chase list, backups + feed alerts.
- **Phase A2 — the comfort layer:** ranked suggestions with memory of repeat payers, day-status
  line, credit-limit flags, the weekly summary page.
- **Phase B — the loop closed:** counter sales, the reviewed Busy export + ledger mapping,
  monthly Busy comparison, automatic SAP feed, WhatsApp/mail receipts.
- **Phase C — later:** bank statements, per-outlet UPI, provider APIs, per-invoice QR, PT Haryana.
- **Pilot** (during A1/A2): accounts + one service coordinator at PTB, four weeks, with numbers —
  same-day match rate, suggestion acceptance, days the owner had to touch anything (target: zero
  by week 3), and a private "is it slower than Excel?" check at week 4 as the kill/iterate test.

---

# PART 2 — Technical specification

## Decisions of record

| Question | Decision |
|---|---|
| Raise invoices / write to Busy / vendor payables | No / No (file only) / Out of scope. |
| v1 entities | **PTB only** (plants 5756, 6370); PT later. Entity-generic build. |
| Invoice types | Service (R5+R6) + counter sales (R7). **Warranty & AMC excluded.** Insurance = normal. |
| UPI | One merchant account per entity; **two apps in v1: Google Pay Business + BharatPe** *(owner; real July exports measured — see "Measured UPI reality")* — owner consolidates to one source later, API after that *(owner)*. |
| SAP feed | Manual upload of wrapper exports first; ingest endpoint + wrapper POST in Phase B. Wrapper on laptop now, **PC later** *(owner)* — noted as full-reliance prerequisite. |
| Bank statements | Not in v1; `bank_statement` source reserved. Non-UPI entered manually. |
| Matching | **MOBILE WEB FIRST — most matching is done by staff on phones** *(owner; cornerstone of the exercise, overrides the earlier desktop-first call)*. Accounts clears the tail on desktop. Export = review + bounce-back. |
| Advances | Remain in queue flagged **awaiting-invoice**; matcher re-suggests on invoice import. |
| Short payments | TDS closures only, **capped at 5% of invoice** (no TAN field) *(owner)*; GM override above. **No tolerance write-off** — residues stay on the group ledger (shown in a separate residue bucket so ageing stays meaningful). |
| Fraud controls | **Receipt serial series: yes. Weekly GM digest: yes.** Customer SMS/WhatsApp: **later** (hook designed now) *(owner)*. |
| Uploads | Owner during pilot → **formal handover to accounts after pilot** *(owner)*. |
| Busy drift | **Monthly Busy-vs-portal balance compare** *(owner)*. |
| Grouping / limits / outstanding | Accounts curates, tool suggests · GM/admin-only limits, warn-only · Outstanding = opening + invoices − allocations. Opening balances from Busy. |
| Build shape | **Staged: Phase 0 measurements → A1 → A2 → B → C** *(owner)*. |
| Matching rhythm | **Next-day batch by one person** *(owner, after volume measurement: ~37 bills vs ~18 UPI receipts/day, 76% same-day amount-unique)*. Point-of-payment capture (in-app or WhatsApp) and paise-tagging **rejected**. |
| Cash controls | **Daily cash tie-out vs deposit slip + GM in-app sign** *(owner: yes)*. Receipt-book link / monthly statements: not now (statements ride the later customer-messaging channel). |
| Group contacts | Customer groups carry **common email(s) + WhatsApp number(s)** for the planned bills/ledgers-to-customer channel *(owner)*. |
| TDS (final) | 5% cap, **no TAN** — 26AS reconciliation stays outside the tool *(owner, reconfirmed after compliance warning)*. |

## ⭐ THE INVOICE SOURCE — SAP **Billing Report** (supersedes the R5/R6 route)

The owner supplied `exports/Billing Report - 010826 to 290826.xlsx` (1 Aug–29 Aug, **1,085 rows**,
33 columns). It is a strictly better input than R5+R6 and becomes the primary invoice feed.
Currently a **one-off manual run; to be added to the regular exports** *(owner)*.

**Why it wins:** one row **per invoice** (no line aggregation, no cross-file dedupe) · **counter
sales included** (the block missing from R5/R6) · a **`Cancelled` column** (blank all period, but
the field exists — this closes the "cancellation is undetectable" hole) · customer identity
complete (`Customer Number`, `Customer GSTN`, `Customer PAN`, `Bill to Code/Name`) · `Payment terms`
· `Reg.No` · `Chassis` · `IRN No` · `Split Order Type description` · `Plant`.
It contains **only customer-billable documents** — AL-warranty claims are a separate flow (Report 1),
so the fragile warranty predicate disappears entirely.

**Invoice-number taxonomy — measured, and it corrects a common assumption.**
Char 1 = what is sold · chars 2–3 = terms/class:

| Prefix | Meaning | n | Value | Vehicle |
|---|---|---|---|---|
| **MPI** | **Counter/parts sale — CASH** (`Workshop Cash Sales`) | 316 | ₹13.1L | none |
| **MCI** | **Counter/parts sale — CREDIT** (`Workshop Credit Sales`) | 62 | ₹15.5L | none |
| **PCS / PCR** | **P**arts on a job card — cash / credit | 216 / 111 | ₹58.8L | yes |
| **LCS / LCR** | **L**abour on a job card — cash / credit | 222 / 118 | ₹16.6L | yes |
| **PEI / LEI** | Free-of-cost (`M&HCV FOC Inv.`) — **NOT payable** | 22 / 6 | — | — |
| **MPR** | Parts **returns** (`M&HCV Parts Returns`) | 12 | ₹1.3L | none |

⚠️ **`MPI` is NOT vendor sales.** SAP labels it *"M&HCV Parts Cash Inv"* / split *"Workshop Cash
Sales"*, zero vehicles attached — it is the **cash counter sale**, the largest single block, and it
holds **114 of the ₹1,930 DEF sales**. Both `M*` prefixes are counter sales (MPI cash, MCI credit).
**Payable = MPI · MCI · PCS · PCR · LCS · LCR (1,045). Excluded = PEI/LEI FOC (28).
MPR returns (12) → `credit_note` allocations** — *treatment pending accounts' confirmation
(open item)*; excluded from outstanding until confirmed. Amounts arrive **positive**, so the parser
must not assume a sign.

**⛔ No billing time is available — this is the maximum SAP will provide** *(owner, final)*. All
three date columns are date-only, and that will not change. Consequences, accepted and designed
around:
- Only **46.6%** of counter sales are unique on (amount, date); worst case **17 identical ₹1,930
  invoices on one day**. Time proximity is **not** a usable signal and is removed from the matcher.
- The disambiguators that remain are **payer name** (measured: resolves 46 collisions), the GPay
  note number, `payer_memory` for repeat payers, and — for the residual — **the human who is
  standing there**. This is precisely why the mobile capture flow below matters: a person with the
  phone in hand at the counter knows what no algorithm can recover the next morning.
- Ask only for **a stable transaction/variant** so column names don't drift (R5/R6 discipline).

## The SAP contract — R5/R6 detail (retained for the job-level view and as fallback)

- Nightly 22:00 keystroke automation; **delta pull** by billing date with catch-up windows;
  measured reliability ~80% of runs clean (8/42 "WITH FAILURES") → latency T+1 to T+3.
  **Design consequence: staleness is a first-class state** (see Matching).
- **A service job = TWO invoices**: parts `PCS/PCR` (R5, 67 cols, header row 5) + labour `LCS/LCR`
  (R6, 58 cols, header row 4), grouped by **`job_ref := R5["DBM Order No"] ≡ R6["Job Card No"]`**
  (verified same 10-digit key space against real fixtures). NOT `Dealer Order Number` (that's the
  warranty-series column) and NOT the line-level `Job`.
- Invoice number embeds plant+FY+serial (`PCR5756260000716`) → `UNIQUE (entity_id,
  invoice_number)` safe. Cash/credit from series prefix + `Payment Terms` (verified correlated).
- `Customer Code` (e.g. `0011290297`) is the customer key; GSTIN + PAN present.
- **Warranty/AMC exclusion — MEASURED AND CORRECTED.** The predicate is **`Split Order Type`**,
  NOT the `Dealer Order Number` prefix. Customer-payable = `Post warranty /Paid Order` ·
  `Accident Order` · `Repeat Jobs`. Billed-to-AL/free = `Warranty Order` · `Free service` ·
  `Free Of Cost Service Order` · `AMC Order` · `PDI Order` · `Campaign Job` · `Aggregate Order`.
  ⚠️ **A `WTY…` order number does NOT mean warranty**: 142 paid `PCS` invoices carry `WTY…` order
  numbers because the job *opened* under warranty and the line is post-warranty paid work.
  Filtering on the prefix discards **~90% of billable invoices** (measured: 61 vs the correct 549).
  Kept as DATA (constant + `scripts/payments/rescan-warranty.mjs` for retroactive correction).
- **Column order unstable; column set can change** (shared-login ALV layout edits). Parsers map by
  NAME, hard-fail on missing required columns; reuse the wrapper's gates (count vs body, money
  cross-foot, date containment). `source_pulled_at` read from the export's **title row 2**.
- **No cancellation flag**; under a delta pull a cancelled invoice is undetectable by construction.
  Countermeasures: empirical cancel test (Phase 0) + a **weekly trailing-30-day full re-pull**
  (wrapper CoWork task); "present in DB, absent from a covering re-pull" → review flag, never
  auto-cancel.
- R7 counter sales: calibrated, not wired (CoWork task). Returns = `ZMPR` **or `ZSPR`** negative
  rows → **`credit_note` allocations**, never negative invoices. ZMPI/ZPCA vs ZMCI/ZPCR meanings
  to be confirmed (open item).
- Wrapper has **no HTTP code**; Phase B adds a chunked HMAC POST (per report per day — respects
  the 5000-row EF cap pattern).

## Measured UPI reality (July 2026 exports, both real files in `docs/`)

| | BharatPe (`statement (2).csv`) | GPay Business (`GPay_Business_Transactions_…csv`) |
|---|---|---|
| Volume | **532 txns · ₹37.7L** (17/day avg, 33 max) | **97 txns · ₹5.9L** (~3/day) |
| Txn ID | **12-digit numeric, UTR-like** → the dedup key | Google-internal code (`CICAgLiC…`) — **NOT a UTR** |
| Payer | Full legal/bank names (496/532 ≥2 words) | Truncated first names; **2 rows empty** |
| Remark | **No notes column at all** | `Notes` on 74/97; **24 carry a 3+ digit number — which is a VEHICLE NUMBER PLATE, not a bill number.** See "⭐ CORRECTION" below |
| Fees | 7 rows nonzero MDR (gross≠net exists) | Always 0 |
| Junk | 6 test txns ≤₹30 | third-party-app rows show "Unknown app" + "Payment from PhonePe" |

### ⭐ End-to-end measurement (Aug 6–25: real UPI × real SAP invoices, both on disk)

| Measured | Result |
|---|---|
| Customer-payable invoices in window | **549** (₹69.0L) · 361 cash-terms / 188 credit-terms |
| Jobs | **358**, of which **191 (53%) have BOTH a parts and a labour invoice** |
| UPI receipts in the same window | **350** (₹20.7L) |
| Receipt → exactly one invoice/job by amount (±3d) | **12.9%** |
| Receipt → several candidates | 27.7% |
| **Receipt → NO candidate at all** | **59.4%** |
| Receipt value with any candidate | ₹8.0L of ₹20.7L |

### ⭐⭐ RE-MEASURED against the Billing Report (the corpus that actually matches)

440 UPI receipts (₹26.9L) × 1,085 invoices (₹113.7L), 1–29 Aug:

| ±3 days | Result |
|---|---|
| Receipt → **exactly one** invoice/order | **12.0%** |
| Receipt → **several** candidates | **63.2%** |
| Receipt → **none** | **24.8%** |
| Ambiguous cases resolved to one by **payer-name token overlap** | **+46** |

**What changed vs the R5/R6 attempt:** "no candidate" fell **59% → 25%** (counter sales are now
present), while ambiguity rose — because ₹1,930 now appears **114 times**. The bottleneck moved
from *missing data* to *identical amounts*, which is the tractable problem: **payer name resolves
46 of them, and a billing timestamp would resolve most of the rest** (see gap 1 above).

**The honest design conclusion:** the tool must **shortlist fast and let a person pick** — roughly
1 in 8 receipts can be auto-suggested with confidence today. Building for "narrow to 2–5 candidates
in one keystroke" is correct; building for "auto-suggest the answer" is not.
→ Also: ₹113.7L invoiced vs ₹26.9L UPI — most invoices settle by cash/cheque/credit, confirming
manual receipt entry belongs in A1 and that the **unpaid-cash exception feed** has real volume
(767 "Pay immediately - Cash" invoices).
→ **245 of 836 orders bill as more than one invoice**, so job-level grouping stays core.

**Consequences (supersede earlier assumptions):**
- **Total UPI workload is ~21 receipts/day**, not 50–200 — the Match queue is small; throughput
  engineering matters less than correctness. (Invoice volume stays as stated; most invoices are
  cash/credit-settled outside UPI.)
- **Amount alone is NOT a solution** — 12.9% unique, 27.7% ambiguous end-to-end (above). The
  ranked matcher is justified, but so is the honest conclusion that **a human picks from a short
  list** for most receipts; design for "narrow it to 2–5 candidates fast", not "auto-suggest one".
- **Neither export carries a VPA** → `payer_memory` keys on **(source, normalized payer name)**,
  not VPA. BharatPe's full legal names are a strong recurring signal; GPay's truncated names are
  weak — GPay leans on its Notes number instead.
- **Cross-source UTR dedup only applies to BharatPe** (GPay's ID is internal); the global
  `normalized_utr` unique index is BharatPe-scoped; GPay relies on its per-source txn-id key.
- Parsers must skip/flag **test transactions ≤₹50** (review list, not receipts) and tolerate
  empty payer names and non-ASCII (`Ďîñĕšh`, `ए व इ`).
- Only **two parsers exist in total** → both land in Phase A (no "remaining parsers" in B).

## Boundaries

Phase 10 tracker (parked, chassis money) — no overlap. HD Hyundai ERP — no overlap.
`service_jobs` — untouched.

## ⭐ Round-3 absorptions (v4) — what the clean-room sweep added

### Busy integration — SOLVED (closes the shape of open item 2)
- **The path: Busy's native "Import Vouchers From Excel"** (`Administration → Utilities →
  Data Export/Import`) — a **Standard/Enterprise** feature (Basic lacks it). **There is NO Busy
  voucher XML** (Tally concept — struck) and no bank-statement→voucher path. Use THEIR release's
  sample format file from the import screen.
- **Export emits TWO voucher types from day one: Receipt AND Journal.** TDS closure = **Journal**
  (Dr `TDS Receivable (FY)` / Cr customer, Against Ref to the invoice) — it is not money received.
  **Reversal = Journal** (Dr customer / Cr original bank ledger) **plus a New Ref line with the
  SAME reference number to re-open the invoice** — without it Busy shows the bill paid while the
  ledger disagrees. Never negative receipts. Same-day errors are netted out of the file.
- Vocabulary: bill references = **"Bill-by-Bill Balancing"** (New Ref / Against Ref / On Account /
  Advance). *"Bill Sundry" means invoice-footer charges — wrong word, do not use.*
- **Ledger mapping**: import matches on EXACT ledger Name. Convention: SAP customer code goes in
  the Busy ledger's **Alias** field; seed the mapping from an exported `List of Accounts` under
  Sundry Debtors; **auto-create-master stays OFF forever** (silent duplicate ledgers = worst
  failure). Unmapped customers → keyed-entry exceptions sheet.
- If bill-by-bill is ON and refs = SAP invoice numbers, push `Against Ref` → Busy's bill-wise
  outstanding equals the portal's matching. Ref columns in the format from day one (inert if off).
- **Pilot uses a Busy TEST COMPANY** (company copy = the closest thing to staging) for week-1
  exports before touching live books.
- **Five verbatim accountant questions** (in the digest): edition/release screenshot of the
  Utilities menu · bill-by-bill on? what do refs contain? · voucher series + exact cash/bank/UPI-
  settlement ledger names · current TDS-shortfall practice + ledger name · error-correction
  practice + audit-trail on? Plus homework: export the Sundry Debtors account list.

### Ledger model upgrade (adopted from the clean-room data-model lane)
- **Unified document model**: debit documents (invoices, dr-opening-balances) vs credit documents
  (receipts, credit notes, TDS entries, cr-opening-balances). **Opening balances become ordinary
  documents** — allocation targets/sources like any other — which deletes the special-cased
  `on_account` group arithmetic. Allocations *classify* money; they never change outstanding.
  The identity *(Σ debit faces − Σ credit faces) ≡ (unsettled debits − unallocated credits)*
  holds per group at all times; a nightly `v_integrity_violations` view recomputing both forms
  (plus cache = Σ active allocations) must be empty — the corruption detector.
- **Temporal group membership**: `group_memberships(valid_from, valid_to)` with an EXCLUDE-gist
  constraint (one group per customer per instant, DB-enforced against concurrent edits). As-of
  reporting and merge/split semantics fall out naturally; the membership move is the only UPDATE
  (closing `valid_to`).
- **Full reversals only** (a partial correction = full reversal + fresh allocation) — simpler
  arithmetic and simpler contra export. Gap-free serials via a locked counter row (never
  sequences — sequences gap on rollback). `not_ours` as append-only mark/unmark **events**, each
  riding the export as its own journal entry. "No write-offs" enforced as a **closed CHECK list**
  on document kinds. Post-export invoice cancellation = auto credit-note fully allocated (the
  contra travels; the exported row never changes).

### Fraud/compliance additions (owner-decided where marked)
- **Daily cash tie-out + GM sign** *(owner: yes)*: portal cash total vs deposit slip, one line,
  signed in-app daily; unbanked cash > 1 banking day flags red. (Physical receipt-book link and
  monthly statements: not selected now; statements align with the owner's planned customer
  bills/ledgers channel — later, with messaging.)
- **`not_ours` money still reaches Busy** — exported as a payable to the sister business unit
  (its own worklist/journal section). Dropping it breaks bank reconciliation completeness.
- **₹2L cash hard-block (Sec 269ST, all three limbs** — per payer-day aggregate, per
  transaction/invoice cumulative incl. instalments**)** — penalty is 100% on the dealership. No
  override. (Write as "or corresponding provision of the Income-tax Act 2025" — in force since
  1 Apr 2026; sections/rates live in dated config, never code.)
- **GST advances**: service advances are taxable on receipt (s.13(2)); goods advances exempt but
  ALL advances need a Rule 50 receipt voucher. Month-end report: unadjusted advances (tagged
  goods/services/indeterminate) for GSTR-1 Table 11A/11B — requires the advance→invoice linkage
  the allocation model already provides. Same-month netted out.
- **Returns**: the tool TRACKS, never issues — receivable reduction blocked until the SAP credit
  note number/date/**IRN** is captured; CN rate = original invoice's rate (Sept-2025 28%→18%
  transition makes this live); TDS closures capped 5%, **no TAN** *(owner, final — 26AS
  reconciliation stays outside the tool)*.
- **Retention/backup**: nightly dumps get an **India-located copy** (Companies Rule 3: daily
  backup on servers physically in India + annual ROC intimation of the cloud provider); 8-year
  retention; quarterly off-Supabase archive of events + payloads.
- Audit-log hardening: BEFORE UPDATE/DELETE trigger raising (binds service role too),
  **hash-chained rows + daily off-site chain digest** via the export job; 2FA on Supabase
  dashboard accounts; org members minimized.

### Security/session policy (adopted)
- **No write RLS policies for `authenticated` on money tables — including admin** (an admin
  PostgREST write path would bypass the EF and the audit log). Money writes via service-role
  RPCs only.
- **Step-up password re-auth (verified in the EF)** for: reverse, void, limit-edit, group-edit,
  export. NOT for allocate/classify (the high-frequency flow). Device binding rejected.
- Sessions: accounts/GM = no remember-me (sessionStorage), ≤12h absolute / 1–2h inactivity;
  the service matching role keeps a longer session (adoption) since it holds no dangerous verbs.
  Lost phone runbook: `is_active=false` + admin global signOut.
- **Staff read via a matching view without GSTIN/PAN** (PostgREST has no column RLS; "the UI
  doesn't show it" is not a control). PAN masked, reveal audited. Exports server-generated,
  ≤5-min signed URLs, row-count+hash audited; SOP: never WhatsApp/email the file.
- Ingest EF: HMAC over the RAW body + nonce replay table + no read-back ever; IP allowlisting is
  NOT available on free tier — never claimed as a control.
- Offline = **read-only + hard-block writes** (no outbox in v1); every mutation carries a client
  idempotency UUID; local draft persistence so interrupted work resumes; `as of HH:MM` stamps +
  stale banners; conflict = visible "already matched by X" strip.

### Matching refinements (adopted; capture/paise proposals REJECTED — see verdict)
- Tiered weights with hard separation. ⚠️ **The note-number tier below was WRONG — see "⭐
  CORRECTION" at the end of this section.** As actually built and self-tested:
  reg-full 95 · **reg-last4 85** · unique-amount 90 · ambiguous-amount 55 · typed-bill-number 45 ·
  learned≥2 = 50 · single-confirm 20 · name 0–25 **never negative** (drivers pay for firms) ·
  date 0–10, which breaks ties but **never qualifies a candidate on its own**; score gap < ε with
  no strong signal → **refuse to rank** (unordered list + honest banner).
- Indic phonetic canonicalization (~20 regex rules, not Soundex); asymmetric token match with
  prefix/initial expansion; IDF from own customer master (KUMAR/BHAI ≈ noise).
- Poisoning defenses: single confirmation = weak tier; contradiction counter demotes; shared-name
  flag (3+ customers on one payer) permanent demotion; reversal decrements the memory.
- **Per-class honesty**: workshop-cash bills carry the matcher (80–95% top-3); the ₹1,930 counter
  class is refuse-to-rank + name/note territory; the day's same-amount pool gets ONE batch screen
  (greedy mutual elimination), not 17 shortlists. Log position-of-confirm, class, winning signal,
  clerk-seconds, reversals-within-30d; pre-committed simplification: deterministic ≥85% → delete
  the fuzzy tier; learned-tier wins <5% after 8 weeks → drop the store.

### ⭐ CORRECTION (2026-09-08, measured while building A1) — the note number is a NUMBER PLATE

**What this plan said:** a number typed into a Google Pay note is a **bill/job number**, and it is
the strongest signal in the matcher (weight 100).

**What the data says.** `scripts/payments/diag-note-numbers.mjs` tests every typed number against
every field it could plausibly refer to — invoice number, job card, SAP billing document, dealer
order, registration, and the last 4/5/6 digits of each. Of the **28** real August notes carrying a
number:

| the typed number is… | hits |
|---|---|
| **the last 4 digits of the VEHICLE REGISTRATION** | **17 / 28** |
| the last 4 of the job card | 3 / 28 |
| the last 4 of the SAP billing document | 3 / 28 |
| the last 4 of an invoice number | **1 / 28** |

Two notes say it outright: **"GJ15AV 9044"**, **"Gj27td 7715"**. Substring-matching against the
registration reaches **19/28**. This is obvious in hindsight — a driver identifies a truck by its
plate, the workshop books the job against the plate, and nobody memorises `MPI6370260000724`.

**What changed.** `reg-last4` is now a first-class signal (85), just below a full registration
match (95). A typed bill number is kept but weighted **45** — it is rare, and four digits collide
easily, so it must not outrank a plate. **Result: the signal went from resolving 7% of
note-carrying receipts to 50%.**

**Second defect, found in the same pass.** The first matcher gave every open bill inside the date
window a score for date proximity alone, so a "shortlist" was always exactly as long as its own
limit — **median 8 of 8 across 450 real receipts, and "nothing in range" never fired once.** A
candidate must now carry a *substantive* signal (amount, plate, typed bill number, payer memory, or
a rare-token name match); date and faint name overlap break ties but never qualify. Measured
effect: **median shortlist 8 → 3** (50.7% fit in three) and **"nothing in range" 0% → 20.2%**,
which finally agrees with the ~25% no-candidate rate measured independently.

**Current honest picture** (450 real receipts × 1,085 real invoices, `measure-matcher.mjs`):
one clear answer **28.2%** · ranked short list **16.0%** · shown unordered **35.6%** · nothing in
range **20.2%**.
⚠️ These are **shortlist-quality** numbers, **not accuracy**. Nobody ever recorded which bill each
payment actually paid, so there is no ground truth to score against. "Confident" means one
candidate stands clear of the rest — not that it is provably right. **The pilot is the first
opportunity to measure whether it is right**, via position-of-confirm and 30-day reversals.

### Pilot playbook enrichment (adopted into the pilot spec)
- **Seeding D-7→D-1**: customer master + SAP↔Busy name reconciliation FIRST → groups+limits
  (owner+GM, one sitting) → opening balances signed vs Busy TB → **14 days of back-data
  pre-matched in the dry-run** (≤20 open items on day 1 — empty screens read as a toy, 300
  unmatched reads as already-behind) → every user's login tested on their own phone on both
  networks → Busy export dry-run into the test company → feature freeze D-1 noon.
- **Double-keying ends after 10 consecutive ₹0/0-line export days** (the non-negotiable gate),
  hard cap 4 weeks; the clean-day counter lives on a wall chart.
- Kill lines visible from day 1 (staff reluctant to criticize will happily point at a
  pre-agreed number): same-day entry <60% for 5 days · unexplained ₹>1,000 surviving 48h ·
  same-root-cause live-Busy error twice · 3+ down-days in 2 weeks.
- Week-1 doctrine: **completeness over timeliness** ("the only week-1 sin is a receipt never
  entered"); daily 17:15 five-minute stand-up, three numbers on the wall chart, per-SITE never
  per-person; owner speaks last and only to say what he'll fix; bug bounty (₹100 recharge per
  new bug, framed as help); the tool gets a staff-chosen name; Friday "one thing to remove"
  round; pinned "You said → I changed" fix-log.
- Rollback playbook: Busy stays authoritative until graduation so the books need ≤3 days of
  patching; keep everything (the mapping table is permanently valuable); the retreat is named
  "the tool wasn't ready — you were"; retry only with a date + top-3 fixed; ≥4-week cool-off.

### Portal-wide note (from the ops lane)
**Vercel Hobby's ToS prohibits commercial use** — the whole portal carries a
suspension-without-warning risk. Decide Cloudflare Pages (free, commercial OK) or Vercel Pro
(~$20/mo) at some point — independent of this tool, surfaced for the owner. Also pre-commit the
Supabase Pro trigger (~$25/mo at go-live + 90 days or when accounts onboards) so backups/PITR
arrive before the ledger matters.

## Data model

Additive, `public`. Money = **`bigint` paise**, one helper `src/service-payments/lib/paise.js`
(integer-only; portal legacy money is integer rupees — convert only through this lib). All day
arithmetic in `Asia/Kolkata` (`+05:30` instants in parsers; `(ts AT TIME ZONE 'Asia/Kolkata')::date`
in SQL).

**`customer_groups`** — `entity_id`, `name`, `credit_limit_paise` (GM/admin-only writes, audited),
`busy_ledger_name`, **`contact_emails text[]` + `contact_whatsapp text[]`** *(owner: groups carry
the common email(s)/WhatsApp number(s) for the planned bills/ledgers-to-customer channel)*,
`notes`, `created_by/at`. Opening balances live as **documents** (see Round-3 ledger upgrade),
not columns here. Membership via temporal `group_memberships` (EXCLUDE-gist).

**`customers`** — **the customer master** *(owner: explicit requirement)*. One row per SAP
`Customer Code`: `entity_id`, **`sap_customer_code` (the identity key — two customers with the
same name are distinguished by it, and it is shown in the UI beside every name** *(owner)*),
`display_name`, `gstin`, `pan`, `group_id` (nullable), `notes`. Auto-created on invoice import into
an **ungrouped queue**. **Ungrouped customers still render in Outstanding** as single-customer rows
under a pinned "Ungrouped" block — money never hides.
**Authority: GM/admin create groups and assign both membership and credit limits** *(owner —
changed from accounts-curated)*. Accounts may propose (a suggestion queue GM clears), never commit.
**Grouping signals — MEASURED, and the obvious idea does not work.** The owner's real case:
*Ramesh Sharma · Pankaj Sharma · Kamal Sharma → **Avenue Roadways***. Two candidate signals were
tested against the Billing Report and both fail:
- **Shared vehicle: ZERO.** Not one registration number is billed to more than one customer code.
  (Counter sales carry no vehicle at all — 412 blank.) The proposed primary signal measures 0.
- **Bill-to: not a grouping.** `Bill to Name` differs from `Customer Name` on only 54 rows, and
  every one points at *Paras Trucks And Buses* itself (self-billing), not a parent customer.
**The relationship is commercial and invisible to SAP.** Therefore grouping is **manual by
GM/admin**, and the tool offers only honest weak hints, ranked: **same name across different
customer codes** (measured: 15 such names, the worst spanning 4 codes) · **shared GSTIN/PAN**
(present on 734/876 rows respectively) · shared address/mobile if ever available. Name-token
similarity is a *hint that must be confirmed*, never an auto-merge — "Sharma" alone would merge
strangers. `dismissed_suggestions` (customer pair + reason) so a rejected suggestion is never
re-proposed to the next person.
**Same-name/different-code is exactly why `sap_customer_code` is displayed everywhere** *(owner)*.
**Regrouping:** free while no exported allocation touches the customer's invoices; after that
gm-gated + advisory row in the next export. Merge = sum opening balances, keep target's
mapping/limit; the `group_edit` event snapshots **full prior membership + both balance fields**
(deliberate exception to narrow-events). Split = membership move only; opening balance stays with
the survivor, reassignment surfaced as a to-fix item. One-click **groups CSV export**.

**`service_invoices`** — mirror of SAP. `entity_id`, `outlet_id`, `invoice_number`,
`sap_billing_doc_no`, `invoice_kind ∈ {service_parts, service_labour, counter_sale}`, `job_ref`,
`invoice_date`, `customer_id`, `customer_name` (snapshot), `vehicle_reg_no`,
`payment_terms ∈ {cash, credit}`, `total_paise`, `allocated_paise` (denorm, RPC-maintained,
`CHECK BETWEEN 0 AND total_paise`), `status ∈ {active, cancelled, pre_opening}`,
`source_pulled_at`, `import_batch_id`, `notes`. `UNIQUE (entity_id, invoice_number)`.
Amendments changing customer code / reg-no / crossing FY = **collision, refused loudly**.
Amendment shrinking total below allocated = sixth diff outcome, refused + listed.
Invoices dated ≤ the entity's `opening_balance_as_of` import as `pre_opening` (excluded from
outstanding — prevents go-live double count). Blank invoice-number non-warranty rows → refused to
review.

**`payment_receipts`** — `entity_id` (from the upload form / source-account mapping — stated
provenance), `mode ∈ {upi, cash, cheque, netbanking}`, `amount_paise` (`CHECK > 0`, **pinned:
gross customer-paid**, never net-of-fee), `gross_paise`/`fee_paise` when present, `received_at`,
`source ∈ {gpay, bharatpe, manual, bank_statement*}`, `external_txn_id`,
`normalized_utr` (BharatPe only — GPay's txn id is internal, not a UTR), `payer_name`,
`payer_remark` (GPay Notes — the bill-number carrier), `instrument_ref`,
`receipt_serial` (manual receipts: gap-free `CR-{entity}-{FY}-{seq}` via the portal's numbering-RPC
pattern; **notification hook** field for the later WhatsApp/mail integration),
`classification ∈ {service, not_service, unknown}` + `not_service_kind`,
`awaiting_invoice boolean` (the advances flag — excluded from "pending", shown as an amber chip),
`allocated_paise` (+CHECK), `status ∈ {active, voided}` + `voided_at/by/reason` (cheque bounce =
void with reason; no separate status), `import_batch_id`, `notes`.
**Classification mechanics:** default `unknown`; any allocation auto-flips it to `service`
(event-logged, exempt from accounts-only); `payments_classify` **refuses `not_service` while
active allocations exist**; declassify-then-allocate within 30 days is digest-flagged.
`not_service` receipts ride the export as their own worklist section (completeness — every rupee
that hit the merchant account reaches Busy's view).
**Idempotency:** `UNIQUE (entity_id, source, external_txn_id) WHERE external_txn_id IS NOT NULL`
(entity included now — per-outlet split and PT will need it) ·
`UNIQUE (entity_id, normalized_utr) WHERE normalized_utr IS NOT NULL AND status='active'`
(populated for BharatPe + future bank/UTR-bearing sources; GPay rows leave it NULL) · batch
file-hash refusal. Blank-txn-id, negative, and **test rows ≤₹50** → refused to review, never
inserted.
**Manual UPI entries REQUIRE the app's transaction id** (BharatPe: the 12-digit UTR; GPay: its
transaction code — parser-outage bridge); re-import collision with a manual row
→ third disposition **`already_present_manual`**: skip + link + backfill gross/fee/VPA, its own
count in the summary — never a review-list avalanche.

**`payment_allocations`** — `receipt_id` (nullable), `invoice_id` (nullable), `group_id`
(nullable), **`alloc_type ∈ {payment, tds, on_account, credit_note}`** with CHECKs:
`payment` = receipt+invoice · `tds` = invoice only (**≤5% of invoice total** in the RPC; GM
override) · **`on_account`** = receipt+group, no invoice — settles opening balances and parks
advances against a group (the fix for the opening-balance arithmetic hole) · **`credit_note`** =
invoice-or-group, no receipt — counter-sale returns and (future) SAP credit notes.
`amount_paise` (`CHECK > 0`), `allocated_by/at`, `reversed_at/by/reason`, `export_batch_id`,
`reversal_export_batch_id` (post-export reversals export as **contra rows**),
`bounced_back_at/by/reason`.
**Group outstanding = opening_balance + Σ active invoice totals − Σ active allocations attributed
to the group** (via invoice→customer→group or directly via group_id). Aggregated **in SQL** (RPC
returning per-group ageing buckets; drill-down fetches one group's rows) — not client-side.
**Bounce-back = reversal-with-routing**: sets `reversed_at` (freeing both sides) + bounce columns;
the receipt re-enters the unmatched pool flagged "returned: <canned reason>" and surfaces first in
the maker's queue. Canned tap-reasons ("amount differs", "wrong customer", "need job card no."),
free text optional; UI wording "returned for info", never "rejected".
**Invariants** in-RPC, one transaction, `SELECT … FOR UPDATE` deterministic order (receipt first,
invoices by id): Σ active ≤ receipt · Σ active ≤ invoice · three-way entity equality
(receipt/invoice/caller). Exported allocations immutable below gm/admin; the unallocated remainder
of a partially-exported receipt allocatable by the normal ladder.
**Job-level confirm** = one RPC call creating per-invoice allocations at exact per-invoice
outstanding, cash-terms invoice first; mixed-terms jobs badged.

**`payer_memory`** — `UNIQUE(entity_id, source, normalized_payer_name, customer_id)` (neither
real export carries a VPA — measured; one payer can pay for two fleet owners), `confirm_count`,
`last_confirmed_at`. **Hygiene:** a confirmation strengthens only after
the allocation survives export + 14 days unreversed; reversal decrements. Hits older than 180 days
are demoted out of the confident bucket and badged "last seen <month>".

**`payment_import_batches` / `payment_export_batches`** — counts, actor, file name, file hash,
**`parser_version` + `format_note`**, raw parsed payload (imports) / frozen compact payload
(exports), plus **original file bytes in Storage** for SAP batches and failed parses (status
`failed_parse` — remote debugging + one-click re-import after a parser fix). Retention rule noted:
payloads of fully-exported batches older than N months may be compacted (decide at design, not at
480MB).

**`busy_balance_checks`** — `group_id`, `as_of`, `busy_balance_paise`, `portal_balance_paise`,
`delta`, `resolved_note`. Fed by the **monthly Busy ledger-balance upload + per-group diff view**
*(owner: monthly)*; the same importer is the opening-balance re-baseline mechanism.

**`payment_events`** — append-only; types `import, classify, allocate, reverse, bounce_back,
export, manual_receipt, void_receipt, group_edit, limit_edit, limit_breach, cancel_invoice`.
Typed columns (`amount_paise`, `receipt_id`, `invoice_id`, `group_id`) — not text — so exception
queries don't parse strings. `limit_breach` written at invoice import when a group is over limit
(who-knew-what-when evidence). Retention ≥ 8 years (Companies Act) with a quarterly off-Supabase
archive of events + batch payloads.

## Backend

**Two EFs** (user-JWT and machine-secret never share a dispatch):

1. **`service-payments`** — template `service-jobs/index.ts` (`verify()` `:47-106`; helpers
   `:38-43`). Authority = department AND permission level; console callers from other departments
   refused. Reuse `_shared/` cors/keys/rateLimit/auditLog.
2. **`ingest-sap-invoices`** (Phase B) — distinct secret (never SYNC_SECRET), HMAC-SHA256 of
   body+timestamp ±5 min, **two valid secrets supported** (rotation without synchronized cutover),
   401s audited, sentinel-keyed throttle (shared `rateLimit()` can't serve machine callers —
   `20260411_rate_limits.sql:4-9`). Batches **held for preview**; "pending > 24h" fires the alert
   channel; auto-publish criteria pre-agreed (all gates green, zero refused, N clean months) as a
   planned graduation.

**Authority ladder** (adds the import row the v2 ladder lacked)

| Action | Who |
|---|---|
| Upload/commit import batches | admin (pilot) → accounts (post-pilot handover — a dated event, not "for now") |
| Allocate UPI | service, accounts (their manager+, gm/admin) |
| Manual receipts · non-UPI allocation · classify · TDS (≤5%) · void receipt | accounts |
| TDS >5% · exported-allocation reversal · `payments_cancel_invoices` · regroup-after-export | gm/admin |
| Bounce back (pre-export) · run export · Busy ledger mapping · opening balances · monthly Busy check | accounts |
| Reverse un-exported allocation | maker, accounts, gm/admin |
| **Customer groups: create, assign members, merge/split** | **GM/admin** *(owner)* — accounts proposes into a suggestion queue |
| **Credit limits** | **GM/admin** *(owner)* |

**RPCs** — SECURITY DEFINER, `search_path=public`, triple REVOKE + service_role grant:
`payments_import_invoices` (`{new, amended, unchanged, refused[], stale[], amend_conflict[]}`) ·
`payments_import_receipts` (incl. `already_present_manual`) · `payments_allocate` ·
`payments_allocate_job` · `payments_reverse_allocation` (`…AND reversed_at IS NULL FOR UPDATE`) ·
`payments_bounce_back` · `payments_close_tds` (5% gate) · `payments_credit_note` ·
`payments_on_account` · `payments_void_receipt` · `payments_revert_import_batch` (refuses on
active allocations, lists them) · **`payments_cancel_invoices(ids[], reason, cascade)`** (gm; the
month-6 bulk-correction shovel — a script call, never freehand prod SQL) ·
**`payments_match_candidates(receipt_id)`** (server-side ranking + credit-limit warning — required
because service execs' scoped RLS can't compute ranking client-side) · `payments_export_batch`
(**cursor semantics**: all active un-exported allocations + contra rows; set-collection inside the
RPC, never a client-side paginated read; date labels only) · `payments_ageing` (SQL-side buckets).

**RLS.** Drop-then-create per verb + RESTRICTIVE `is_active_user()` gate; **every predicate
`(select f())`-wrapped including the restrictive gate** (sole prior example:
`20260825_tiv_atomic_upload.sql:42-44`). Accounts/manager+/gm/admin = full history entity-scoped.
Service executives = work queue (unallocated/partial/awaiting UPI receipts + open invoices +
**their own allocations** + the per-outlet chase list) through a scoped view. (The VPA-PII concern
dissolved — neither real export carries a VPA; payer names are on the receipts service must match.)

**Operations hardening** (from the 12-month lane — all cheap, all Phase A1):
- **Nightly `pg_dump`** via free GitHub Actions cron to a private repo; **dump before every
  money-table migration**; a selftest that **rebuilds `allocated_paise` from `payment_events`**
  (the audit trail as a *tested* recovery path). Free tier has no backups; prod is the only env.
- **Dead-man's switch**: `pg_cron` + tiny EF pinging ntfy/healthchecks when
  `max(source_pulled_at)` per source exceeds its cadence (the wrapper can't report its own death);
  doubles as free-tier keep-alive. Per-source "no activity today" attestation so green is honest.
- **Staleness gates matching**: when invoice coverage predates a receipt, red banner on Match and
  the confident bucket is **disabled** (no Enter-to-confirm against a stale corpus — the error
  amplifier). Day-status line renders on the Match tab, and without the `exported ✓` segment until
  Phase B ships export.
- Migration discipline: money tables/columns/enums **additive-only**; frozen per-format-version
  parser fixtures stay in the suite forever.

## Frontend — ⭐ **MOBILE WEB IS THE CORNERSTONE** *(owner, and it overrides the earlier
"desktop-first" decision)*

**Most matching will be done by staff on their phones.** That is a design constraint, not a
styling one. Concretely, it changes:

- **The Match screen is one receipt at a time, full-bleed** — not a two-panel list+candidates
  layout. Receipt card (amount huge, payer name, source, time) → tap → **full-screen candidate
  sheet** → tap a candidate → confirm. The existing `.tiv-receipt` bottom-sheet-under-720px
  pattern (`src/index.css:3143`) is the precedent to extend.
- **No keyboard-first idioms.** "Enter confirms, auto-advance" is deleted as the primary flow; it
  survives only as a desktop enhancement. The mobile equivalent is a **thumb-reachable confirm
  button** in the bottom third, ≥44px targets, and swipe-to-next after a confirm toast.
- **Typing is the enemy.** Canned tap-reasons everywhere (bounce-back, not-service kinds); a
  numeric keypad (`inputmode="decimal"`) for amount search; name search with debounce. Gujarati
  input accepted in all free text; the tokenizer must not assume ASCII.
- **Payload discipline is now correctness, not polish.** Candidates come from
  `payments_match_candidates` **server-side per receipt** (never a client-side corpus download);
  slim column selects; the open-invoice list is never shipped whole to a phone on a workshop
  connection.
- **Every confirm carries a `client_request_id`** (the portal's existing idempotency pattern,
  `create_service_job`) — a flaky mobile network retrying a POST must not double-allocate. No
  optimistic UI on money: the row shows a pending state until the server answers.
- **The counter is where the knowledge is.** With no billing time in SAP (above), the person
  holding the phone *at the moment of payment* is the best disambiguator that exists. The mobile
  flow should let them resolve a receipt in seconds while the customer is still standing there —
  this is the single biggest lever on match quality left in the design.
- Desktop remains fully supported (accounts clears the tail at a PC, Import and Export are
  desktop-friendly), but **the phone layout is authored first and the desktop view is the
  enhancement** — the reverse of every other tool in this portal.

`src/service-payments/{pages,components,lib}`; route `/payments`; `.pay-*` prefix. Wiring:
`App.jsx` lazy route · `navConfig.js` Service Tools **+ a `CREATE_ACTIONS` entry** so matching is
reachable from the mobile Create (+) sheet · seed migration (asserts own-route counts only) ·
`AccessRules.jsx` `ALL_ROUTES` (stale; must gain `/payments`). Reuse the shipped mobile shell:
`BottomNav`, `MobileDrawer`, `CreateSheet` (`src/index.css:2848`), and the card-list patterns in
`Employees.jsx` / Catalog's `vc-mobile-cards`.

Tabs (fold discipline throughout):
1. **Match** (default): unmatched receipts as a card stack · candidates via
   `payments_match_candidates`, grouped by job and customer group. Signal order: **the VEHICLE the
   remark names** (GPay Notes — the digits are a number plate; see "⭐ CORRECTION") · payer_memory name hit
   (strongest for BharatPe's full legal names; **measured to resolve 46 same-amount collisions**) ·
   exact amount vs invoice/order outstanding (12% unique — never sufficient alone) · subset-sum
   within one group (cap ≤12) · reg-no/GSTIN in remark · name tokens · date proximity.
   *(Billing-time proximity removed — SAP will not provide it.)* Confident bucket is disabled while
   the feed is stale; overriding the top-ranked *customer* requires a one-line reason (forensic
   gold). "Awaiting invoice" chip; day-status line; notes inline. Queue norm: service gets first
   24h on UPI, then accounts. "Matched" in day-status = *that day's receipts now matched* (live
   recompute — "nothing left to do now", not a frozen close).
2. **Outstanding**: group ledger (incl. pinned Ungrouped block) · limit flag **with an action**
   ("notify GM" event, visible "flagged on <date>") · ageing buckets cash-vs-credit-terms ·
   **residue bucket** (small partials shown separately so ageing stays actionable) · **unpaid-cash
   exception feed** (`PCS`/cash invoices unmatched > 2 days — SAP-asserted skimming detector) ·
   monthly Busy-check deltas queue.
3. **Customer master** *(owner's named requirement)*: every customer with its **SAP customer code
   shown beside the name** (same-name customers are visually distinct); ungrouped queue;
   suggestions ranked by same-name-different-code → shared GSTIN/PAN → weak name hint (shared
   vehicle measured useless), with dismissed memory; **GM/admin** create groups, assign membership,
   set credit limits (accounts proposes only); Busy ledger name; opening balance; groups CSV
   export. Curation is a desktop-leaning screen, but must remain readable on a phone (GM approves
   a proposed group from wherever they are).
4. **Import**: cards per source; TIV chain (gates → client-side parse+diff → commit what was
   previewed); pending endpoint batches; failed-parse files retained for re-import.
5. **Export** (Phase B): checker pass **grouped by confidence/exception type** (maker's name one
   click deeper — control, not scoreboard); **self-originated rows excluded from accept-all**
   (must be individually ticked; they also enter the digest); bounce-back; XLSX download with TDS
   rows, `not_service` section, contra rows, Busy ledger names (unmapped groups = to-fix queue).
6. **Weekly digest** (A2; a page, not a tab necessarily): voids · reversals (esp. exported) ·
   bounce-backs aged >7d · batch reverts · not_service list · declassify-then-allocate · TDS
   closures with % · **cross-payer allocations** (receipt's remembered payer group ≠ allocated
   group) · **FIFO violations** (newer invoice settled while older same-group invoices stay open —
   the lapping signature) · over-limit events · self-originated exports · silent-reversal-vs-bounce
   ratio (checker-decay detector) · group merges. Ten minutes weekly *(owner: yes)*.

## Verification

`npm run build` (no ESLint). Self-tests (esbuild → node, `scripts/payments/`):
- `selftest-allocation` — full truth table incl. all four alloc types, 5% TDS gate, job-split
  order, bounce-back lifecycle, on_account/opening-balance arithmetic, exported-immutability,
  remainder-allocatable.
- `selftest-parsers` — real-corpus fixtures (R5 row 5 · R6 row 4 · R7 row 6, frozen per version),
  shuffled columns, IST under spoofed TZ, blank-UTR/negative refusal, title-row-2 pull date,
  warranty predicate incl. `PRE` investigation, blank-invoice-no refusal.
- `selftest-matcher` — ranking, staleness disabling confident, payer-memory hygiene/180d, caps.
- `selftest-import-diff` — 6 outcomes, collision-not-amendment, file-hash, pre_opening,
  `already_present_manual`.
- `selftest-export` — cursor semantics, contra rows, nothing twice, not_service section,
  export-vs-concurrent-reversal race.
- `selftest-ledger` — group outstanding formula, merge/split effects, ungrouped visibility,
  residue bucket, ageing splits, day-status logic, classification flows, limit warning.
- `selftest-events-rebuild` — reconstruct `allocated_paise` from events (recovery path proof).
- **`selftest-mobile-render`** — render the Match card, candidate sheet and confirm bar via
  `react-dom/server.browser` and assert the mobile contract: no two-panel layout below 720px,
  tap targets ≥44px, `inputmode` set on numeric fields, confirm button present in the bottom
  region, no keyboard-only affordance without a tap equivalent. (The portal has **no jsdom**, so
  structure is asserted from markup; interaction is verified by hand on a real phone.)
- **Idempotency test**: the same `client_request_id` submitted twice creates one allocation —
  the flaky-mobile-network case.
- Prod concurrency probe (self-aborting DO block; fresh pg_dump first). Watch one real run of
  upload → match → export before calling any phase done.
- ⚠️ **Do not use the internal browser pane on this dev server** (two confirmed crashes, cause
  unknown — `feedback_no_internal_browser`). Mobile verification = build + self-tests + handing
  the owner a URL to open on an actual phone.

## Build order

**Phase 0 — measure & unblock (before any migration):**
✅ **End-to-end join measured twice on real August data.** Against R5/R6: 59% unmatchable.
Against the **Billing Report**: 12% exactly-one · 63% shortlist · 25% none — the corpus problem is
solved, the remaining problem is identical amounts.
✅ **Invoice source settled**: the **Billing Report** replaces R5/R6 (counter sales included,
`Cancelled` column present, one row per invoice). ✅ Warranty predicate question **dissolved** —
this report holds only customer-billable documents.
✅ **Billing time: settled as unavailable** — SAP gives date only, permanently *(owner)*. The
matcher and the mobile flow are designed around it.
Remaining, in priority order:
1. **Schedule the Billing Report** as a regular export *(owner: "can be made part of the regular
   exports")*, with a stable variant so columns don't drift.
2. **Busy import format + ledger master + opening balances** — bounds the double-keying period.
3. **Ask accounts how parts returns (MPR) should behave** — credit against the customer, or money
   refunded out? Excluded from outstanding until answered.
4. 2-week ritual dry-run · confirm ₹1,700/₹3,400 are current counter prices.

**Phase A1 — the working core:** all migrations (full schema incl. alloc types — CHECKs can't be
widened cheaply later) · `service-payments` EF · **Billing Report import** (the single invoice
parser — prefix taxonomy, FOC excluded, MPR parked, `Cancelled` honoured) · auto-customers +
GM/admin grouping ·
manual receipts (serial series; manual-UPI bridge requires the txn id) · **BOTH UPI parsers —
GPay + BharatPe are the complete set, built against the real July+August files** ·
**mobile-first search-and-tap allocation** (no ranking engine yet — a phone-native card →
candidate sheet → confirm flow, with `client_request_id` idempotency) · **customer master** with
codes + GM/admin grouping · Outstanding + chase list + unpaid-cash feed · opening balances ·
staleness gates · pg_dump cron + dead-man's switch.

**Phase A2 — the comfort layer:** ranked matcher + payer_memory + subset-sum + Enter-flow ·
grouping suggestions + dismissed memory · day-status line · credit-limit flags + notify-GM ·
weekly digest.

**Phase B:** weekly trailing-30-day re-pull (CoWork) · Export tab · Busy ledger mapping + monthly
`busy_balance_checks` flow ·
`ingest-sap-invoices` + chunked wrapper POST · WhatsApp/mail receipt notifications (hook exists
from A1) · UPI-upload handover to accounts (dated).

**Phase C:** bank statements (with UPI-settlement skip + triage) · per-outlet merchant accounts ·
provider API feed · per-invoice dynamic QR · PT onboarding · auto-publish graduation.

**Pilot spec** (runs through A1/A2, 4 weeks, PTB): named accounts uploader-to-be; the service
coordinator who volunteers after seeing the chase list. **Every pilot user starts on a phone** —
if the phone flow doesn't hold, nothing else matters. Metrics from `payment_events`: same-day
match % (trend to ~80) · **share of matches made on mobile** (the cornerstone metric; if it trends
toward desktop, the mobile flow has failed and needs fixing before scale) · confident-suggestion
acceptance (<60% = fix ranking before scaling) · median import→allocation hours by maker ·
days-to-green · **owner-touch days (→0 by week 3)** · bounce vs silent-reversal ratio. Kill/iterate: week 4, if still double-keying AND same-day <50%
AND the clerk privately calls it slower than Excel — stop, fix the top complaint, re-pilot.
Owner behaviors that are deliverables: announce that corrections are normal and tracked, not
punished (a zero reversal rate means hiding, not accuracy); treat the first bounces as the system
working; 10-minute weekly numbers review *with* the pilot users.

## Open items

1. ~~UPI app sample exports~~ ✅ **RESOLVED — real July files received and measured** (GPay +
   BharatPe, in `docs/`). Gross-vs-settled: BharatPe carries `Net MDR` (7 nonzero rows); GPay
   gross=net. No refund/negative rows in either; test txns ≤₹50 exist and are filtered.
2. **Busy: confirm edition + collect sample format + ledger master + opening balances**
   (owner/accounts) — **Phase 0, gating**, but the SHAPE is now solved (see Round-3 absorptions):
   native Excel voucher import, Receipt+Journal vouchers, alias=SAP-code mapping, test-company
   rehearsal. The five verbatim accountant questions are in the digest and Round-3 section.
3. ~~SAP cancellation experiment~~ ✅ **RESOLVED** — the Billing Report has a `Cancelled` column
   (blank across August, but the field exists). Still confirm what a cancelled row looks like when
   one occurs.
4. ~~Warranty predicate~~ ✅ **DISSOLVED** — the Billing Report contains only customer-billable
   documents; exclude FOC (`PEI`/`LEI`) by prefix, nothing else.
5. ~~R7 wiring~~ ✅ **NOT NEEDED** — counter sales (`MPI`/`MCI`) are in the Billing Report.
   Replaced by: **schedule the Billing Report + request a billing-time column**.
6. **MPR parts returns** — accounts must say whether a return credits the customer's account or is
   money paid back out *(owner: "ask accounts")*. Excluded from outstanding until answered.
7. Confirm ₹1,700 / ₹3,400 are current counter prices (they are absent from the July R7 fixture).
8. Wrapper laptop → always-on PC (owner, "later") — prerequisite for full reliance, tracked.
9. ✅ **DECIDED 2026-10-09 *(owner)*: UPI is HDFC.** Static QRs on merchant **KTR510** (one QR now,
   more coming); **BharatPe and Google Pay completely retired**; accounts uploads the daily HDFC
   SmartHub Vyapar "Transaction Report" (.xlsx) on the Import tab until HDFC's API arrives (an
   Apps-Script mail feed was offered and not chosen; the Gmail connector cannot read attachments).
   Measured on the first report: **no customer note and no payer VPA** (so the A1–A3 fields below
   are still what the API must add); `Merchant ID`+`Terminal ID` DO identify the QR (stored as
   `qr_ref`); successful payments for a day equal HDFC's next-morning "UPI SETTLEMENT -KTR510-"
   credit **to the rupee** (₹1,48,693 for 7 Oct); SaleFailed rows are retried attempts and never
   money. Parser `src/service-payments/lib/parseHdfc.js`; migration `20261009_payments_hdfc_source.sql`.
   Full record: `docs/history/PORTAL_HISTORY.md` (2026-09-26 → 10-09 entry).
   *(Was: "UPI source consolidation → single provider → API (owner will notify; v1 stays
   multi-source)".)*
   ⭐ **Discovery questionnaire ready: `docs/backlog/upi-api-bank-questionnaire.md`** (v3,
   2026-09-11). **Settled *(owner)*: STATIC QR, ONE PER BRANCH** — even though the bank allows as
   many as we like. A static QR cannot carry a bill reference, so the matcher stays as designed.
   ⛔ **Do NOT re-propose per-counter QRs.** v2 did, reasoning that a payment on a parts-counter QR
   must be a counter sale so job-card invoices could be dropped from its candidates. The owner
   corrected it: **where a customer pays does not tell you what they bought** — a counter customer
   may pay at the counter, at accounts, or be walked to the accounts office by a counter executive.
   That filter would have hidden the correct bill on every payment made "elsewhere".
   ⭐ **Matcher rule that follows: the QR/branch a payment arrived on is a RANKING signal, never a
   FILTER** — it lifts same-plant bills, never removes the other plant's. Even the branch is not
   certain (a fleet owner with trucks in both workshops; paying from a WhatsApp'd QR photo). Log
   every confirmed match where invoice plant ≠ QR branch; the pilot measures reliability. Same
   family as "name weight is never negative — drivers pay for firms".
   **What the API can add that the CSVs lack — the three fields that decide it (A1–A3):**
   **payer VPA** (measured 2026-09-11: **0 of 1,079** rows carry one; 13 GPay rows have no name at
   all; by-name repeat rate is **40%** of Jul+Aug payments and **23%** of August payers already
   seen in July — approximate *because* names are the unreliable key; a VPA would make
   `payer_memory` exact) · **customer note** (the only customer-supplied clue under static QR;
   BharatPe has none today) · **QR identifier** (neither export has any store/terminal/QR column —
   BharatPe `Product`/`Payment Mode` constant on all 303 August rows; GPay `Paid via` is the
   *customer's* app — demand a sample response).
   ⚠️ **The schema has NO VPA column** (`payment_receipts`, and `payer_memory` is keyed on
   `(entity, source, normalized_payer_name, customer)` — migration lines 235/411 say so). If the API
   supplies a VPA, that is an **additive** change: a nullable `payer_vpa` on receipts + a VPA-keyed
   memory tier ranked above the name tier. Do it when the API is real, not speculatively.
   Two answers gate feasibility rather than value: **C1** (a fetch-by-date-range endpoint — without
   it a lost webhook is undetectable) and **E2** (banks routinely demand IP allowlisting; Supabase
   Edge Functions have **no fixed outbound IP**, so a mandatory allowlist means an extra relay
   host). ⏭️ **Unmeasured:** what share of same-amount/same-day collisions span both plants
   (5756/6370) — sizes the branch hint. Needs the Billing Report, which is no longer on disk.
10. **Vercel Hobby commercial-use ToS** (portal-wide, from round 3) — decide Cloudflare Pages vs
    Vercel Pro at leisure; and pre-commit the Supabase Pro trigger (go-live + 90 days).
