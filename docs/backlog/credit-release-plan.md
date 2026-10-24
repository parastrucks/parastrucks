# Credit release, invoice sending and the gate app — plan v0.2 (2026-10-24)

> **Status: planned, nothing built.** Owner's proposal of 2026-10-24, related to the Service Payments tool
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
5. **The guard checks the vehicle number on a phone:** green "may go" or red "hold". No amounts, no names.
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
  and variables: customer name, invoice / job number, amount. Wording along the lines of: *"Thank you for
  having your vehicle serviced at Paras Trucks and Buses. Please find invoice {no.} for ₹{amount} attached."*
  — final text to be approved by the owner and then by Meta. Sent from an Edge Function through Meta's Cloud
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
  **red "hold — not released"**. No amounts, no customer.
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

## Sources (outside the repo, not committed)
- WhatsApp export "Vehicle Gate Pass" (owner, 2026-10-24) — analysed by a throwaway script; aggregates only.
- Three SAP invoice PDFs in the main checkout's `docs/` (a counter sale and two workshop jobs; Aug + Oct 2026).
