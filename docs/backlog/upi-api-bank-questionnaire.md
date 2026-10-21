# UPI payment APIs — what to ask the bank's technical team

> **Purpose.** Paras Trucks & Buses is being offered UPI APIs by its bank. This is the
> discovery document: what to ask, why each answer matters, and what a bad answer looks like.
>
> **Status:** v3, 2026-09-11. **Settled by the owner: a STATIC QR system, ONE QR PER BRANCH** —
> even though the bank allows as many QRs as we like. Part 2 is the part to send.
>
> Companion: `docs/backlog/service-payments-plan.md` (the tool this feeds), open item 9.

---

## How we got here — two versions withdrawn, and why

**v1 asked:** *"can a QR carry our own bill reference and hand it back?"* A static QR is a printed
sticker, identical for every customer and every bill, so nothing about the bill can travel with the
payment. **Closed.** (One confirming question survives as A7.)

**v2 argued for a QR per collection point** — parts counter, workshop cashier — on the theory that
a payment arriving on the counter QR must be a counter sale, so every job-card invoice could be
dropped from its candidate list. **Withdrawn — the owner corrected it, rightly:**

> Where a customer pays does not tell you what they bought. Someone who buys a bucket of AdBlue at
> the parts counter may pay at the counter, walk over to accounts, or be taken to the accounts
> office by a counter executive and pay there. The same QR takes payment for service invoices and
> counter invoices alike.

So a counter QR would have been **mislabelled on exactly the payments that were made somewhere
else** — and v2's proposal to *remove* job-card invoices from those payments' candidate lists would
have hidden the correct bill every single time. A person cannot pick an answer the screen does not
show them.

**v3: one QR per branch.** The QR tells us **which branch** took the money — and nothing about what
was bought.

### ⭐ The rule this sets for the tool (ours, not the bank's)

**Which QR a payment arrived on is a *ranking* signal, never a *filter*.** It moves same-branch
bills up the shortlist; it never removes the other branch's bills. Even the branch is a strong hint
rather than a certainty — a fleet owner with trucks in both workshops can settle an Ahmedabad bill
while standing in Anand, and a customer can pay from a photo of a QR sent over WhatsApp.

A filter that is right 95% of the time is not 95% useful — it is silently wrong the other 5%, on
cases nobody can see. So: rank it, and **record every confirmed match where the bill's branch
differs from the QR's branch.** The pilot will then tell us, with numbers, how reliable the branch
really is.

---

# PART 1 — For you, before the call

## What we are actually buying

Today money arrives and we find out by downloading a spreadsheet from Google Pay Business and
another from BharatPe — roughly **18–21 payments a day, about ₹44 lakh a month**. Someone then
works out which workshop bill each payment pays.

With one static QR per branch, the API buys two kinds of thing:

| | What it gives us | Worth |
|---|---|---|
| **Convenience and completeness** | Payments appear in the portal on their own, the same day, with exact amounts. Nobody has to remember to download anything, and a missing day becomes detectable. | Real, but modest. Saves minutes a day and removes a step that can be forgotten. |
| **⭐ Better clues on every payment** | Three pieces of information that make matching sharper — two of which **we do not get at all today** (see below). | This is what makes the API better than the spreadsheets, rather than just faster. |

The matching itself stays as designed: the tool shortlists, a person picks.

## ⭐ The question worth more than all the others *(revised for v3)*

> **"For every payment, does the API give us the payer's UPI ID, the customer's note, and which of
> our QRs was scanned?"**

Each of the three is a matching clue. Measured against our own July and August exports:

**1. The payer's UPI ID** (e.g. `rameshsharma@okicici`) — **we have never had this. Zero of 1,079
payments carry one.** Today we recognise a repeat payer by their *name*, and a name is a poor key:

- **13 Google Pay payments had no name at all**, including one of ₹25,000;
- two different Ramesh Sharmas look identical;
- Google Pay shortens names.

Repeat payers are common. Counting **by name** — which is exactly the unreliable part —
**40% of July+August payments came from a name that paid more than once**, and **23% of August
payments came from a name already seen in July.** Those figures are approximate *because* names
are unreliable; a UPI ID would make them exact. It is unique and never blank, so a fleet owner's
driver who paid last month would be recognised with certainty rather than guessed at.

**2. The customer's note** — the one thing the *customer* tells us. With a static QR it is the
**only** customer-supplied clue that exists. About one in five Google Pay payments carry a number in the note,
and most of those (17 of 28 in August) are the **last four digits of the vehicle's number plate** — a strong
clue, because every job-card invoice carries the registration. **BharatPe gives us no note at all
today.** If the new API drops it, matching gets *worse* than what we already have.

**3. Which QR was scanned** — this is how the branch reaches us. **Checked against our own files:
neither current export has any store, terminal, QR or outlet column.** BharatPe's only two
descriptive columns read `BharatPe QR` and `UPI` on all 303 August rows — identical. Google Pay's
`Paid via` describes the *customer's* app, not our QR. So two branch QRs could still arrive in a
feed that cannot tell them apart. **Having two QRs and having the API report them are different
things — ask for a sample API response with the field populated,** not a yes.

## ⚠️ The thing that could stop this dead

Banks very often say *"give us your server's IP address and we'll allow only that."* Our portal
backend runs on serverless infrastructure with **no fixed outbound IP address**. If IP allowlisting
is mandatory we cannot simply comply — we would need a small fixed-address server in between:
extra cost, one more thing that can break.

**Ask question E2 early and get the answer in writing.** It changes the architecture and the
budget, and it is far cheaper to know now than after signing.

## What "good" looks like, in one line

> A **fetch-by-date endpoint** returning every payment in a date range with the **exact amount**,
> the **UTR**, the **payer's name and UPI ID**, the **customer's note**, and **which QR it came in
> on** — plus a sandbox to test in.

## Red flags — what to listen for

| If they say… | What it means for us |
|---|---|
| *"We only send webhooks, there is no API to list transactions."* | ⛔ **Serious.** If one notification is lost, that payment is invisible to us forever and we cannot even know it is missing. |
| *"The customer's note is not available."* | ⚠️ A step **backwards** from Google Pay today. With a static QR it is the only clue the customer gives us. |
| *"The payer's UPI ID is not shared."* | ⚠️ We stay on name-matching for repeat payers, as today. Not fatal — but it was the biggest single improvement on offer. |
| *"The API doesn't say which QR was used."* | ⚠️ We lose the branch hint. Not fatal, but ask for it in writing. |
| *"You must give us a static IP address."* | ⚠️ Architecture change and a cost line. Get the alternatives in writing (E2). |
| *"The amount comes as a number"* — and it turns out to be rounded | ⚠️ Our current BharatPe file rounds a derived amount to one decimal; on 13 rows it misses the true figure by up to 4 paise. Small, but it is wrong money in a ledger. |
| *"There is no test environment."* | ⚠️ We would be testing with live customer money. Push back. |

## What they will ask us for — have it ready

- GST number, PAN, CIN
- Our existing merchant IDs with **Google Pay Business** and **BharatPe**
- Settlement bank account details and a cancelled cheque
- A public HTTPS address for notifications (we have one)
- Expected volume: **~600 transactions and ~₹44 lakh a month**, average ticket around ₹7,000
- Business category: automobile service and spare parts (dealership)
- **QRs: one per branch — two today**, Ahmedabad (plant 5756) and Anand (plant 6370); a third
  branch is possible later

## What NOT to ask about

Keep the call tight — these invite a longer, slower sales process and are out of scope: paying
vendors / payouts / bulk transfers · bank statement feeds · loans or working-capital offers bundled
with the API · anything about cash or cheque handling.

---

# PART 2 — The questionnaire (send this)

**Context for your team, in one paragraph:**

> We are a commercial-vehicle dealership with two workshop branches. We will accept UPI through
> one static merchant QR code per branch, and we currently reconcile payments against invoices
> manually using CSV exports. We are building an internal tool to automate that reconciliation and
> would like to integrate directly with your APIs. Our questions are grouped below; the first group
> is the most important to us.

---

## A. What travels with each payment — *our highest priority*

| # | Question | Your answer |
|---|---|---|
| A1 | ⭐ **Does each transaction record identify which of our QRs was scanned?** Please name the field and send a **sample API response with it populated**. | |
| A2 | ⭐ **Does each transaction include the payer's UPI ID (VPA)?** Is it ever masked or withheld — for example for certain apps or banks? | |
| A3 | ⭐ **Does the customer's own note / remark reach us through the API**, in full? | |
| A4 | Can we **add a QR later** (for a new branch) without disturbing the existing ones? What is the process and how long does it take? | |
| A5 | Can we attach our **own label** to each QR (e.g. "Anand"), and is that label returned by the API — or do we only get an ID that we map ourselves? | |
| A6 | Do all our QRs settle into the **same bank account** and appear in a **single API feed**, or does each need its own credentials and its own calls? | |
| A7 | For completeness: is **dynamic QR** (generated per bill, carrying our own invoice reference) available on any account type, and at what cost? | |
| A8 | Do you support **UPI Collect** — sending a payment request to a customer's UPI ID with our invoice number attached? *(Useful for credit customers who pay from their office.)* | |
| A9 | Is there any **per-QR cost** — setup, monthly, or a different MDR? | |

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
| B7 | **Payer name** — full, or shortened? | | |
| B8 | ⭐ **Payer VPA / UPI ID** *(see A2)* | | |
| B9 | Payer mobile number | | |
| B10 | ⭐ **Customer note / remark** typed at payment time *(see A3)* | | |
| B11 | ⭐ **QR / terminal / sub-merchant identifier** — which of our QRs was scanned *(see A1)* | | |
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
| C2 | Can that listing be **filtered by QR**, or do we filter on our side? | |
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
| G4 | Do our two QRs settle in **one batch or separate batches**? | |
| G5 | **MDR rate card** — by instrument type and amount band, with GST shown separately. | |
| G6 | Are there **API usage charges** — per call, per webhook, monthly platform fee, one-time setup fee, annual maintenance? | |
| G7 | Is there a **minimum volume commitment** or minimum monthly billing? | |
| G8 | Under what circumstances can the MDR or charges change, and how much notice do we get? | |

## H. Transaction limits

| # | Question | Your answer |
|---|---|---|
| H1 | **Per-transaction limit** on our merchant account, and the **per-day** limit. Is the daily limit per QR or shared? | |
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
Driven by **A1, A2, A3** (fields B8, B10, B11).
- **UPI ID + note + QR** → clearly better. Repeat payers are recognised exactly, the customer's
  clue survives, and the branch arrives as a ranking hint.
- **Note but no UPI ID** → still better than today (convenience, completeness, branch), and
  repeat-payer recognition stays name-based, as it is now.
- **No note** → a step backwards from Google Pay. Weigh carefully before consolidating onto it.

**2. Can we build it safely?**
Driven by **C1, E2, I1**. We need all three: a pull endpoint, a workable authentication story, and
a sandbox. Missing **C1** is close to disqualifying. **E2** decides whether we need an extra piece
of infrastructure and a cost line.

**3. Does it pay for itself?**
Driven by **G5, G6, G7, A9**. Compare against what we pay Google Pay Business and BharatPe today.
Consolidating from **two providers to one** is worth something on its own — it halves the
reconciliation surface and removes an entire parser from the tool.

**Do not sign anything on the first call.** Get the answers in writing, bring them back, and we
will mark up this document with what was said.

---

## Open measurements (for us, not for the bank)

1. **How useful is the branch hint?** Size it from the Billing Report: of the same-amount, same-day
   invoice collisions, what share span **both** plants (5756 / 6370) rather than sitting inside one?
   Only cross-branch collisions are sharpened by knowing the branch. **Not yet measured** — the
   August Billing Report is no longer on disk.
2. **How reliable is the branch hint?** Only the pilot can say. Log every confirmed match where the
   bill's plant differs from the QR's branch; that rate is the honest answer to "could this ever be
   tightened into a filter?" (Default answer: no.)

---

*Prepared for Paras Trucks & Buses · v3, 11 September 2026 · internal working document.*
