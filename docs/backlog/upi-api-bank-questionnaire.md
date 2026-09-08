# UPI payment APIs — what to ask the bank's technical team

> **Purpose.** Paras Trucks & Buses is being offered UPI APIs by its bank. This is the
> discovery document: what to ask, why each answer matters, and what a bad answer looks like.
>
> **Status:** prepared 2026-09-08, before the first technical call. Nothing here commits us to
> anything. **Part 2 is the part you send them.**
>
> Companion: `docs/backlog/service-payments-plan.md` (the tool this feeds), open item 9
> ("UPI source consolidation → single provider → API").

---

# PART 1 — For you, before the call

## What we are actually buying

Today, money arrives and we find out about it by downloading a CSV from Google Pay Business and
another from BharatPe. Roughly **18–21 payments a day, about ₹44 lakh a month** between the two.
Someone then works out which workshop bill each payment pays.

An API changes **two different things**, and they are worth wildly different amounts:

| | What it fixes | Worth |
|---|---|---|
| **The boring win** | No more downloading and uploading CSVs. Payments appear in the portal on their own. | Saves a few minutes a day. Nice. |
| **⭐ The real win** | If the bank can put **our own bill reference inside the QR code** and give it back to us with the payment, then a payment arrives already knowing which bill it pays. | **Removes most of the work the entire tool exists to do.** |

So there is one question that matters more than all the rest, and it should be asked in the first
five minutes.

## ⭐ The question worth more than all the others

> **"Can we generate a QR code per bill that carries our own reference number, and will that
> reference come back to us with the payment?"**

Here is why. We measured it. In August, the amount **₹1,930** appeared on **114 different bills**
— on the worst day, **17 identical ₹1,930 bills**. SAP gives us the bill date but never the time,
and it never will. So when ₹1,930 lands in the merchant account, nothing in the world tells us
which of those 17 bills it paid except a human who remembers.

If the payment carries our bill number, that problem disappears entirely.

If it does not, the API is still worth having — but it is a **convenience upgrade, not a solution**,
and the matching tool we have built stays exactly as designed.

**Everything in Section A of the questionnaire is about this.** Do not let it get buried under
the authentication discussion.

## The one thing that could stop this dead

Banks very often say: *"tell us your server's IP address and we'll allow only that."*

Our portal backend runs on serverless infrastructure that **does not have a fixed outbound IP
address**. If IP allowlisting is mandatory, we cannot simply comply — we would need to put a
small fixed-address server in between, which is extra cost and one more thing that can break.

**Ask this early (question E2), and get the answer in writing.** It changes the architecture and
the budget, and it is much cheaper to know now than after the contract is signed.

## What "good" looks like, in one line

> A **fetch-by-date endpoint** we can call to list every payment in a date range, returning the
> **exact amount**, the **UTR**, the **payer's name and UPI ID**, the **customer's note**, and
> **our own reference** — plus a sandbox to test it in.

If we get that, the integration is straightforward and safe.

## Red flags — what to listen for

| If they say… | What it means for us |
|---|---|
| *"We only send webhooks, there is no API to list transactions."* | ⛔ **Serious.** If one webhook is lost, that payment is invisible to us forever and we have no way to even know it is missing. We must be able to ask "what came in yesterday?" |
| *"You must give us a static IP address."* | ⚠️ Architecture change. Get the alternatives in writing (see E2). |
| *"The amount comes as a number"* — and it turns out to be rounded | ⚠️ Our current BharatPe file rounds one of its amounts to a single decimal place; on 13 rows it disagrees with the true figure by up to 4 paise. Small, but it is wrong money in a ledger. We need **exact** values. |
| *"There is no test environment."* | ⚠️ We would be testing with live customer money. Push back. |
| *"The customer's note is not available."* | ⚠️ Google Pay's note is one of our best signals today — a quarter of them carry a number the customer typed. Losing it makes matching **worse** than the CSV we already have. |
| *"You cannot put your own reference in the QR."* | ⚠️ Not fatal, but it means the big prize is off the table. Say so plainly in the internal note afterwards. |

## What they will ask us for — have this ready

- GST number, PAN, and CIN
- Our existing merchant IDs with **Google Pay Business** and **BharatPe**
- Settlement bank account details + a cancelled cheque
- A public HTTPS address for webhooks (we have one)
- Expected volume: **~600 transactions and ~₹44 lakh a month**, average ticket around ₹7,000
- Business category: automobile service and spare parts (dealership)
- Number of locations: **2 for now** (Ahmedabad and Anand), with a third possible later

## What NOT to ask about

Keep the call tight. These are **out of scope** and asking will invite a longer, slower sales
process:

- Paying vendors / payouts / bulk transfers
- Bank statement feeds (a different product; possibly useful much later)
- Loans, credit lines, or working-capital offers bundled with the API
- Anything about cash or cheque handling

---

# PART 2 — The questionnaire (send this)

**Context for your team, in one paragraph:**

> We are a commercial-vehicle dealership running two workshop locations. We currently accept UPI
> through merchant QR codes and reconcile payments against workshop invoices manually, using CSV
> exports. We are building an internal tool to automate that reconciliation and would like to
> integrate directly with your APIs. Our questions below are grouped; the first group is the most
> important to us commercially.

---

## A. Reference numbers and QR codes — *our highest priority*

| # | Question | Your answer |
|---|---|---|
| A1 | Can we generate a **dynamic QR code per bill** through your API, carrying a **merchant reference of our own** (our invoice number)? | |
| A2 | What is the **name, maximum length and permitted character set** of that reference field? | |
| A3 | Is that reference **returned verbatim** in both the transaction-listing API and the webhook? | |
| A4 | Can a dynamic QR be **amount-locked**, **single-use**, and **given an expiry**? What happens if a customer pays an expired QR? | |
| A5 | Do you support **UPI Collect** (we send a payment request to a customer's UPI ID) with the same merchant reference? | |
| A6 | For payments made to a **static** QR (our situation today), does the **customer's own note/remark** reach us through the API? | |
| A7 | Can we have a **separate QR / sub-merchant / terminal identifier per branch**, and does the API tell us which one was paid? | |
| A8 | Is there any per-QR or per-reference **generation limit** (per day, per month) or cost? | |

## B. What each transaction record contains

Please confirm which of the following you return, and the exact field name for each.

| # | Field we need | Provided? | Field name |
|---|---|---|---|
| B1 | Your transaction ID — **unique, stable, and never reused** | | |
| B2 | **UTR / RRN** — the bank reference we can tie to a bank statement | | |
| B3 | **Exact amount.** Please state the format: integer paise, or a decimal string. **Not a rounded or floating-point value.** | | |
| B4 | Currency | | |
| B5 | **Timestamp with time zone/offset** — and whether it is the time the customer paid or the time it was processed | | |
| B6 | **Status**, plus the complete list of possible status values and which of them mean the money has actually arrived | | |
| B7 | **Payer name** — full, or truncated? | | |
| B8 | **Payer VPA / UPI ID** | | |
| B9 | Payer mobile number | | |
| B10 | **Customer note / remark** typed at payment time | | |
| B11 | Our merchant reference (from A1) | | |
| B12 | The app the customer paid from | | |
| B13 | **MDR / fee charged**, and GST on it, as separate exact values | | |
| B14 | Settlement reference and settlement date | | |
| B15 | Store / terminal / sub-merchant ID (from A7) | | |

> **On B3 specifically:** one of our current CSV exports rounds a derived amount to a single decimal
> place, so on rows carrying a fee it disagrees with the exact figure by up to 4 paise. We need
> values that are exact by construction. **Integer paise is our preference.**

## C. Fetching transactions ourselves (pull API)

| # | Question | Your answer |
|---|---|---|
| C1 | Is there an endpoint to **list all transactions in a date range**, independent of webhooks? *(This is essential for us — see the note below.)* | |
| C2 | **Pagination:** cursor-based or offset-based? Maximum page size? Is a total count returned? | |
| C3 | What is the **largest date range** allowed in one call? | |
| C4 | **How far back** is history available? Can we backfill the last 6–12 months? | |
| C5 | **Rate limits** — calls per minute, per day, and burst behaviour. What HTTP response tells us we have hit one? | |
| C6 | How long after a payment before it appears in this API? | |
| C7 | Can a record **change after we have read it** (status, amount, fee)? If so, which fields, and how do we detect it? | |
| C8 | Is result **ordering stable**? If new payments arrive while we are paging through results, can we **miss or duplicate** a row? | |

> **Why C1 is non-negotiable for us:** if a webhook is lost in transit, that payment becomes
> invisible to our system and we have no way of knowing it is missing. A pull endpoint is how we
> prove, every morning, that we have every rupee.

## D. Webhooks (push notifications)

| # | Question | Your answer |
|---|---|---|
| D1 | Do you push notifications? Which **events**? | |
| D2 | **Signature scheme:** what is signed (raw body? body + timestamp?), which algorithm, which header carries it? | |
| D3 | How is the webhook **secret rotated**? Can two secrets be valid at once during a changeover? | |
| D4 | **Retry policy** — how many attempts, over what period, and which response codes trigger a retry? | |
| D5 | Can the **same event arrive twice**? Is there an event ID we can de-duplicate on? | |
| D6 | Are events guaranteed **in order**? | |
| D7 | Can we **replay** missed events, or is the pull API the only recovery path? | |
| D8 | Any requirement on our endpoint — specific TLS version, certificate authority, response time limit? | |

## E. Authentication and network access

| # | Question | Your answer |
|---|---|---|
| E1 | What **authentication** do you use — API key, OAuth client-credentials, mutual TLS, or a combination? | |
| E2 | ⚠️ **Do you require IP allowlisting for calls coming from us?** Our backend runs on serverless infrastructure **without a fixed outbound IP address**. If allowlisting is mandatory, what alternatives do you support (mTLS, signed requests, a wider range)? | |
| E3 | If **mTLS** is used: who issues the client certificate, how long is it valid, and what is the renewal process? Is there an overlap window so we can rotate without downtime? | |
| E4 | Can we hold **two active credentials simultaneously** so keys can be rotated with no service gap? | |
| E5 | Token lifetime and refresh mechanism. | |
| E6 | Are the API endpoints on a **stable hostname**, or should we expect them to change? | |

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
| G1 | **Settlement cycle** — T+0, T+1? What is the daily cut-off time, and what happens on bank holidays? | |
| G2 | Is settlement **gross or net of MDR**? We need to record the **gross amount the customer paid** as well as the fee. | |
| G3 | Does the API expose the **settlement batch** — its own UTR, its total, and the list of transactions inside it? *(This is what lets us tie the portal to the bank statement.)* | |
| G4 | **MDR rate card** — by instrument type and amount band, with GST shown separately. | |
| G5 | Are there **API usage charges** — per call, per webhook, per QR generated, monthly platform fee, one-time setup fee, annual maintenance? | |
| G6 | Is there any **minimum volume commitment** or minimum monthly billing? | |
| G7 | Under what circumstances can the MDR or the charges change, and how much notice do we get? | |

## H. Transaction limits

| # | Question | Your answer |
|---|---|---|
| H1 | **Per-transaction limit** on our merchant account, and the **per-day** limit. | |
| H2 | Workshop invoices can exceed ₹1 lakh. What is the correct way to collect a large amount — a higher merchant limit, or must the customer split it? | |
| H3 | Are there limits we should expect an individual **customer** to hit, and can we detect that from the API response? | |

## I. Environments and onboarding

| # | Question | Your answer |
|---|---|---|
| I1 | Is there a **sandbox / UAT environment** with test credentials, and does it behave identically to production? | |
| I2 | Can **webhooks be tested** in sandbox, including failure and retry behaviour? | |
| I3 | Full **onboarding checklist** — every document you need from us. | |
| I4 | Typical **timeline** from completed paperwork to live credentials. | |
| I5 | Does this attach to our **existing merchant QR account**, or is a new merchant ID created? | |
| I6 | ⚠️ **Will our existing QR codes keep working throughout the changeover?** We cannot have a period where customers cannot pay. | |
| I7 | Can we run the API **alongside** our current CSV exports for a few weeks, so we can compare the two before switching? | |

## J. Support, documentation and change management

| # | Question | Your answer |
|---|---|---|
| J1 | Can we have the **API documentation and a Postman collection before signing**? | |
| J2 | Named **technical contact** and escalation path. Support hours, and out-of-hours cover. | |
| J3 | **Uptime commitment**, and where is service status published? | |
| J4 | **API versioning:** how are breaking changes announced, how much notice do we get, and for how long are older versions supported? | |
| J5 | How are **incidents and planned maintenance** communicated? | |
| J6 | Is there a change log we can subscribe to? | |

## K. Data, privacy and compliance

| # | Question | Your answer |
|---|---|---|
| K1 | What **personal information** comes through the API (payer name, UPI ID, mobile), and are there restrictions on how we store it? | |
| K2 | Confirmation of **data localisation** — where does transaction data reside? | |
| K3 | How long do **you** retain transaction data, and can we retrieve it for that whole period? | |
| K4 | Are there fields we are **required not to persist**? | |
| K5 | If a transaction appears as successful in the API but is never settled, **where does responsibility sit**? | |
| K6 | Do you require any **security assessment, audit or certification** from us before go-live? | |

---

# PART 3 — After the call: how we decide

The answers split into three buckets. Write the answer next to each and the decision follows.

**1. Does it solve the matching problem?**
Driven by **A1, A2, A3, A6**.
- *Yes* → we build per-bill QR codes and the matching workload largely disappears. This becomes a
  priority project, ahead of other work.
- *No* → the API is a convenience upgrade only. Worth doing, but it does not change the tool's
  design, and it should be scheduled accordingly (Phase C in the plan).

**2. Can we build it safely?**
Driven by **C1, E2, I1**.
- Need all three: a pull endpoint, a workable authentication story, and a sandbox.
- Missing **C1** is close to disqualifying. Missing **I1** means a slower, riskier rollout.
- **E2** determines whether we need an extra piece of infrastructure — and a cost line.

**3. Does it pay for itself?**
Driven by **G4, G5, G6**.
- Compare total cost against what we pay Google Pay Business and BharatPe today.
- Note that consolidating from **two providers to one** is worth something on its own: it halves
  the reconciliation surface and removes an entire parser.

**Do not sign anything on the first call.** Get the answers in writing, bring them back, and we
will mark up this document with what was said.

---

*Prepared for Paras Trucks & Buses · 2026-09-08 · internal working document.*
