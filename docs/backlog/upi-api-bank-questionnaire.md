# UPI payment APIs — what to ask the bank's technical team

> **Purpose.** Paras Trucks & Buses is being offered UPI APIs by its bank. This is the
> discovery document: what to ask, why each answer matters, and what a bad answer looks like.
>
> **Status:** v2, 2026-09-09. **Revised after the owner confirmed the offering is a STATIC QR
> system, one QR per branch.** That single fact removes the highest-value question from v1 and
> replaces it with a different one — see "What changed" below.
>
> Companion: `docs/backlog/service-payments-plan.md` (the tool this feeds), open item 9.

---

## What changed from v1, and why it matters

v1's headline question was: *"can a dynamic QR carry our own bill reference and hand it back?"*
With a static QR that is **not possible** — a static QR is a printed sticker, identical for every
customer and every bill, so nothing about the specific bill can travel with the payment.

**That question is now closed. Do not ask it as though it were open.** (One confirming question
survives, as A8, purely so we know we are not leaving an option on the table.)

Under a static QR system, the bank can supply exactly **one** new matching signal that we do not
have today: **which QR the customer scanned.** Everything of value in this conversation now hangs
off that, which makes the number of QRs — and whether the API reports them — the thing to press on.

---

# PART 1 — For you, before the call

## What we are actually buying

Today money arrives and we find out by downloading a spreadsheet from Google Pay Business and
another from BharatPe — roughly **18–21 payments a day, about ₹44 lakh a month**. Someone then
works out which workshop bill each payment pays.

With static QRs, an API buys us two things:

| | What it fixes | Worth |
|---|---|---|
| **The convenience win** | No more downloading and uploading spreadsheets. Payments appear in the portal on their own, within minutes instead of the next morning. | Saves a few minutes a day and removes a manual step that can be forgotten. |
| **⭐ The matching win** | Every receipt arrives already knowing **which QR it came in on** — so it can be tied to a branch, and possibly to a counter. | **Depends entirely on how many QRs we are allowed.** One per branch is a modest gain. One per collection point would be a large one. |

## ⭐ The question worth more than all the others *(revised)*

> **"How many separate static QRs can we have, and does the API tell us which QR each payment
> came in on?"**

And immediately after it:

> **"Can we have one per collection point — the parts counter, the workshop cashier, each service
> advisor — rather than only one per branch?"**

**Why this is now the whole game.** A static QR carries no bill information. The only thing it can
tell us is *where the customer was standing*. So the QR count is the only dial the bank controls
that affects our matching at all — and each extra QR splits the incoming payment stream into a
smaller, cleaner pool.

Concretely, from our own August data:

- **₹1,930 appeared on 114 different bills** in one month — 17 of them on a single day. Almost all
  of those are **counter sales** (DEF and parts over the counter): 378 of August's 1,085 invoices
  were counter sales rather than job-card work.
- If the **parts counter has its own QR**, then a ₹1,930 payment arriving on that QR is a counter
  sale, and every job-card invoice drops out of the candidate list before we start. And a payment
  on the **workshop** QR is never a counter sale.
- That is a real, permanent narrowing that costs the bank nothing — **static QRs are stickers.**

**Ask for more QRs than you think you need, before the account is configured.** Adding them later
means reprinting, re-siting and retraining staff. Asking now costs one sentence.

## ⚠️ The thing that would make per-QR attribution worthless

**Verified on our own files today:** neither current export carries any store, terminal, QR or
outlet column at all.

- BharatPe's only two descriptive columns, `Product` and `Payment Mode`, read `BharatPe QR` and
  `UPI` on **all 303 August rows** — identical, zero discriminating power.
- Google Pay's `Paid via` describes the *customer's* app (83 "Unknown app", 64 "Google Pay" in
  August), not our QR.

So it is entirely possible to have two physical QRs and still receive a feed that cannot tell them
apart. **Having separate QRs and having the API report them are two different things, and we need
both.** That is questions A1 and B15, and neither should be taken on trust — ask for a sample API
response showing the field populated.

## ⚠️ The thing that could stop this dead

Banks very often say *"give us your server's IP address and we'll allow only that."* Our portal
backend runs on serverless infrastructure with **no fixed outbound IP address**. If IP allowlisting
is mandatory we cannot simply comply — we would need a small fixed-address server in between:
extra cost, and one more thing that can break.

**Ask question E2 early and get the answer in writing.** It changes the architecture and the
budget, and it is far cheaper to know now than after signing.

## What "good" looks like, in one line

> A **fetch-by-date endpoint** returning every payment in a date range with the **exact amount**,
> the **UTR**, the **payer's name and UPI ID**, the **customer's note**, and **which QR it came in
> on** — plus as many QRs as we ask for, and a sandbox to test in.

## Red flags — what to listen for

| If they say… | What it means for us |
|---|---|
| *"The API doesn't return which QR was used."* | ⛔ **This removes the only reason to prefer their API over the spreadsheets we already download.** Ask for a sample response. |
| *"You get one QR per merchant ID; more QRs means more merchant IDs / more paperwork / more cost."* | ⚠️ Get the price and the effort per extra QR **in writing**, then decide the layout once — reprinting later is worse. |
| *"We only send webhooks, there is no API to list transactions."* | ⛔ **Serious.** If one notification is lost, that payment is invisible to us forever and we cannot even know it is missing. |
| *"You must give us a static IP address."* | ⚠️ Architecture change and a cost line. Get the alternatives in writing (E2). |
| *"The amount comes as a number"* — and it turns out to be rounded | ⚠️ Our current BharatPe file rounds a derived amount to one decimal; on 13 rows it misses the true figure by up to 4 paise. Small, but it is wrong money in a ledger. |
| *"The customer's note is not available."* | ⚠️ With no bill reference in a static QR, the customer's typed note is the **only** customer-supplied clue we get. A quarter of Google Pay notes carry a number. Losing it makes matching **worse** than what we have today. |
| *"There is no test environment."* | ⚠️ We would be testing with live customer money. Push back. |

## What they will ask us for — have it ready

- GST number, PAN, CIN
- Our existing merchant IDs with **Google Pay Business** and **BharatPe**
- Settlement bank account details and a cancelled cheque
- A public HTTPS address for notifications (we have one)
- Expected volume: **~600 transactions and ~₹44 lakh a month**, average ticket around ₹7,000
- Business category: automobile service and spare parts (dealership)
- **How many QRs we want and where each one sits** — decide this before the call (see below)
- Locations: **2 today** — Ahmedabad (plant 5756) and Anand (plant 6370); a third possible later

## Decide before the call: how many QRs, and where

Bring a list. A sensible starting ask, per branch:

1. **Parts / counter sales** — the DEF and over-the-counter till
2. **Workshop cashier** — job-card bills
3. **A spare**, unlabelled, for a future counter or a mobile advisor

That is **6 for two branches** with room to grow. If they will give more, one per service advisor
is better still — because then the receipt tells us *who took the payment*, and that person is the
one who knows which bill it was.

If they will only give one per branch, take it — 2 is still better than the 1 we effectively have
now — but say clearly on the call that we want the option to add more later, and ask what that
would involve.

## What NOT to ask about

Keep the call tight — these invite a longer, slower sales process and are out of scope: paying
vendors / payouts / bulk transfers · bank statement feeds · loans or working-capital offers bundled
with the API · anything about cash or cheque handling.

---

# PART 2 — The questionnaire (send this)

**Context for your team, in one paragraph:**

> We are a commercial-vehicle dealership running two workshop locations. We accept UPI through
> static merchant QR codes and currently reconcile payments against workshop invoices manually,
> using CSV exports. We are building an internal tool to automate that reconciliation and would
> like to integrate directly with your APIs. Our questions are grouped below; the first group is
> the most important to us commercially.

---

## A. Static QR codes and payment identification — *our highest priority*

| # | Question | Your answer |
|---|---|---|
| A1 | ⭐ **Does the transaction record identify which QR the payment was made to?** Please name the field and send a sample API response with it populated. | |
| A2 | ⭐ **How many separate static QRs can we have?** Is there a limit per merchant account, per branch, or overall? | |
| A3 | Can we have QRs at a finer level than one per branch — e.g. one for the parts counter, one for the workshop cashier, one per service advisor? | |
| A4 | Can we **add or retire QRs later** without disturbing the existing ones? Is it self-service, or does each one need paperwork, and how long does it take? | |
| A5 | Can we attach our **own label** to each QR (e.g. "Anand – parts counter") and is that label returned by the API, or do we only get an ID we must map ourselves? | |
| A6 | Do all QRs settle into the **same bank account** and appear in a **single API feed**, or does each need its own credentials and its own calls? | |
| A7 | For a static QR, does the **customer's own note/remark** reach us through the API? | |
| A8 | We understand the offering is static QR. For completeness: is **dynamic QR** (a QR generated per bill, carrying our own invoice reference) available on any account type, and at what cost? | |
| A9 | Do you support **UPI Collect** — sending a payment request to a customer's UPI ID with our invoice number attached? *(This is our only remaining route to a payment that carries a bill reference, and would be useful for credit customers paying from their office.)* | |
| A10 | Is there any **per-QR cost** — setup, monthly, or a different MDR? | |

## B. What each transaction record contains

Please confirm which of the following you return, and the exact field name for each.

| # | Field we need | Provided? | Field name |
|---|---|---|---|
| B1 | Your transaction ID — **unique, stable, never reused** | | |
| B2 | **UTR / RRN** — the bank reference we can tie to a bank statement | | |
| B3 | **Exact amount.** Please state the format: integer paise, or a decimal string. **Not a rounded or floating-point value.** | | |
| B4 | Currency | | |
| B5 | **Timestamp with time zone / offset** — and whether it is the time the customer paid or the time it was processed | | |
| B6 | **Status**, plus the complete list of possible values and which of them mean the money has actually arrived | | |
| B7 | **Payer name** — full, or truncated? | | |
| B8 | **Payer VPA / UPI ID** | | |
| B9 | Payer mobile number | | |
| B10 | **Customer note / remark** typed at payment time | | |
| B11 | ⭐ **QR / terminal / sub-merchant identifier** — which of our QRs was scanned *(see A1; this is the single most important field in this table for us)* | | |
| B12 | The app the customer paid from | | |
| B13 | **MDR / fee charged**, and GST on it, as separate exact values | | |
| B14 | Settlement reference and settlement date | | |

> **On B3 specifically:** one of our current CSV exports rounds a derived amount to a single decimal
> place, so on rows carrying a fee it disagrees with the exact figure by up to 4 paise. We need
> values that are exact by construction. **Integer paise is our preference.**

## C. Fetching transactions ourselves (pull API)

| # | Question | Your answer |
|---|---|---|
| C1 | Is there an endpoint to **list all transactions in a date range**, independent of webhooks? *(Essential for us — see the note below.)* | |
| C2 | Can that listing be **filtered by QR / terminal**, or do we filter on our side? | |
| C3 | **Pagination:** cursor-based or offset-based? Maximum page size? Is a total count returned? | |
| C4 | What is the **largest date range** allowed in one call? | |
| C5 | **How far back** is history available? Can we backfill the last 6–12 months? | |
| C6 | **Rate limits** — calls per minute, per day, burst behaviour. Which HTTP response tells us we have hit one? | |
| C7 | How long after a payment before it appears in this API? | |
| C8 | Can a record **change after we have read it** (status, amount, fee)? If so, which fields, and how do we detect it? | |
| C9 | Is result **ordering stable**? If new payments arrive while we page through results, can we **miss or duplicate** a row? | |

> **Why C1 is non-negotiable for us:** if a webhook is lost in transit, that payment becomes
> invisible to our system and we have no way of knowing it is missing. A pull endpoint is how we
> prove, every morning, that we have every rupee.

## D. Webhooks (push notifications)

| # | Question | Your answer |
|---|---|---|
| D1 | Do you push notifications? Which **events**? | |
| D2 | **Signature scheme:** what exactly is signed (raw body? body + timestamp?), which algorithm, which header carries it? | |
| D3 | How is the webhook **secret rotated**? Can two secrets be valid at once during a changeover? | |
| D4 | **Retry policy** — how many attempts, over what period, and which response codes trigger a retry? | |
| D5 | Can the **same event arrive twice**? Is there an event ID we can de-duplicate on? | |
| D6 | Are events guaranteed to arrive **in order**? | |
| D7 | Can we **replay** missed events, or is the pull API the only recovery path? | |
| D8 | Any requirement on our endpoint — TLS version, certificate authority, response-time limit? | |

## E. Authentication and network access

| # | Question | Your answer |
|---|---|---|
| E1 | What **authentication** do you use — API key, OAuth client-credentials, mutual TLS, or a combination? | |
| E2 | ⚠️ **Do you require IP allowlisting for calls coming from us?** Our backend runs on serverless infrastructure **without a fixed outbound IP address**. If allowlisting is mandatory, what alternatives do you support (mTLS, signed requests, a wider range)? | |
| E3 | If **mTLS** is used: who issues the client certificate, how long is it valid, what is the renewal process, and is there an overlap window so we can rotate without downtime? | |
| E4 | Can we hold **two active credentials at once** so keys can be rotated with no service gap? | |
| E5 | Token lifetime and refresh mechanism. | |
| E6 | Are the API endpoints on a **stable hostname**, or should we expect it to change? | |

## F. Refunds, failures and reversals

| # | Question | Your answer |
|---|---|---|
| F1 | Can we **issue refunds** through the API? Partial refunds? | |
| F2 | How does a refund appear in the transaction feed — a negative row, a separate object, or linked to the original? | |
| F3 | **Chargebacks / disputes:** how are we notified, what is the timeline, and can a settled payment be reversed after we have banked it? | |
| F4 | Do **failed and pending** payments appear in the feed? How do we distinguish "money has arrived" from "customer attempted"? | |
| F5 | If a customer accidentally pays **twice**, do we see two independent transactions? | |
| F6 | Are there **partial settlements or holds** we should expect? | |

## G. Settlement and charges

| # | Question | Your answer |
|---|---|---|
| G1 | **Settlement cycle** — T+0, T+1? Daily cut-off time, and what happens on bank holidays? | |
| G2 | Is settlement **gross or net of MDR**? We need to record the **gross amount the customer paid** as well as the fee. | |
| G3 | Does the API expose the **settlement batch** — its own UTR, its total, and the list of transactions inside it? *(This is what lets us tie the portal to the bank statement.)* | |
| G4 | If we have multiple QRs, do they settle in **one batch or separate batches**? | |
| G5 | **MDR rate card** — by instrument type and amount band, with GST shown separately. | |
| G6 | Are there **API usage charges** — per call, per webhook, monthly platform fee, one-time setup fee, annual maintenance? | |
| G7 | Is there a **minimum volume commitment** or minimum monthly billing? | |
| G8 | Under what circumstances can the MDR or charges change, and how much notice do we get? | |

## H. Transaction limits

| # | Question | Your answer |
|---|---|---|
| H1 | **Per-transaction limit** on our merchant account, and the **per-day** limit. Is the daily limit per QR or shared across all of them? | |
| H2 | Workshop invoices can exceed ₹1 lakh. What is the correct way to collect a large amount — a higher merchant limit, or must the customer split it? | |
| H3 | Are there limits an individual **customer** may hit, and can we detect that from the API response? | |

## I. Environments and onboarding

| # | Question | Your answer |
|---|---|---|
| I1 | Is there a **sandbox / UAT environment** with test credentials, and does it behave identically to production? | |
| I2 | Can **webhooks be tested** in sandbox, including failure and retry behaviour? | |
| I3 | Full **onboarding checklist** — every document you need from us. | |
| I4 | Typical **timeline** from completed paperwork to live credentials. | |
| I5 | Does this attach to our **existing merchant QR account**, or is a new merchant ID created? | |
| I6 | ⚠️ **Will our existing QR codes keep working throughout the changeover?** We cannot have a period where customers are unable to pay. | |
| I7 | Can we run the API **alongside** our current CSV exports for a few weeks, to compare the two before switching? | |
| I8 | Who prints and supplies the physical QR standees, and what is the lead time? | |

## J. Support, documentation and change management

| # | Question | Your answer |
|---|---|---|
| J1 | Can we have the **API documentation and a Postman collection before signing**? | |
| J2 | Named **technical contact** and escalation path. Support hours and out-of-hours cover. | |
| J3 | **Uptime commitment**, and where is service status published? | |
| J4 | **API versioning:** how are breaking changes announced, how much notice, and for how long are older versions supported? | |
| J5 | How are **incidents and planned maintenance** communicated? | |
| J6 | Is there a change log we can subscribe to? | |

## K. Data, privacy and compliance

| # | Question | Your answer |
|---|---|---|
| K1 | What **personal information** comes through the API (payer name, UPI ID, mobile), and are there restrictions on how we store it? | |
| K2 | Confirmation of **data localisation** — where does transaction data reside? | |
| K3 | How long do **you** retain transaction data, and can we retrieve it for that whole period? | |
| K4 | Are there fields we are **required not to persist**? | |
| K5 | If a transaction appears successful in the API but is never settled, **where does responsibility sit**? | |
| K6 | Do you require any **security assessment, audit or certification** from us before go-live? | |

---

# PART 3 — After the call: how we decide

**1. Is the API better than the spreadsheets we already download?**
Driven by **A1, A2, A3, A7, B11**.
- If the API returns a **QR identifier** and we can have **more than one QR per branch**, then yes —
  every receipt self-attributes to a place, and for counter QRs that removes job-card invoices from
  the candidate list outright. Worth doing.
- If the API returns **no QR identifier**, the integration delivers only convenience. Still worth
  having eventually, but it is not urgent and should not displace other work.
- **If it also loses the customer's note (A7), it is a step backwards** and we should stay on the
  CSV exports.

**2. Can we build it safely?**
Driven by **C1, E2, I1**. We need all three: a pull endpoint, a workable authentication story, and
a sandbox. Missing **C1** is close to disqualifying. **E2** decides whether we need an extra piece
of infrastructure and a cost line.

**3. Does it pay for itself?**
Driven by **G5, G6, G7, A10**. Compare against what we pay Google Pay Business and BharatPe today.
Consolidating from **two providers to one** is worth something on its own — it halves the
reconciliation surface and removes an entire parser from the tool.

**Do not sign anything on the first call.** Get the answers in writing, bring them back, and we
will mark up this document with what was said.

---

## Open measurement (for us, not for the bank)

**How much is one QR per branch actually worth?** We can size it exactly, but the August Billing
Report is no longer on disk, so it has not been measured. When that file is next available, the
figure to compute is: **of the same-amount, same-day invoice collisions, what share span both
plants (5756 Ahmedabad / 6370 Anand) rather than sitting inside one?** Collisions that span both
branches are the ones a per-branch QR resolves; collisions inside one branch are untouched by it.
That number tells us whether to push hard for per-counter QRs or accept per-branch.

---

*Prepared for Paras Trucks & Buses · v2, 9 September 2026 · internal working document.*
