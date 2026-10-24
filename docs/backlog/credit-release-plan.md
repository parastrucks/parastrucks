# Credit release, invoice sending and the gate app — plan v0.1 (2026-10-24)

> **Status: idea written up, nothing built.** Owner's proposal of 2026-10-24, extending the Service Payments
> tool (`docs/backlog/service-payments-plan.md`, parked waiting on HDFC). Every number below was measured from
> material the owner supplied that day; nothing here is assumed. No customer names, phone numbers, PANs or
> plates are recorded in this file — the sources stay outside the repo.

## Part 1 — the story in plain words

Today a credit vehicle leaves the workshop like this: the service team posts a photo of the invoice in the
WhatsApp group "Vehicle Gate Pass" with the vehicle number, customer and amount, tags the GM and the owner,
and waits for "Ok pls release the vehicle". The guard lets it out. Any promise that came with the release
("payment by EOD by cheque", "Mohit has taken responsibility") stays in the chat, and nobody follows it up.

The new way:

1. **Service uploads the invoice PDF** in the portal. The portal reads the bill number, amount, customer,
   customer code and vehicle number from the PDF itself — nobody types them.
2. **The customer receives the invoice** by email (and WhatsApp, once a number is set up).
3. **If the vehicle is leaving unpaid, one tap asks for release.** The request already carries the invoice,
   the amount, the customer's outstanding and their past releases — the questions the GM asks today.
4. **The GM or the owner approves or holds**, and on approval may record *"promised by"* and *"who is
   responsible"*.
5. **The guard checks the vehicle number on a phone:** green "may go" or red "hold". No amounts, no names.
6. **When a promised date passes unpaid**, it appears on a follow-up list for the GM and the owner.

Paid vehicles do not change: accounts issues their gate pass as today, and the guard does not look at the
app for them (owner).

## Owner decisions (2026-10-24)

| Question | Decision |
|---|---|
| Which vehicles does the guard app cover? | **Credit vehicles only.** Paid ones keep accounts' gate pass. |
| Who approves a credit release? | **Only the GM or the owner.** |
| Are SAP invoices digital PDFs? | **Yes** — confirmed on three samples (below). |
| How is email sent? | **The owner's own Gmail ID with an app password**, as the automation reports already are. |
| What does the guard see? | **"May go / hold" only.** The database needs a way to create security-guard logins. |
| WhatsApp Business number | **Not decided** — owner to come back. |

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
escalation rules. **The value is not the "yes"** (6 minutes today) but the two things the chat loses: the
outstanding at the moment of approval, and the promise made with it.

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
  cash-series, one credit-series. **So the release request must be raised by a person, not inferred from
  the series** — the owner noted credit releases are not always credit-series bills.
- **Both workshop samples were "Warranty Order" job cards billed to the customer** — the same thing the
  payments plan found (`Split Order Type`, not the job number, decides what is payable).
- ⭐ **Two different SAP customer codes carried the same PAN and GSTIN** (a counter-sale customer and a
  workshop customer), while the third sample printed its own. **Same PAN/GSTIN under two SAP codes = one
  legal entity** — a strong hint for the payments tool's customer groups, which today have only weak hints
  ("shared vehicle registration" measured zero). Worth measuring across the Billing Report.

## Part 2 — design

### Where it sits
It is built **on the Service Payments data model**: an uploaded invoice is the same bill the SAP Billing
Report imports (`payment_invoices`, keyed by bill number), and the customer is the same customer-master row
(keyed by SAP customer code). The Billing Report stays the master; the PDF is the **document to send** and an
**early same-day reading** of the same bill. A PDF whose number or amount disagrees with the Billing Report
row is flagged, never silently trusted.

⚠️ **Dependency:** the payments tables exist on staging only (nine migrations, owner: not going live now).
The credit release needs at least the schema on prod — customers, invoices, receipts — even if the Match
screen stays hidden. **Decision for the owner** (see Open questions).

### Reading the PDF
- In the browser with `pdfjs-dist` (already loaded for brochure covers) — the file never has to be sent to a
  third party to be read.
- Recognise the layout **by its SAP form name** (in the PDF metadata) and by its labels; an unknown form is
  refused, not guessed.
- Read labelled fields, not positions; check labour + parts = summary total and each bill's total; amount
  in words as a second check on the counter sale.
- Store the PDF in Supabase Storage (private bucket); links handed to customers are signed and expire.

### Sending
- **Email:** an Edge Function sends through Gmail over **SMTPS port 465** with the owner's app password kept
  as an EF secret. ⚠️ Supabase Edge Functions **block outbound ports 25 and 587** (Supabase docs,
  *Functions → Limits*), so 465 (or the Gmail API over HTTPS) is the route. Gmail allows ~500 recipients/day
  (free) or 2,000 (Workspace); volume is ~30 bills/day. Not yet proven live — the first thing to try.
- **WhatsApp — two options:**
  (a) **WhatsApp Business API** — fully automatic; needs a Meta-verified business, a number taken off the
  normal WhatsApp app, approved message templates, a small charge per message. The first paid piece.
  (b) **Click-to-chat (free, no API):** a "Send on WhatsApp" button opens WhatsApp on the staff phone with the
  customer's number and a message holding a signed invoice link; the person taps Send. One tap, no cost,
  no Meta approval — but a human sends each one. **Recommended to start**, moving to (a) if volume or
  reliability needs it.
- The customer's mobile is printed on the invoice; the customer master's contact numbers (payments plan)
  take precedence when set.

### Approval
- A request = vehicle + the job's bills + who asked. The approval card shows: amount, the customer's
  **outstanding and past releases** (from the payments data), any earlier hold note.
- Approve / Hold, by the **GM or the owner only** (server-side rule, as `authority.ts` does for payments).
  Optional on approve: **promised by (date)** and **responsible person**.
- Notification to the GM and owner (web push from the portal, or a WhatsApp/email ping).
- Every decision is audited (who, when, the amounts shown at that moment).

### The gate app
- A **security role**: new guard logins that can open one route only. Users today carry entity +
  department + designation + permission level (`userShape.js`); a "Security" department (or designation)
  with an access rule for one route is the smallest change.
- Screen: type or scan the vehicle number → **green "may go" (released on credit by GM/owner at time …)**
  or **red "hold — not released"**. No amounts, no customer.
- Installable on the guard's phone (the portal as a PWA — "Add to Home screen").
- Option: a **gate-pass QR** in the customer's message that the guard scans — no mistyped plate, no wrong
  job. Not decided.

### Follow-up list
Approved releases with a promise date: overdue first, with the responsible person. Cleared automatically
when the payments tool matches the money (or marked paid by accounts).

## Suggested build order

1. **Invoice upload + reading + email** (no HDFC dependency; useful on its own).
2. **Release request + approval + gate screen + guard logins.**
3. **Promises and the follow-up list.**
4. **WhatsApp** — click-to-chat first; Business API if wanted.
5. **CRM** beyond the customer master — only once the owner names what it should *do*.

Each step: say what it pushes down a screen (TIV lesson); prove on staging; prod only with the owner.

## Open questions for the owner

1. **Payments schema on prod:** may the payments database (not the Match screen) go to prod so the credit
   release can show outstanding? Or should the first version run without outstanding?
2. **WhatsApp:** click-to-chat (free, one tap by staff) first, or straight to the Business API?
3. **Guard logins:** one login per guard, or one per gate phone?
4. **Gate-pass QR** for the customer, or vehicle-number lookup only?
5. **Counter credit sales (`MCI…`) have no vehicle** — send the invoice, but no gate step. Agreed?
6. **"CRM":** what should it do beyond the customer master (follow-ups, service reminders, contact history)?

## Sources (outside the repo, not committed)
- WhatsApp export "Vehicle Gate Pass" (owner, 2026-10-24) — analysed by a throwaway script; aggregates only.
- Three SAP invoice PDFs in the main checkout's `docs/` (a counter sale and two workshop jobs; Aug + Oct 2026).
