# Credit release, invoice sending and the gate app — plan v0.2 (2026-10-24)

> **Status (2026-10-26): step 1 BUILT (branch `cr1-invoice-send`, PR #140 open, not merged) and step 2 BUILT
> (branch `cr2-release-gate`), both STAGING only** — see "Step 1 — as built" and "Step 2 — as built" below.
> 2026-10-27: step 2 seen working in the browser; the gate screen became a list with a search (owner).
> Steps 3–4 not started. Owner's proposal of 2026-10-24, related to the Service Payments tool
> (`docs/backlog/service-payments-plan.md`, parked waiting on HDFC) but **built and shipped on its own** —
> the payments database does NOT go to prod for this (owner). Every number below was measured from material
> the owner supplied that day; nothing here is assumed. No customer names, phone numbers, PANs or plates are
> recorded in this file — the sources stay outside the repo.
>
> v0.1 → v0.2: the owner answered the six open questions (see "Owner decisions"); the design below follows.

## Part 1 — the story in plain words

Today a credit vehicle leaves the workshop like this: the service team posts a photo of the invoice in the
WhatsApp group "Vehicle Gate Pass" with the vehicle number, customer and amount, tags the GM and the owner,
and waits for "Ok pls release the vehicle". The guard lets it out. Any promise that came with the release
("payment by EOD by cheque", "Mohit has taken responsibility") stays in the chat, and nobody follows it up.

The new way:

1. **Service uploads the invoice PDF** in the portal. The portal reads the bill number, amount, customer,
   customer code, mobile number and vehicle number from the PDF itself — nobody types them.
2. **The customer receives the invoice** on WhatsApp and by email: the invoice number, the amount, the PDF
   attached, and a short thank-you for having their vehicle worked on at our workshop.
3. **If the vehicle is leaving unpaid, one tap asks for release.** The request already carries the invoice,
   the amount, and the customer's earlier credit releases still unpaid.
4. **The GM or the owner approves or holds**, and on approval may record *"promised by"* and *"who is
   responsible"*.
5. **The guard's phone shows a list of the vehicles that may go**, with a search: vehicle number, customer name,
   until when (owner, 2026-10-27). Tap one, or type the number → green "RELEASE" or red "HOLD" — the only two words. No amounts.
6. **When a promised date passes unpaid**, it appears on a follow-up list for the GM and the owner. Accounts
   marks a release paid when the money arrives.

Paid vehicles do not change: accounts issues their gate pass as today, and the guard does not look at the
app for them. Counter credit sales get the invoice sent, with no gate step.

## Owner decisions (2026-10-24)

| Question | Decision |
|---|---|
| Which vehicles does the guard app cover? | **Credit vehicles only.** Paid ones keep accounts' gate pass. |
| Who approves a credit release? | **Only the GM or the owner.** |
| Are SAP invoices digital PDFs? | **Yes** — confirmed on three samples (below). |
| How is email sent? | **From `accounts.guj@parastrucks.in`** (Google Workspace) with an app password, as the automation reports already are. |
| What does the guard see? | **"May go / hold" only.** The database needs a way to create security-guard logins. |
| Payments database on prod for this? | **No.** This feature stands on its own. |
| WhatsApp route | **WhatsApp Business API** (automatic sending). |
| Guard logins | **One per guard.** |
| Customer message | **Invoice number + amount + the invoice PDF attached + a thank-you** for getting the vehicle worked on at our workshop. (No gate-pass QR.) |
| Counter credit sales (no vehicle) | **Send the invoice; no gate step.** |
| CRM | **Nothing now** — kept as the future roadmap below. |

## Measured — the "Vehicle Gate Pass" WhatsApp group (31 Aug → 24 Oct 2026, 593 messages)

| Measured | Result |
|---|---|
| Release requests | **150 in 54 days ≈ 2.8 a day** (max 9 in a day) |
| Who approves | **GM 116, owner 8** of the requests with a matched reply (≈94% GM) |
| Time to reply | **median 6 min**, 75% within 16 min, 90% within 45 min; 7 over an hour, longest ~16 h (overnight) |
| When requests come | clusters 12–13 h and 15–20 h |
| Amounts | median ₹9.8k · 90% under ₹39.6k · largest ₹2.17 L · **₹28.5 L released on credit in 54 days** |
| Customers | ~94 customers, 124 vehicles; **15 repeat customers = 42% of requests** |
| Request content | a fixed template: vehicle no. · customer · payable amount · "mail done" (55%) · invoice photo (53%) |
| Approvals with a condition | ~1 in 10 — a payment promise (18 messages: EOD, a date, cheque) or a named person taking responsibility (10) |
| "Outstanding / previous dues" | comes up **41 times** — the GM asks before approving |
| Explicit refusals | 1 phrase in 54 days; holds happen as "send the customer the past outstanding, wait for their confirmation" |
| Other traffic | about half the group is payment chasing (proofs, "note down", ledgers) — Service Payments territory |

What this settles: **volume is low and answers are fast**, so one tap from a phone notification is enough — no
escalation rules. **The value is not the "yes"** (6 minutes today) but the two things the chat loses: what the
customer already owes at the moment of approval, and the promise made with it.

## Measured — the SAP invoice PDFs (3 samples, read with the portal's own `pdfjs-dist` 4.10)

All three are **digital** (producer "SAP NetWeaver 758"), so every value is read exactly — no OCR, no AI.
There are two layouts, each named by its SAP form:

**Counter sale** — form `ZSF_RETAIL_INVOICE_GST_NEW`, 1 page:
labelled fields `DLR INVOICE NO` (e.g. `MCI…`), `INVOICE DATE`, `SAP INVOICE NO`, `DEALER REF NO`, customer
name **with the SAP customer code in round brackets**, `Mob No`, `CUSTOMER PAN`, `GSTIN`, `SALES PERSON`,
**`PAYMENT TERMS : CREDIT`**, line items, `Grand Total(INR)`, amount in words. No vehicle number (none exists).

**Workshop job** — form `ZDBMF_COVERING_LETTER_001`, 6 pages:
page 1 is an **"INVOICE SUMMARY"** for the whole job — `JOB CARD NO`, `JOB CARD DATE`, `ORDER NUMBER`,
customer **with the SAP code in square brackets**, `Mob No`, `ORDER TYPE`, model, chassis, engine,
**`REGN. NO`**, and **every bill of the job** (labour `L…` + parts `P…`) with its amount and a **grand
total**. Pages 2–6 are the individual tax invoices, each with its own number, date, customer, PAN, GSTIN
and grand total.

Facts that shape the design:
- **Labour + parts = the summary grand total** on both workshop samples, and each bill's own grand total
  matches its summary line — a built-in check that the reading was right.
- ⚠️ *Corrected 2026-10-25 while building the reader:* each bill's own tax-invoice pages DO print a title
  **"CASH BILL" / "CREDIT BILL"**, and on both samples it agrees with the series (LCS → cash, LCR → credit).
  The reader records it per bill. It does not change the decision below — the owner noted credit releases
  are not always credit bills, so a person still raises the release.
- **The workshop job has no "payment terms" field.** Cash or credit shows only in the series prefix
  (`LCS`/`PCS` cash, `LCR`/`PCR` credit — the payments plan measured this correlation). One sample was
  cash-series, one credit-series. **So the release request is raised by a person, not inferred from the
  series** — the owner noted credit releases are not always credit-series bills.
- **Both workshop samples were "Warranty Order" job cards billed to the customer** — the same thing the
  payments plan found (`Split Order Type`, not the job number, decides what is payable).
- ⭐ **Two different SAP customer codes carried the same PAN and GSTIN** (a counter-sale customer and a
  workshop customer), while the third sample printed its own. **Same PAN/GSTIN under two SAP codes = one
  legal entity** — a strong hint for customer grouping (here and in the payments tool, whose only grouping
  hints today are weak; "shared vehicle registration" measured zero). Worth measuring across the Billing Report.

## Part 2 — design

### Standalone, but ready to join payments later
The payments tables stay on staging (owner). This feature gets **its own small set of tables, prefixed
`gate_`** — the payments migrations already create `customers` and `service_invoices`, so those names must
stay free or the payments rollout would fail on prod. Each row carries the keys payments uses — **SAP
customer code** and **bill number** — so when payments does go live, its tables link to these instead of
duplicating them.

Sketch (to be red-teamed before any migration):
- `gate_documents` — one uploaded PDF: layout (SAP form name), job card / invoice number, date, SAP customer
  code, customer name as printed, mobile, PAN/GSTIN, registration number (workshop), every bill with its
  amount, the grand total, the storage path, who uploaded it and when.
- `gate_messages` — every send (WhatsApp / email): to whom, which document, the provider's message id,
  status (sent / delivered / read / failed), error text.
- `gate_releases` — one request per vehicle exit: the document(s), requested by, status (asked / approved /
  held), decided by + when, promised-by date, responsible person, note, paid-at + by whom (accounts).
- Guards read only a narrow view (registration → may go / hold, with the decision time) — never the tables.

What the approval card can show **without** the payments data: the customer's **earlier releases still
marked unpaid** (count, total, oldest, any broken promise) and their history of releases. It **cannot** show
Busy's full ledger balance — only what passed through this tool since it started. This is said on the card,
so nobody mistakes it for the Busy figure.

### Reading the PDF
- In the browser with `pdfjs-dist` (already loaded for brochure covers) — the file is read before it leaves
  the device; it is then stored in a **private** Supabase Storage bucket.
- Recognise the layout **by its SAP form name** (PDF metadata) and its labels; an unknown form is refused,
  not guessed.
- Read labelled fields, not positions; check labour + parts = summary total and each bill's own total; amount
  in words as a second check on the counter sale. A file that fails a check is refused with the reason.
- The same bill uploaded twice is recognised by its bill number, not stored twice.

### Sending (WhatsApp Business API + Gmail)
- **WhatsApp Business API** (owner). One **utility template** with a **document header** (the invoice PDF)
  and variables: customer name, vehicle number, total. Wording follows the email's rules (2026-10-25, see
  "Step 1 — as built"): no invoice numbers, the plate, one total, and the timely-payment ask — final text to be
  approved by the owner and then by Meta. Sent from an Edge Function through Meta's Cloud
  API; delivery and read receipts come back by webhook into `gate_messages`.
- **Owner-side setup the API needs first:** a **Meta Business account, verified**; a **phone number not used
  on the normal WhatsApp app** (a new number, or one moved off the app); the template approved by Meta. Meta
  charges a small amount per message (check the current rate for utility messages in India).
- **Email:** the same content, PDF attached, sent **from `accounts.guj@parastrucks.in`** with an app password kept as an
  Edge Function secret, over **SMTPS port 465** (`smtp.gmail.com`). Checked 2026-10-24: `parastrucks.in` mail is
  **Google Workspace** (MX `aspmx.l.google.com`), SPF `include:_spf.google.com` and Google DKIM are both in
  place, so mail sent this way passes both; **no DMARC record** (optional — `p=none` to start would add
  protection against spoofing). The account needs 2-Step Verification on to create an app password, and the
  Workspace admin must allow app passwords. ⚠️ Supabase Edge Functions **block outbound ports 25 and
  587** (Supabase docs, *Functions → Limits*), so 465 is the route. Gmail allows ~500 recipients/day (free) or
  2,000 (Workspace); volume is ~30 bills/day. Not yet proven live — the first thing to try.
- Recipient: the mobile and email on the invoice; staff can correct a number before sending, and the
  correction is remembered for that SAP customer code.

### Approval
- A request = vehicle + the job's bills + who asked. One tap from the uploaded invoice.
- Approve / Hold, by the **GM or the owner only** — enforced in the Edge Function, the same way
  `authority.ts` does for payments (the screen hiding a button is never the control).
- Optional on approve: **promised by (date)** and **responsible person**. Hold takes a note.
- The GM and owner are notified (web push from the portal; a WhatsApp ping to them is possible through the
  same API).
- Every decision is audited: who, when, and what the card showed at that moment.

### The gate screen and guard logins
- **One login per guard** (owner). A new **Security department** (code `security`) with a single route.
- ⚠️ **Guards must be exempt from the "every user has at least one brand" rule** (`userShape.js` + the
  `admin-users` shape gate). A brand row is an **authorization input**: it opens the catalog, quotations and
  proforma invoices to RLS, and the **`hdh` brand would sync the guard into the ERP**. A guard gets an outlet
  (their gate) and **no brand**; the exemption is written into the shape rule like the Back Office GM one.
  Check every RLS policy that keys on brand or entity alone before the first guard account exists.
- Screen: type the vehicle number → **green "may go — released on credit by {GM/owner} at {time}"** or
  **red "hold — not released"**. No amounts. *(2026-10-27, owner: the screen leads with a **list** of the
  vehicles that may go and those waiting for the GM, with a search — "easier for the guards" — and each row
  carries the **customer name**. See "Step 2 — as built".)*
- Installable on the guard's phone ("Add to Home screen"); large type, works in sunlight.
- Every lookup is logged (which guard, which vehicle, when) — the record of what left the gate.

### Follow-up list
Approved releases with a promise date: overdue first, with the responsible person. **Accounts marks a release
paid** when the money arrives (until the payments tool is live and can do it by matching).

## Build order (owner, 2026-10-24: WhatsApp last)

1. **Invoice upload + reading + email** — useful on its own; proves the reader on real files.
2. **Release request + approval + gate screen + guard logins** (with the brand exemption).
3. **Promises, "mark paid" and the follow-up list.**
4. **WhatsApp Business API sending — last** (owner). The Meta setup below is only needed by then; until
   it lands, customers get the invoice by email.

Each step: say what it pushes down a screen (TIV lesson); prove on staging; prod only with the owner.

## Open — owner-side (items 1–2 only needed for the last step)

1. **Meta setup for the Business API:** a verified Meta Business account and a dedicated number. (The owner
   was unsure on 2026-10-24 whether a WhatsApp Business number exists.)
2. **Template wording** — approve the thank-you text before it goes to Meta.
3. ~~The Gmail ID~~ → **`accounts.guj@parastrucks.in`** (owner, 2026-10-24). Its **app password** is entered by the
   owner as an Edge Function secret when step 1 is built — never in chat.

## Future roadmap (owner: nothing now)
- **CRM:** contact history per customer, follow-ups, service reminders.
- **Join the payments tool** when it goes live: releases marked paid by matching, the full outstanding on the
  approval card, and customer groups seeded from shared PAN/GSTIN.
- Ledger statements to customers on the same WhatsApp/email channel (already planned in the payments tool).
- **A question-asking assistant over MCP** (owner asked 2026-10-25, "what if we put a bot on this using an MCP
  server?"). Fits as a READ-ONLY helper for the GM/owner — "what does this customer still owe on credit
  releases?", "which promises are overdue?" — answering through tools that only read, with the asker's own
  permissions. Best after step 3 (promises), alongside the CRM.
  **Not** as the invoice reader: an AI reader misreads a number with full confidence, sends PAN/GSTIN/mobile to
  an outside service on every upload and costs per call. The exact reader either reads everything and passes
  every cross-check or refuses. A possible later fallback: only when the exact reader refuses a file, an AI
  proposes the values, they go through the same checks, and a person confirms before anything is sent.

## Step 1 — as built (2026-10-25, branch `cr1-invoice-send`, staging only)

**What a user does:** Service Tools → **Send Invoice** (also on the phone's + sheet) → choose the SAP PDF →
the screen shows what was read (customer, SAP code, mobile, vehicle, job card / invoice, every bill with cash /
credit, the total, the checks that passed) → type or confirm the customer's email → **Save and email**.
Below: the last 30 invoices with their PDF and send status, and "Email / Send again".
Who: service, spares, accounts (all tiers, both companies) and the admin.

**The reader** (`src/invoices/lib/sapInvoice.js`, runs in the browser):
- knows the two SAP forms by the name in the PDF; anything else, a scan, or a failed check is **refused with
  the reason — never guessed**;
- reads every value **by its label**, never by position; labels match regardless of capital letters, spacing
  or a trailing colon, so a re-styled form keeps working. A **renamed** label is refused (a one-line fix here);
- checks: bills = the summary total · every page of every bill names the summary's customer code · each bill's
  own total, in figures and in words, equals the summary line · counter total = amount in words.
- **Owner's question "what if the invoice changes a little?"** — answered by `scripts/invoices/selftest-sap-invoice.mjs`
  (**120/0** with the three real samples): restyled copies (Title Case, colons, spacing, extra lines, new header
  lines) read **exactly the same**; renamed labels, a missing bill, another form or another customer code on one
  page are **refused**; and changing any one printed amount (428 amounts tried across the five PDFs) **never
  produced different money** — it is refused or reads the same. Nine planted bugs each fail the test.

**The server** (Edge Function `gate-invoices`, staging): re-checks the reading (shapes, dates, bills = total),
picks the company by the **seller GSTIN on the invoice** (staff file only their own company's), stores the PDF in
a private bucket, and writes the job and its bills in one step. The same PDF again returns the first save;
different bills under the same job card, or a bill already on another job, are refused and nothing is saved.
Email: one address, refused if it could add a header; a repeated click never sends twice; the same address
again within 2 minutes is refused; the address is remembered for that SAP customer code once a send succeeds.
⚠️ **The server does not re-read the PDF itself** — it trusts the browser's reading after re-checking it. The
stored PDF is the record. Reading it on the server too is possible later (pdfjs in the function) if wanted.

**Email** goes from `accounts.guj@parastrucks.in` through `smtp.gmail.com:465` by a small SMTP client of our
own (`smtp.ts`; Edge Functions block 25/587). Tested offline against a scripted mail server
(`selftest-gate-mail.mjs` **60/0**: byte-by-byte replies, wrong password, unknown address, silent server,
dropped connection; the PDF comes back byte for byte from the message; the password never appears in an error).
**Wording — revised to the owner's rules (2026-10-25):** no invoice, job card or bill numbers anywhere (subject, body,
attachment name) — the vehicle's registration number is what the customer cares about; only the TOTAL, highlighted
(a large bold amount in a shaded box); no labour / parts split; signed off like the company's own mails (Kind regards ·
**Accounts Team** · *Paras Trucks and Buses* · the Paras logo · Sanathal address · Mobile +91 74969 70321 (the dealer
number SAP prints on every invoice — ✅ confirmed by the owner) · "Authorized Dealer -" + the Ashok Leyland logo). Logos are
embedded in the email (not linked), so they show even where outside images are blocked. Workshop subject: *"Invoice for
your vehicle GJ01ZZ0001 – Paras Trucks and Buses"*, body *"Dear {Customer}, Thank you for getting your vehicle {plate}
serviced at our workshop. Please find your invoice attached."* + TOTAL AMOUNT box, attachment *"Invoice {plate}.pdf"*.
Counter sale: *"Your invoice from Paras Trucks and Buses"*, *"Thank you for your purchase …"*, attachment *"Invoice
{date}.pdf"*. SAP's capitals become a proper name ("Dear Shree Hari Bus Services"). HTML + a plain-text twin.
Seen in the ceo@ inbox 2026-10-25 (Inbox, not Spam).
**Timely payment — added at the owner's word (2026-10-25):** *"this feature will mostly be used for sending invoices
for the vehicles that are being released on credit … the message [must contain] information about making timely
payments, and without them, we won't be able to continue providing the best of services."* So every message (workshop
and counter sale), right after the total box: *"We request you to kindly make this payment on time. Timely payments are what allow us to keep providing you the best of our service — without them, we will not be able to continue doing so. If you have already paid, thank you, and please ignore this note."* (the first sentence in bold in the HTML). The last sentence is for
the ~1 in 10 paid vehicles that still come through here. `b310fa5`; three new self-test checks fail on the old wording.

**Database** (`20261024_gate_invoices.sql`, staging): `gate_documents`, `gate_bills`, `gate_contacts`,
`gate_messages`; money in paise; staff read under RLS (service / accounts / spares of the same company + admin),
writes only through the function. `probe-gate-invoices.sql` **13/0** on staging (7 write checks + every staging
user); with the read rule opened to everyone it fails (12/1).

**Staging guard:** `GATE_EMAIL_ONLY_TO=@parastrucks.in` — on staging, mail can only go to our own addresses.

**✅ First signed-in run on staging (2026-10-25, browser pane, the accounts-manager test login, DEMO PDFs):**
read → "Save and email" saved the job (PTB, 2 bills, PDF stored at its exact size, one audit row) and said
email is not set up yet (no message row — the check comes before anything is recorded) · the same file again
→ "saved before", no second row · same job card with one amount changed → refused, nothing saved · a bill
already on another job → refused naming that job · a workshop cash job and a counter sale → saved · each PDF
link returns the same bytes · a signed-in user cannot write the tables or read the bucket directly · unknown
invoice / action / malformed reading refused · desktop + phone layouts right, no script errors. One fix from
it: a repeat upload showed two messages (`4eb2762`).
Staging holds those three DEMO invoices (DEMO KRISHNA LOGISTICS / MAHADEV TRAVELS / SHIV SPARES).

**Email — done on staging (2026-10-25):**
- ✅ The owner turned on the app password for `accounts.guj@parastrucks.in` and added it as the staging secret
  **`GATE_SMTP_PASSWORD`** (dashboard, never in chat).
- ✅ **First real email sent**: DEMO job → `ceo@parastrucks.in` from the screen; Gmail answered
  `250 2.0.0 OK … gsmtp`, ~4 s inside the function; the address remembered for that SAP code; audited. Inbox, not
  Spam; ₹ and the dash show right.
- ✅ The owner set the wording (above); rebuilt and re-sent — a workshop and a counter-sale mail both in the Inbox.
- ✅ Timely-payment paragraph added (`b310fa5`), deployed to staging, a workshop test mail arrived with it (Gmail
  filed it with the earlier test conversation, which had been deleted — so it showed under Trash, not Spam).

**Not yet done:**
- ✅ Signature **Mobile** +91 74969 70321 (the dealer number SAP prints on invoices) — confirmed by the owner 2026-10-25.
- 💡 **Owner idea (2026-10-25): add "your outstanding is now up to ₹X — please settle the entire amount in time".**
  Parked by the owner ("leave it out for now"): the portal does not know a customer's outstanding — it sees only the
  invoices sent through this screen, not which are paid, older dues or bills raised outside it, and a wrong figure
  sent to a customer starts a dispute. Options put to the owner: accounts uploads the Busy/SAP outstanding report
  ("as per our books on {date}") · an optional box typed when sending · the portal's own sum after step 3 (understates).
- ✅ PR #140 opened 2026-10-26 (CI 9/9 green, Auto-fix on) — NOT merged; nothing is on `portal` yet.
- Prod — **only on the owner's command**: apply `20261024_gate_invoices.sql`, deploy `gate-invoices`
  (`--no-verify-jwt`), set `GATE_SMTP_PASSWORD` on the prod project, and do NOT set `GATE_EMAIL_ONLY_TO` there
  (it limits recipients — staging only). Then merge the PR (the screen needs the tables + function first).
- ✅ Step 2 built 2026-10-26 — see below.

## Step 2 — as built (2026-10-26, branch `cr2-release-gate`, staging only)

Stacked on `cr1-invoice-send` (it needs step 1's tables and Edge Function), so PR #140 merges first.

**Owner decisions (2026-10-26):**
| Question | Decision |
|---|---|
| Who may approve or hold? | **Only the Service GM of the invoice's company, or the admin (owner).** No other GM. |
| How do approvers hear of a request? | **Phone notification** (web push), turned on once per phone. |
| How long does an approval let the vehicle out? | **48 hours**, no tap needed. Then the gate shows "hold" again. |
| Who creates guard logins? | **HR, on the Employees screen**, in a new Security department. |

**Guard logins.** New department `security` ("Security") with designation `security_guard` (executive). The
user-shape rule now says brands are **not applicable** for Security, with the reason on the form ("a brand would
open its catalog, quotations and the ERP to them"), in `src/lib/userShape.js`, the Deno mirror
`supabase/functions/_shared/userShape.ts` and `scripts/user-shape-audit.sql`. A guard keeps an outlet (their gate).
Without a brand the ERP sync's `!inner` brand join never picks a guard up. Measured on the schema snapshot: a guard
reads only what every staff member reads (colleague list, outlets, vendors, reference tables). The staging probe
moved a real user into Security (rolled back) and proved they read no catalog, quotation, PI, financier copy or
gate row. `user-shape-truthtable` 27/0 (the old rule fails 5 of the new checks); the JS and Deno copies agree on
all 120 slot × department × tier cases.

**Database** — `supabase/migrations/20261026_gate_releases.sql` (applied to STAGING):
- `gate_releases`: one per vehicle exit — `asked` → `approved` (with `valid_until` = decision + 48 h) / `held`
  (note required) / `withdrawn`; never two open requests for one invoice (partial unique index); `card` keeps
  what the approver was shown; `client_request_id` makes a double tap return the first request.
- `gate_checks`: every guard lookup (guard, plate as typed, may go / hold, the release it matched).
- `gate_push_subscriptions`: the approvers' phones — reachable by the service role only (no client grant).
- RLS: releases and checks read like the step-1 tables (service / accounts / spares of the company + admin);
  guards read nothing — the gate screen asks the Edge Function.
- 6 `/gate` access rules (Security × executive/manager/gm × PT/PTB).
- `scripts/invoices/probe-gate-releases.sql` **16/0** on staging (self-aborting; refuses a database whose `users`
  table calls out over HTTP). ⭐ It caught a real defect first: **a CHECK that evaluates to NULL passes**, and
  `valid_until > decided_at` is NULL when `valid_until` is missing — an approval with no expiry was accepted. Now
  `check (coalesce(case … end, false))`; against the old constraint the probe fails exactly that check. Each
  "must be refused" test now undoes an accepted row itself, so one failure cannot mask the next.

**Edge Function `gate-invoices`** (deployed to STAGING):
- `authority.ts`: the one table of who may do what, asked before any payload is read; the screens import it.
  Upload / send / PDF / ask / withdraw = service, accounts, spares + admin · decide + phone alerts = Service GM
  (own company) + admin · gate check = Security + admin. `scripts/invoices/selftest-gate-authority.mjs` **221/0**
  (20 people × 10 actions + the own-company rule, written by hand from the decisions); 7 planted bugs fail it.
  2026-10-27: + `gateList` (Security + admin) → **241/0**; opening it to service/accounts/spares fails it 12×.
- `requestRelease`: workshop jobs with a vehicle number only; refuses while an approval is still valid; wakes the
  approvers' phones (Service GMs of that company + admin) and returns how many were reached — never failing the
  request. `decideRelease`: approve (48 h) or hold (reason); a second decision is refused naming who decided first.
  `gateCheck`: plate typed any way (spaces / dashes ignored) → may go (who released it, until when) or hold (and
  whether a request is waiting), in the guard's own company; logged. 2026-10-27: it also returns the customer
  name, and **`gateList`** returns every vehicle that may go now (one row per plate, the later expiry) and every
  one waiting for the GM — plate, customer name, until when / asked when; no amounts, notes or hold reasons. The
  list is not logged; a tap on a row runs `gateCheck`, which is.
- `push.ts`: Web Push with the platform's WebCrypto — RFC 8291 (aes128gcm, encrypted to the phone's key) + RFC
  8292 (VAPID, ES256-signed). Only the browsers' push services are contacted (Google FCM, Mozilla, Apple, Microsoft),
  because the endpoint comes from a browser. `scripts/invoices/selftest-web-push.mjs` **44/0**: RFC 8291 Appendix A
  byte for byte; a random-key message decrypts like a phone; the JWT verifies with our key only; 15 crafted
  endpoints refused; 7 planted bugs fail it.
- Keys: `GATE_VAPID_PUBLIC_KEY` + `GATE_VAPID_PRIVATE_KEY`, made by `scripts/invoices/make-vapid-keys.mjs <ref>`
  (straight into the function secrets; the private key is never printed). Set on staging 2026-10-26.
- `admin-users` redeployed to staging (it imports `_shared/userShape.ts`).

**Screens:**
- Send Invoice gets two tabs — **Invoices** (as before, plus "Ask to release" with an optional note on workshop
  rows that carry a plate, and the release state on each row) and **Credit releases** (waiting first; Approve /
  Hold only for the deciders). What it pushes down: the upload card moves down by one tab row.
- The approval card shows the customer's earlier credit releases **through the portal** (count, total, last) and
  says plainly it is not their Busy balance (no paid status until step 3).
- Approvers get a "Turn on alerts" line (Android Chrome: in the browser; iPhone: only from the Home-Screen app,
  iOS 16.4+, so the portal now has `manifest.webmanifest`, icons and `apple-touch-icon`). `public/sw.js` handles
  push + click only — **no fetch handler, nothing cached**, so the portal still loads straight from the network.
- `/gate`: one box, one button, a full-width **MAY GO** (green) or **HOLD** (red); no amount. Guards land there
  after sign-in; their phone bar is Gate + Profile. **2026-10-27 (owner): a list with a search.** Under the box:
  **May go** (green rows) and **Waiting for the GM** (amber rows) — plate, customer name, "Until 29 Oct, 9:59 pm ·
  by …" / "Asked … — not yet". Typing filters by any part of the plate or the customer's name; Enter on a part
  that leaves one vehicle checks that vehicle; nothing left → **"Not in the list — HOLD"**. A tap on a row → the
  big card (now with the customer name). The list refreshes every minute while in front and when the phone wakes;
  "Updated … · Refresh" under it. The box no longer grabs focus on open (the keyboard would cover the list).
- Build clean; the throwaway `no-undef` pass clean over `src`.

**Seen in the browser pane, 2026-10-27 (owner signed in as the staging admin, phone width):** every path as
designed — "Ask to release" only on workshop rows with a plate · ask → "RELEASE ASKED", button gone · with no
approver phone set up the toast says *"No approver has phone alerts turned on — tell the GM it is waiting."* ·
Credit releases "1 WAITING", the card, the note, "No earlier credit release…" · approve → "Released until 29 Oct,
9:59 PM" (48 h) · gate: `gj 01 zz-0001` → MAY GO (who, when, until) · never asked → HOLD "Not released on credit" ·
asked → HOLD "waiting for the GM's answer" · hold with no reason refused ("Say why it is held — the service team
sees it") · hold with reason → HELD, reason shown, gate HOLD. Then the list: MAY GO 1 · `0001` + Enter → MAY GO
with the customer · `0002` (held) → "Not in the list — HOLD" · `krish` finds the customer · asked again → WAITING
FOR THE GM 1 → tap → HOLD waiting · held again.
**Two screen fixes from that run:** the "ask" form on the last row opened under the phone's bottom bar → an inline
form now scrolls itself into view, stopping above the bar (`revealForm` + `scroll-margin`; measured form bottom
588 px, bar top 604 px); and the hold form showed two "Hold" buttons → the opener hides and the send button reads
**"Hold GJ01ZZ0002"**. Staging now: GJ01ZZ0001 released until 29 Oct; GJ01ZZ0002 held twice (all DEMO).

**Owner decisions (2026-10-27, after that run):**
| Question | Decision |
|---|---|
| The gate screen | **A list with a search** — easier for the guards. |
| What each row shows the guard | **Plate + customer name** (+ until when, who approved). No amounts. Revises "no names" of 2026-10-24. |
| Credit used and credit limit on the approval card | Wanted — but **nothing holds them today**; they come **when the full Service Payments module runs** (its customer master and outstanding). Nothing to build now; no placeholder on the card. |
| The words a guard reads | **Only two: "RELEASE" and "HOLD"** — the big cards and the list headings. A vehicle waiting for the GM sits under **Hold** ("Waiting for the GM · asked …"). The stored values stay `may_go` / `hold`. |

**The test guard, 2026-10-27 (staging, `guard@parastrucks.test`):** made on Employees by the admin — the brand slot
read "Not applicable — Security guards see only the gate screen…", and the server saved the guard with **0 brands**.
First sign-in → "Choose your password" (the forced password change, run end to end for the first time) → own
password → straight to /gate: **RELEASE 1**, phone bar **Gate + Profile**, and /invoices, /catalog, /employees,
/quotation, /tiv-forecast all bounce back to /gate. With the guard's own sign-in, the server refused approve, ask,
PDF and phone alerts ("Forbidden"), and direct reads returned **0 rows** from `gate_releases`, `gate_checks`,
`gate_documents`, `gate_bills`, `vehicle_catalog`, `quotations` and `proforma_invoices` (`gate_push_subscriptions`:
permission denied). The guard's tap is in `gate_checks`.

**Alerts seen in a real browser, 2026-10-28 (the owner's own Chrome, through Claude in Chrome, localhost:3001,
staging admin):** "Turn on alerts" → Chrome's own permission box (the owner clicked Allow — a page cannot) → "Phone
alerts are on for this device"; the service worker registered and subscribed. "Ask again" on GJ01ZZ0002 → *"Asked.
The GM was alerted on 1 phone."* → Chrome showed **"Release asked: GJ01ZZ0002 — Demo Mahadev Travels · ₹19,890.00 —
tap to approve or hold"**, staying until tapped. So the whole chain works on a real browser: our own RFC 8291
encryption decrypted by Chrome, our VAPID signature accepted by Google's push service, the worker showing it.

**Owner decisions (2026-10-28):**
| Question | Decision |
|---|---|
| How should alerts behave? | **Like an instant-messaging app on Android**, in the installed app: the admin or the GM gets the notification, taps it, and approves. |
| Stay signed in on a phone with alerts on? | **Yes.** Turning alerts on ticks "Remember me" for that device (and the screen says so); a later sign-in there keeps it; turning alerts off undoes only what the alerts set; **signing out ends it and also drops that device's alert subscription** (a signed-out phone must not keep showing customers and amounts). |
| How to test on a real Android phone before go-live? | **A staging website** (see below). |
| The page's name | **"Invoices & Payments"** (was "Send Invoice"): nav, page title, access-rules list. |

**Built for that (`5c6fc8e`):** once someone approves, holds or withdraws, the OTHER approvers' "asked" alert is
replaced quietly (same tag, no sound, dismissable) by who answered — *"GJ01ZZ0002: released by … until …"* — so
nobody taps a request that is already decided; the person who acted gets nothing (a browser must show something for
every push, hence a quiet replacement rather than nothing). "Asked" alerts vibrate and stay until tapped. Android
status-bar badge `public/badge-96.png` (white "P" on transparent); the 512 px icon is also offered as **maskable**,
so the home-screen icon is not boxed in a white circle.

**The staging website (2026-10-28, owner: "Yes, set it up"):** Vercel already builds every branch as a preview;
this branch's fixed address is **https://portal-git-cr2-release-gate-parastrucks-projects.vercel.app**. Done:
(1) Vercel `portal` project — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` added for the **Preview** target =
staging's address and publishable key (the Production pair untouched; until then a preview had no database at all);
(2) staging `ALLOWED_ORIGINS` = the three localhost origins + that address (the old value was confirmed by its
sha256 `d4ed322d…` before the change; new `212814fc…`); (3) Vercel's login wall on previews stays on — the owner
signs in to Vercel once on the phone. The GM's phone cannot pass that wall without a Vercel account, so the GM
tests at go-live (or later with a Vercel share link). ⚠️ **Every** branch's preview now talks to staging — which is
what a preview should do; no preview can reach the live data.
(4) **Turnstile** (found on the first load: "Unable to connect to website"): the live site key is a TEAM-wide Vercel
setting that also reaches previews, and Cloudflare accepts it only on the live hostname. Owner chose **Cloudflare's
published test key for Preview builds** (`1x00000000000000000000AA`, always passes) as a `portal` project setting —
staging never checked Turnstile (no `TURNSTILE_SECRET`, `REQUIRE_CAPTCHA=false`), same as signing in on the PC.
Production keeps the real team-wide key; the live sign-in still enforces it.
`gate-invoices` with the quiet-replacement change reached staging on the 6th try — Supabase's bundler kept timing
out fetching `jsr:@supabase/functions-js` (jsr.io answered in 0.8 s from the PC); a retry loop, not a code change.

**Not yet done:**
- ⏭️ **Android test on the staging website** — the owner opens the address on the phone, signs in to Vercel, signs
  in to the portal as admin, installs it (Add to Home screen), turns alerts on; then a release is asked from the
  PC and the phone should ring with the app closed; tapping opens the request; approving from the phone.
- ⏭️ **Alerts in a desktop browser** — ✅ done 2026-10-28 (above); the click-through on desktop not yet confirmed.
- ⏭️ **Credit used / limit on the approval card** — after Service Payments is live (owner, 2026-10-27).
- ⏭️ **A real phone alert** — a phone cannot reach localhost; test at go-live, or from an https test origin.
- Promised-by date, responsible person, "mark paid" and the follow-up list = **step 3** (the design above lists
  promised-by on approve; it was left for step 3 with the rest of the promise tracking).
- Prod — **only on the owner's command, after #140**: apply `20261026_gate_releases.sql`, deploy `gate-invoices` and
  `admin-users` (from `portal`), run `make-vapid-keys.mjs mmmxvjaavdtwlpcnjgzy`, then merge.

## Sources (outside the repo, not committed)
- WhatsApp export "Vehicle Gate Pass" (owner, 2026-10-24) — analysed by a throwaway script; aggregates only.
- Three SAP invoice PDFs in the main checkout's `docs/` (a counter sale and two workshop jobs; Aug + Oct 2026).
