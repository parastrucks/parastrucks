# Service Payments — dummy walk-through on staging

The first time the Import and Match screens meet data in a browser. **Everything is fake**:
customers are "DEMO …", codes 0099…, UTRs 99…, plates …DM…. It runs against **staging**, never prod.

Every expected result below is checked by `scripts/payments/selftest-demo-files.mjs` before you see
it, and the rows were also sent through the real staging database once (rolled back) to prove it
accepts them. So a difference from this sheet is a real finding — note it.

## Get the files

```bash
node scripts/payments/make-demo-files.mjs "C:/Users/dhruv/Downloads/payments-demo"
```

This makes four files dated around **today**: bills over the last four days, one payment made this
morning. Re-make them on the day you run this, or the dates drift.

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
| 4 | `DEMO BharatPe statement.csv` | BharatPe statement · **7 new payments** · a note about one payment of ₹50 or less (the ₹30 top-up) |
| 5 | `DEMO GPay export.csv` | Google Pay Business export · **4 new payments** · "1 row not imported" (the Pending one) |

## Match (Match tab) — oldest first

| Payment | You should see | Then |
|---|---|---|
| ₹2,150, no name | JAY BATTERIES' bill, "Only bill at this exact amount" | Confirm |
| ₹12,345.67 DEMO KISAN TRADERS | KISAN's bill first, "Only bill at this exact amount" | Confirm |
| ₹30 DEMO KISAN TRADERS | **Nothing to match** — KISAN's bill is now paid | Skip for now |
| ₹10,000 Ganga R, note "5566" | GANGA ROADWAYS' ₹25,000 bill, "Truck GJ06DM5566 — the note says 5566". Button reads **"Confirm ₹10,000.00 · part-paid"** | Confirm |
| ₹7,777 DEMO QUICK FREIGHT | "No bill matches this payment" | **Search all bills** → type `7777` → none → back → Skip |
| ₹4,800 Ramesh, "Gj27dm 7715" | RAMESH SHARMA's bill, "Truck GJ27DM7715 named in the note" | Confirm |
| ₹3,400 MEHUL SHAH | Two ₹3,400 bills (HARSH and INDU) | Pick either — this is the human decision |
| ₹11,650 Suresh, "9044 service" | A **"2 bills"** card for FLEET CARRIERS (parts + labour), by the plate | Confirm — both bills paid |
| ₹1,930 DEMO ASHA ENTERPRISE | Five identical ₹1,930 bills, **ASHA's first** (name) | Confirm ASHA's |
| ₹1,930 NIRAV PATEL | The pile **unranked**, with the "equally likely … not ranked" banner | Skip |
| ₹1,930 DEMO BHAVIN TRADING (today) | **"Bills are out of date"** banner, Confirm off | Leave it |

## Then the next day's bills (Import tab)

| # | Choose | You should see |
|---|---|---|
| 6 | `DEMO Billing Report 2.xlsx` | 1 new (PRIYA), 1 changed (MANAN ₹745 → ₹845), 18 unchanged, and **1 clash**: ASHA's bill is now cancelled in SAP, but you matched money to it — "reverse that match first" |
| 7 | Import it, go to Match | BHAVIN's ₹1,930 from this morning is **no longer out of date** — report 2 covers today |

## Also worth a look

- Sign out, sign in as **svc.exec@parastrucks.test**: no Import tab, UPI payments only, and
  "Not a service payment" tells them accounts decides.
- Sign in as **pt.mgr@parastrucks.test** (Paras Trucks, not PTB): no Match Payments in the menu
  at all — v1 is PTB only.
- Widen the window to desktop size: the same single column, and the Confirm bar centred.

## Afterwards

The DEMO rows stay in staging. Deleting them needs your approval. They are harmless there, but
they will appear alongside real data if a real file is imported to staging later.
