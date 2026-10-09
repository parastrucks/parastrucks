# Service Payments — dummy walk-through on staging

The first time the Import and Match screens meet data in a browser. **Everything is fake**:
customers are "DEMO …", codes 0099…, transaction ids and bank references 99…, plates …DM…, the QR
terminal DEMO0001. It runs against **staging**, never prod.

UPI is **HDFC** from October 2026 (BharatPe and Google Pay are retired), so the payments come as
HDFC SmartHub reports — the file accounts will upload every day. HDFC's report has **no note
field**, so no payment here is found by a number plate: each is found by its amount or its payer's
name, as real ones now are.

Every expected result below is checked by `scripts/payments/selftest-demo-files.mjs` before you see
it — including a replay of the Match tab **in this order**, because each Confirm changes what the
next payment is offered. The bills and both HDFC reports were also sent through the real staging
database once and rolled back (20 bills; 10 payments, then 1 new + 2 already there; every payment
with its QR; each day's total exact). So a difference from this sheet is a real finding — note it.

## Get the files

```bash
node scripts/payments/make-demo-files.mjs "C:/Users/dhruv/Downloads/payments-demo"
```

This makes four files dated around **today**: bills over the last four days, payments over the
same days, one payment made this morning. Re-make them on the day you run this, or the dates drift.

## Start

1. In PowerShell, from the payments worktree:
   `cd "D:\PTB\Website\portal_phase1a_setup\portal\.claude\worktrees\id-login-issue-logs-8810c0"; npm run dev`
2. Open **http://localhost:3000**. Sign in as **tester@parastrucks.test** — an accounts manager,
   the person who will really import (the staging test password). admin@ works too.
3. **For the phone view:** press F12, then Ctrl+Shift+M, and pick a phone size.
   A real phone cannot reach `localhost`, and staging's Edge Function only accepts
   `localhost:3000`. The real-phone test comes with a deployed build.
4. Service Tools → **Match Payments**. As accounts you see two tabs: **Match** and **Import**.

## Import (Import tab)

| # | Choose | You should see |
|---|---|---|
| 1 | `DEMO Billing Report 1.xlsx` | SAP Billing Report · **20 new bills**. "Bills are complete up to" the end of yesterday. Nothing held, nothing unreadable. |
| 2 | Import it | ✓ Imported · 20 new |
| 3 | `DEMO Billing Report 1.xlsx` **again** | **Blocked**: "This exact file was already imported…" and the Import button is off |
| 4 | `DEMO HDFC report 1.xlsx` | HDFC SmartHub transaction report · **10 new payments, ₹56,012.67** · **Failed attempts — not money: 1** (RAMESH's first try) · Could not be read: 0 · notes "1 row not imported" and "1 payment of ₹50 or less" (the ₹30 top-up) · the daily tie-out for QR **KTR510/DEMO0001**: four days ago **₹2,150** · three days ago **₹22,375.67** · two days ago **₹27,627** · yesterday **₹3,860** |
| 5 | Import it | ✓ 10 new · 0 already there |
| 6 | `DEMO HDFC report 2.xlsx` (this morning's download — it repeats yesterday) | **1 new payment, ₹1,930** · **Already imported: 2** (yesterday's, recognised, not doubled) · tie-out: yesterday ₹3,860, today ₹1,930 (today's is the day so far) |
| 7 | Import it | ✓ 1 new · 2 already there |

On a real day, step 4's tie-out is the check that matters: each day's figure should equal the
"UPI SETTLEMENT -KTR510-" credit HDFC pays in the next morning, to the rupee. Had RAMESH's failed
attempt been counted, two days ago would read ₹32,427 — the bank would disagree, and his bill would
have two ₹4,800 payments competing for it.

## Match (Match tab) — oldest first

| Payment | You should see | Then |
|---|---|---|
| ₹2,150 JAYESH PATEL | JAY BATTERIES' bill, "Only bill at this exact amount" — the names share nothing; someone paying for the firm | Confirm |
| ₹12,345.67 DEMO KISAN TRADERS | KISAN's bill first, "Only bill at this exact amount" | Confirm |
| ₹30 DEMO KISAN TRADERS | **Nothing to match** — KISAN's bill is now paid | Skip for now |
| ₹10,000 GANGA SAGAR MAHESHWARI | GANGA SAGAR MAHESHWARI's ₹25,000 bill, "Payer name matches the customer" (no amount matches). Button reads **"Confirm ₹10,000.00 · part-paid"** | Confirm |
| ₹7,777 DEMO QUICK FREIGHT | "No bill matches this payment" | **Search all bills** → type `7777` → none → back → Skip |
| ₹4,800 RAMESH SHARMA | RAMESH SHARMA's bill, "Only bill at this exact amount" — and only **one** ₹4,800 payment in the queue | Confirm |
| ₹3,400 MEHUL SHAH | Two ₹3,400 bills (HARSH and INDU) | Pick INDU's — this is the human decision |
| ₹11,650 SURESH DESAI | A **"2 bills"** card for FLEET CARRIERS (parts + labour), by the **sum** of the two | Confirm — both bills paid |
| ₹1,930 DEMO ASHA ENTERPRISE | Five identical ₹1,930 bills, **ASHA's first** (name) | Confirm ASHA's |
| ₹1,930 NIRAV PATEL | The **four** ₹1,930 bills left, **unranked**, with the "equally likely … not ranked" banner | Skip |
| ₹1,930 DEMO BHAVIN TRADING (today) | **"Bills are out of date"** banner, Confirm off | Leave it |

## Then the next day's bills (Import tab)

| # | Choose | You should see |
|---|---|---|
| 8 | `DEMO Billing Report 2.xlsx` | 1 new (PRIYA), 1 changed (MANAN ₹745 → ₹845), 18 unchanged, and **1 clash**: ASHA's bill is now cancelled in SAP, but you matched money to it — "reverse that match first" |
| 9 | Import it, go to Match | BHAVIN's ₹1,930 from this morning is **no longer out of date** — report 2 covers today. His own bill is first among the four unpaid ₹1,930 bills → Confirm |

## Also worth a look

- Sign out, sign in as **svc.exec@parastrucks.test**: no Import tab, UPI payments only, and
  "Not a service payment" tells them accounts decides.
- Sign in as **pt.mgr@parastrucks.test** (Paras Trucks, not PTB): no Match Payments in the menu
  at all — v1 is PTB only.
- Widen the window to desktop size: the same single column, and the Confirm bar centred.

## Afterwards

The DEMO rows stay in staging. Deleting them needs your approval. They are harmless there, but
they will appear alongside real data if a real file is imported to staging later.
