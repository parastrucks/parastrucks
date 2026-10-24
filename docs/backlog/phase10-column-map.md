# Phase 10 — `vehicle_units` column map (Stage 1, step 1) — DRAFT FOR OWNER SIGN-OFF

> Built 2026-10-21 from the **real headers** of the six workbooks by `scripts/phase10/columns.cjs`
> (read-only; prints shapes, never values). Formulas quoted are the workbooks' own, read from row 2.
> This is the list the plan calls "~88 signed-off columns": nothing in the schema migration is
> written until the owner signs this off. Companion docs: `phase10-execution-plan.md` (start there).

**Roles:** **IN** = people type it · **DB** = the database calculates it on every save (trigger) ·
**SCREEN** = calculated when shown, never stored (it uses today's date) · **TXT$** = money written as
text (`5K-DSA`), stored as text + a parsed amount and kind · **HID** = hidden from everyone but admin + HR.

## A · Identity (one row = one chassis)

| # | Column | Type | Role | Source (workbook · header) | Notes |
|---|---|---|---|---|---|
| 1 | `chassis_no` | text | IN | IT `Chassis No` · RETAIL/FY `CHASSIS NUMBER` · RET `CHASSIS NO` | unique among non-superseded rows |
| 2 | `engine_no` | text | IN | all lenses `Engine No` | |
| 3 | `model` | text | IN | `Model` / `MODEL` | |
| 4 | `vpart_no` | text | IN | IT `VPart Number` · RETAIL `V PART NUMBER` · RET `CBN No.` | ✅ CBN = V-part on 265/266 joined chassis (1 → conflict report) |
| 5 | `hsn_code` | text | IN | IT `HSN Code` | |
| 6 | `make_year` | int | DB | IT `Make` = VIN position 10: N 2022 · P 2023 · R 2024 · S 2025 · T 2026 | informational |
| 7 | `mfrs_year` | int | IN | RETAIL `MFRS YEAR` | kept: it is typed separately today |
| 8 | `segment` | text | IN | RETAIL/FY `SEGMENT` · RET `Segment` | |
| 9 | `customer_name` | text | IN | IT `Customer Name` · RETAIL/FY `NAME OF THE CUSTOMER` · RET `NAME` | free text (decision 3) |
| 10 | `qty` | int, default 1 | IN | IT `Qty` · RETAIL/FY `Quantity` | 1 on all 4,672 rows |

## B · Purchase from Ashok Leyland (INVOICE TRACKER, OTHER DEALER)

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 11 | `purchase_source` | `al` \| `other_dealer` | IN | which IT sheet the row came from | |
| 12 | `oem_gatepass_no` | text | IN | `OEM Gatepass Number` | search by last 6 digits (F5) |
| 13 | `oem_gatepass_date` | date | IN | `OEM Gatepass Date` | |
| 14 | `odn_no` | text | IN | `ODN Number` | |
| 15 | `ctc` | numeric | IN | sales book / Invoice List / RET-INT `CTC` (stock not yet sold: IT `CTC`) | shown as **PTB CTC** — the internal figure (owner 2026-10-24). The "26.5% conflicts" were two different CTCs, not errors |
| 15a | `al_ctc` | numeric | IN | RET-AL `CTC` (DBM export `CTC`), then IT `CTC` | **AL CTC** — the CTC told to AL, on which AL pays retention (owner 2026-10-24); blank = same as PTB CTC. Measured: IT = RET-AL on 1,634/1,860, sales = RET-INT on 1,938/2,087; internal higher on 240 of the 275 that differ. Migration `20261024_phase10_tracker_two_ctc.sql` |
| 16 | `ctd` | numeric | IN | IT `CTD` (+ RETAIL `CTD`, RET `CTD`, AL BS `CTD`) | hand formulas like `2055000/1.28*1.18` → kept as a cell note |
| 17 | `ctc_basis` | `inclusive` \| `exclusive` | IN | derived once on import (N1) | 530/2050 exclusive |
| 18 | `amc_to_al` | numeric | IN | IT `AMC/SERVICE` | |
| 19 | `dsa` | numeric | IN | IT `DSA` | |
| 20 | `ad_blue` | numeric | IN | IT `AD BLUE` | `1310*8` style → value + cell note |
| 21 | `retention_dealer` | numeric | DB | IT `Retention` | `IF(al_ctc=0, 0, al_ctc − ctd − amc − dsa − ad_blue)` — on **AL CTC** (blank AL CTC → PTB CTC) |
| 22 | `payment_amount` | numeric | DB | IT `Payment Amount` | ⭐ `(ctd + amc_to_al) × qty` — this is the "gross to AL" round 2 could not find |
| 23 | `tds` | numeric | DB | IT `TDS` | `payment_amount × 0.001` |
| 24 | `total_payment_to_al` | numeric | DB | IT `TOTAL PAYMENT TO AL` | `payment_amount − tds` |
| 25 | `al_payment_status` | text | IN | IT `AL Payment Status` | `Cash Invoiced` / `IBND` |
| 26 | `al_payment_date` | date | IN | IT `AL PAYMENT DATE` | |
| 27 | `ptb_invoice_date` | date | IN | IT `PTB INVOICE DATE` · RETAIL/FY `PTB INVOICE DATE` | |
| — | `ageing_days` | — | SCREEN | IT `AGEING` | `IF(no al_payment_date, 0, IF(no ptb_invoice_date, TODAY − al_payment_date, ptb_invoice_date − al_payment_date))` |
| — | `interest_on_ageing` | — | SCREEN | IT `Interest` | ageing × total_payment_to_al × 10%/365, **0 when negative** |
| 28 | `supplier_invoice_no` | text | IN | `Supplier Invoice No.` | |
| 29 | `supplier_invoice_date` | date | IN | `Supplier Invoice Date` | |
| 30 | `supplier_invoice_amount` | numeric | IN | `Supplier Invoice Amount` | |
| 31 | `diff_amount` | numeric | DB | `Difference - Amount` | `IF(sup=0 OR payment=0, 0, payment_amount − sup)` |
| 32 | `diff_base` | numeric | DB | `Difference - Base Value` | `diff_amount / (1 + gst_rate)` (sheet: `/1.28` on every row) |
| 33 | `diff_gst` | numeric | DB | `Difference - GST` | `diff_amount × gst_rate / (1 + gst_rate)` |
| 33a | `gst_rate` | numeric | DB | — (new) | ✅ owner 2026-10-21: **28% if `ptb_invoice_date` is before the GST change, else 18%** — unsold stock (no invoice date) is 18%. Applies to every GST step on the row (CTC and CTD alike). ✅ change date **22 Sep 2025** (owner; the data agrees: the last 28% row is 20 Sep, none after). ⚠️ **63 TIPPER rows were already 18% before it** (+1 tractor) — ✅ **owner 2026-10-23: "only RMC always at 18%"** — the 63 are all RMC chassis (model `… R RMC`, filed under TIPPER); RMC = 18% on any date (migration `20261023_phase10_tracker_rmc_gst.sql`, `scripts/phase10/gst_rmc.cjs`). 2 rows of ~1,630 break it → `gst_rate_override` at import: row 720 (RMC billed 28%, 29 Aug 2025) · row 948 (U 4020 TT tractor billed 18%, 9 Sep 2025). Plus `gst_rate_override` for the odd row |
| 34 | `diff_tds` | numeric | DB | `Difference - TDS` | `… × 0.001` |
| 35 | `total_difference` | numeric | DB | `Total Difference` | `IF(sup=0, 0, diff_base + diff_gst + diff_tds)` |
| 36 | `parts_pkg` | text | TXT$ | IT `Parts Pkg` | 58/58 text |

## C · Retail sale, finance, delivery, refund (PTB RETAIL, 2025-26)

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 37 | `dse` | text | IN | `DSE` | |
| 38 | `delivery_location` | text | IN | `DELIVERY LOCATION` | |
| 39 | `finance_bank` | text | IN | `FINANCE` | = the hypothecation bank (decision 11) |
| 40 | `do_date` | date | IN | `DO DATE` | |
| 41 | `do_amount` | numeric | IN | `DO AMOUNT` | |
| 42 | `mrp` | numeric | IN | `MRP` | |
| 43 | `tally_bill` | numeric | IN | RETAIL `TALLY BILL` · FY `CUSTOMER BILL` | |
| 44 | `amc_charged_to_customer` | text | TXT$ | RETAIL/FY `AMC` | 99% text |
| 45 | `tcs` | numeric | DB | `TCS` | `tally_bill × 1%` (NOT ctc — R2-14) |
| 46 | `total` | numeric | DB | `TOTAL` | `ctc + tcs` (PTB CTC) |
| 47 | `margin_money` | numeric | IN | `MARGIN MONEY` | |
| 48 | `finance_recd` | numeric | IN | `FINANCE RECD` | |
| 49 | `finance_paymt_recd_date` | date | IN | `FINANCE PAYMT. RECD DATE` | a DATE — never summed |
| 50 | `subvention` | numeric | IN | `SUBVENTION` | |
| 51 | `total_recd` | numeric | DB | `TOTAL RECD` | `margin_money + finance_recd + subvention` |
| 52 | `insurance` | numeric | IN | `INSURANCE` | |
| 53 | `cretem` | numeric | IN | `CRETEM` | raw (11+ values) |
| 54a | `road_tax_pct` | numeric, default 6 | IN | — (new) | ✅ owner: usually 6%; **0** for staff buses and where we do not pay lifetime tax (322 typed zeros in 2025-26); the sheets also show 8% on 3 rows |
| 54 | `full_tax` | numeric | DB + override | `FULL TAX` | `basic × road_tax_pct`, basic = value ÷ (1 + gst_rate). ✅ owner: the RTO moved from invoice value to MRP — the data puts it exactly at **1 Aug 2025**: invoices to 31 Jul use `tally_bill`, from 2 Aug use `mrp` (only 5 rows break it → overrides). The HSRP/CRTM constant is the `cretem` column (owner: "then that is it") |
| 54b | `full_tax_override` | numeric, nullable | IN | — (new) | the ~40 typed values that match no formula; shown as overridden |
| 33b | `gst_rate_override` | numeric, nullable | IN | — (new) | for a row the rule gets wrong; shown as overridden |
| 55 | `total_receivable` | numeric | DB | `TOTAL RECEIVABLE` | `total + insurance + cretem + full_tax` |
| 56 | `net_refund` | numeric | DB | `NET REFUND` | `total_recd − total_receivable` |
| 57 | `refund_status` | text | IN | `Refund Status` | 11 spellings → normalised list on import |
| 58 | `delivery_status` | text | IN | `Delivery Status` | |
| 59 | `payment_status` | text | DB | `Payment Status` | `IF(delivery_status='Stock','Stock', IF(no finance_paymt_recd_date,'Pending','Payment Recd'))` |
| 60 | `ad_blu_given` | text | TXT$ | `AD-BLU` | carries DSA/URIYA deals too |
| 61 | `endhan` | text | TXT$ | `ENDHAN` | 84 numeric rows in FY |
| 25a | `mto_advance` | text Yes/No | IN | — (new; owner 2026-10-23) | make-to-order truck whose 5% advance to AL was paid; empty = not make-to-order |
| 61a | `endhan_date` | date | IN | — (the unlabelled dates in 2025-26 col AL) | the day the Endhan was given (owner 2026-10-23, "I believe so"); migration `20261023_phase10_tracker_endhan_date.sql` |
| — | ~~`subvention_status`~~ | | dropped | `Subvention Status` | ✅ owner: drop |

## D · Retention and incentives (RETENTION TRACKER internal + AL)

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 62 | `dsm` | text | IN | RET-INT `DSM` | |
| 63 | `date_of_retail` | date | IN | RET-INT `DATE OF RETAIL` | the incentive month key (PTB's own retail date) |
| 63a | `al_retail_date` | date | IN | RET-AL `DATE OF RETAIL` | AL's retail date on the claim — differs from 63 on 961 of 1,980 trucks (days to weeks); its own column (owner 2026-10-24, "Yes"); migration `20261024_phase10_tracker_al_retail_date.sql` |
| 64 | `date_of_delivery` | date | IN | RET `DATE OF DELIVERY` | |
| 65 | `other_deductions` | numeric | IN | RET `Other deductions` | ✅ a separate figure: equals IT amc + dsa + ad_blue on **0 of 167** filled rows |
| 66 | `retention_internal` | numeric | DB | RET-INT `Retention` | `ctc − ctd − other_deductions` (PTB CTC). RET-AL's own `Diff between CTC and CTD` is the same sum on AL CTC |
| 67 | `retention_al_claim` | numeric | IN | RET-AL `Retention` | negotiated, ₹500 steps — never computed |
| 68 | `app_amt` | numeric | DB | RET-AL `App Amt` (DBM export `Adjustment`) | `retention_al_claim − (al_ctc − ctd − other_deductions)` — the AL file's own formula, on AL CTC |
| 69 | `retention_remarks` | text | IN | RET `Remarks` | |
| 70 | `sale_category` | text | IN | RET-AL `Sale Category` | |
| 71 | `al_invoice_no` | text | IN | RET-AL `AL Invoice No.` | |
| 72 | `dealer_invoice_no` | text | IN | RET-AL `Dealer Invoice No.` | |
| 73 | `al_claim_age` | int | IN | RET-AL `Age` | typed, no formula |
| 74 | `al_claim_interest` | numeric | IN | RET-AL `Interest` | typed, no formula |
| — | `dse_incentive` | — | SCREEN, HID | RET-INT `DSE INCENTIVE` | monthly slab on that DSE's count: <5 → 0, <9 → 1,200, <13 → 1,500, else 1,800 |
| 75 | `dse_incentive_override` | numeric | IN, HID | RET-INT `DSE INCENTIVE` where it differs from today's rule | SRS rows are zeroed by hand (60 rows); shown as overridden. ✅ Owner 2026-10-24: the ₹1,000 retention bonus was paid until ~Nov 2025 (sheets: last in Dec 2025, none from Jan 2026); the sheets' slab steps swap between 4/7/11 and 5/9/13 month to month, so the import keeps every month's PAID figure here when it differs from today's slab (5/9/13, no bonus — Jan 2026 matches on 140/140, Feb 195/197). Rehearsed: 2,624 kept (1,278 of them old rows with no retail date) |
| 76 | `dsm_incentive` | numeric | IN, HID | RET-INT `DSM INCENTIVE` | |
| 77 | `gm_incentive` | numeric | IN, HID | RET-INT `GM INCENTIVE` | |
| — | ~~RET-INT T, U, V~~ | | dropped | unnamed, filled on all 268 rows | ✅ owner: lookups from other tables — the tracker holds the source columns, so nothing to store |

## E · Inter-dealer and cancel/rebill

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 78 | `sold_to_dealer` | text | IN | DEALERS `NAME OF DEALER` | chassis sits under the "Model" header there (R2-5) |
| 79 | `dealer_basic_value` | numeric | DB | DEALERS `BASIC VALUE` | `ctd / (1 + gst_rate)` (sheet: `/1.28`) |
| 80 | `dealer_tds` | numeric | DB | DEALERS `TDS( 0.1%)` | `dealer_basic_value × 0.1%` |
| 81 | `dealer_net_payable` | numeric | DB | DEALERS `NET PAYABLE` | `ctd − dealer_tds` |
| 82 | `vehicle_location` | text | IN | canc rebill `Vehicle Location` | ✅ owner: keep |
| 82a | `actual_delivery` | text | IN | canc rebill `ACUAL DELIVERY` | ✅ owner: keep |
| 82b | `rebill_delivery_date` | date | IN | canc rebill `Dely Date` | ✅ owner: keep |
| — | cancel/rebill link | | system | canc rebill `NEW CHASSIS NO` | becomes `superseded_by_id` (decision: superseded rows) |

## F · System columns (not typed by anyone)

`id` uuid · `superseded_at` · `superseded_by_id` · `notes` (long text) · `user_field_1..5`
(admin-labelled scratch) · `source_file` · `source_row` · `import_batch_id` · `recompute` (false
only while the importer writes history — R2-25) · `created_at/by` · `updated_at/by`.
Side tables: `unit_cell_notes` (the 124 Excel comments + new ones) · `unit_cell_formats` (the ~148
highlights; the Univer formatting store) · `tracker_audit` · `tracker_views` · `customer_settlements` +
`settlement_items`.

**Count:** 88 stored business columns (82 + `gst_rate`, `gst_rate_override`, `road_tax_pct`, `full_tax_override` and two
cancel/rebill columns) + 3 screen-only + system columns.

## G · The AL Balance Sheet — its own ledger, fed by the tracker (owner: "any better way?")

It is the running account between PTB and Ashok Leyland: **credits** are what PTB owes per truck and
**debits** are payments. Measured: every credit line is the truck's `CTD × 0.999` (CTD less the 0.1%
TDS) — 224 whole, 15 at 95% and a few at 5% (split payments). So the better way is:
- a small `al_ledger` table (date, details, debit, credit, optional chassis link, `offtake_mode`);
- **the per-truck credit lines are created from the tracker** when a truck is invoiced (no retyping —
  today they are typed and concatenated by hand), splits allowed;
- payments and credit notes are typed or imported; the running balance is computed;
- a monthly tie-out against AL's own statement.
`offtake_mode` (`Cash Invoiced` / `IBND`) also lands on the truck as `al_payment_status` (#25).
**Not Stage 1** — it belongs with the other remaining features (Stage 6). ❓ OK with this?

### The decision in detail (owner asked for it 2026-10-23; measured on `AL Balance Sheet -0326.xlsx`)

**What the workbook is today** — one file per month, ~180–330 lines, starts with a CARRY OVER line:
- **244 truck lines (credit = what PTB owes AL):** CBN / chassis / engine typed (or pasted), Details =
  CONCATENATE of the three, Credit = `CTD × 0.999` typed as a formula on every line (224 whole; 15 at
  95%, a few at 5% / 5%×N — split offtakes). Offtake Mode per line: FRESH OFFTAKE 202 · IBND 37 · MTO 5.
- **~66 money lines (debit = paid to AL):** INDENT (50 — bank indents: AXIS, INDUSIND, or per chassis),
  PRICE SUPPORT (12 — AL's support/brokerage/incentive approvals), RTGS (1), CARRY OVER (1).
- **The balance:** two formulas (Net Balance, Unbilled Balance). A pivot ("Summary": count of CBNs by
  offtake mode) and "Sheet1" = **"AL BOOKS BALANCE"** — the month's tie-out against AL's own books (IBND,
  carry-over…).
- So the CTD and chassis on every truck line are a **second copy** of what the tracker already holds.

**Three options:**
| | What changes | Cost | Risk |
|---|---|---|---|
| **A. Leave it in Excel** | nothing | none | the CTD is typed twice; a CTD corrected in the tracker never reaches the balance sheet |
| **B. Ledger in the portal (the proposal)** | truck credit lines made by the tracker when the truck is invoiced (splits allowed); indents / price support / RTGS typed; running + unbilled balance and the AL-books tie-out worked out; monthly print/export in today's layout | ~1–2 weeks after the tracker's real load (Stage 6) | a new screen to learn; must match the Excel balance to the rupee on 12 past months before anyone relies on it |
| **C. In between** | stays in Excel, but the tracker gets a **"Copy for AL sheet"** button that copies the month's invoiced trucks as ready-made lines (CBN, chassis, engine, CTD × 0.999) | ~1 day | low — the team keeps its file; only the retyping goes |

Recommendation: **C now, B later only if the team asks** — adoption first; C removes the double typing
without a new screen. → **Superseded the same day by the owner's own option D (below).**

### ✅ DECIDED 2026-10-23 (owner) — option D: keep Excel, upload the final sheet monthly, the portal checks it

Owner: *"keep the Excel file, and every month, once the balance sheet is finalized, it can be sent over to
the portal by an upload. You can point out any discrepancies or anything that is problematic."* So: no
ledger screen, no "Copy for AL sheet" button; the team's file stays the record of the AL account, and
the portal reads it once a month and lists what disagrees with the tracker or with itself.

**Rehearsed on the real 2025-26 files** (`scripts/phase10/al_balance_check.cjs`: 12 monthly sheets against
the INVOICE TRACKER workbook as the stand-in for the tracker; counts and chassis only):
2,006 truck lines · 198 add-on lines · 609 money lines. What a person would be shown, for the year:

| Check | Year | What it means |
|---|---|---|
| Net Balance = paid − owed; CARRY OVER = last month's Net Balance | **0** | the sheet's own arithmetic ties every month (Net Balance sits in Debit and includes the carry-over line, which is a credit or a debit by sign) |
| CTD on the sheet = CTD in the tracker | **172** (+78 explained) | 78 are **exactly × 1.28 ÷ 1.18** — AL billed at 28% GST before 22 Sep 2025, the tracker holds 18% (69 have a PTB invoice after the change). The other 172 differ by 1–10% (mostly 96–99%), none after Nov-25 — the review list |
| Truck taken by AL on no balance sheet | **43** | Cash Invoiced / IBND in the tracker, never credited |
| Split never completed | **72** | a 95% line with no 5% line in the year (may fall in the next year) |
| Credit line with no chassis | **22** | MTO lines written against a customer name (e.g. "MTO-… CFS") |
| Offtake Mode spelt two ways | **55** | PARTS PKG / PARTS PACKAGE · I-ALERT / IALERT · "PATMENT PENDING" · 1 blank |
| Chassis not in the tracker | **4** | AMC lines on trucks not in the 2025-26 tracker (older stock) |
| Credit typed as a number, not CTD × 0.999 | **3** | Jan-26 |

**Learnt from the files** (correcting the proposal above): a chassis carries more than its truck line —
**add-on lines** AMC 58, PARTS PACKAGE 97, IALERT 24, EWP 19, PURCHASE RETURN 2, pending 4, whose CTD cell
holds the add-on amount (only 24 of 54 AMC lines equal the tracker's AMC column). Offtake modes seen:
FRESH OFFTAKE 1,482 · IBND 524 · MTO 21. **IBND on the sheet and Cash Invoiced in the tracker is the
truck's normal life, not a discrepancy** (524 such — the sheet records how AL released it, the tracker
its state now).

**To build (after the first real load — the checks compare against the tracker's real data):** an
"AL balance sheet" upload on `/tracker` (admin + back office), read in the browser like the payments
import (columns by header, never by position; one month per file; refuses a month already uploaded
unless replaced on purpose), stores the lines in their own table with the month, and shows the list
above — each line linking to its truck in the grid. Nothing in the tracker is changed by an upload.
✅ **Owner answers, 2026-10-23:** FRESH OFFTAKE **is** Cash Invoiced (→ the tracker's green rule now accepts
either word, `cellFormats.paidRule`; seen on staging: "fresh OFFTAKE" green, "Cash Invoiced" green, IBND and
blank plain, nothing saved as a person's colour) · **MTO = make-to-order: AL starts building on a 5%
advance**, paid before there is a chassis, so the line carries the customer's name; the truck's 95% line
comes later · **GST follows the PTB invoice date, for CTC and CTD alike** — so the tracker's 18% CTD is right
for a truck invoiced by PTB on/after 22 Sep 2025.
**Re-run with those rules:** the 21 MTO lines without a chassis are all advances (not shown); 21 trucks
with a 95% line pair to an MTO advance by customer name (loose word match — the real check should let a
person confirm the pair) → unfinished splits **72 → 51**
(⚠️ superseded by the proposal below: an MTO advance is per ORDER, so name-pairing is the wrong model) · of the 78 GST-ratio CTDs, **75 follow the rule
(not shown) and 3 do not** (18% in the tracker, PTB invoice before 22 Sep) · unchanged: **172** other CTD
differences, **43** AL-invoiced trucks on no sheet, 55 spellings, 1 non-MTO line with no chassis, 4 + 3 + 1
small.

### ~~Proposal~~ 2026-10-23 — MTO as an ORDER, and line types as data (owner asked: "a better way … exceptions
### will keep snowballing") — ❓ awaiting the owner

**Measured:** an MTO advance line is per ORDER, not per truck: customer + CBN (always filled) + CTD per
truck × 0.999 × 5% × **quantity** (×2, ×5, ×18, ×20…). 2025-26: **21 orders = 87 trucks**, of which **43**
got their 95% truck line in the year (e.g. one model 38 ordered / 25 delivered). Only 4 of 43 truck lines
equal a single advance by amount — pairing truck-to-advance was never the right question.

**Why exceptions snowball:** the check keys every line on the chassis, but the sheet's lines are four
different things — a truck, an order (no chassis yet), an add-on on a truck, money paid. Each non-truck
kind becomes a special case in code.

**Proposal (three parts):**
1. **An order list** (small: AL order ref, customer, CBN, quantity, CTD per truck, advance %, date). An MTO
   line on the sheet points to an order; a truck row in the tracker gets an "AL Order" pick (customer and
   model fill from it — less typing, not more). Then advance = CTD × 0.999 × 5% × qty, each truck's 95%
   line, and "ordered − delivered = still to come" all follow from data. Bonus: open MTO orders and the
   advance sitting with AL become visible (nowhere today).
2. **Line types as a table, not code:** each type says what it points to (truck / order / nothing), how
   its expected amount is worked out, and its spellings. Today's 13 modes collapse to five behaviours:
   truck (FRESH OFFTAKE, IBND) · order advance (MTO) · add-on on a truck (AMC, PARTS PACKAGE, IALERT, EWP)
   · return · money. A new case later = a row an admin adds, choosing one of the behaviours; no build.
3. **Settle once, remembered:** what the rules cannot explain is shown to a person, who links it to a
   truck/order or marks it right with a reason; the answer is stored, so it never returns next month. The
   list shrinks over time instead of growing.

Excel change for the team: on an MTO line, the order ref goes in (e.g. the Chassis cell); nothing else.
Cost: ~2–3 days, inside the AL upload build (after the first real load). ❓ Does AL give an order number
at MTO time — and is it the tracker's "ODN Number"?

✅ **Owner's answer: NO order list — one yes/no column on the truck, and "keep the table as flat as possible,
which would allow for better data understanding and deeper data insights"** (a standing rule now: memory
`feedback_flat_tables`). Built: **`mto_advance`** (Yes / No / empty = not make-to-order), after AL Payment
Status — migration `20261023_phase10_tracker_mto_advance.sql` on STAGING (column + CHECK Yes/No; the apply
function re-created with one more name, staging prosrc md5 `4493b2b9…` = file, LF), EF redeployed,
`probe-mto-advance` **6/0** (mutant not on the list fails 4), `selftest-vehicle-units` **556/0**,
`selftest-tracker-cells` **127/0** — ⭐ any fixed-list column now takes what is typed in any case and saves the
list's spelling (Yes/No also takes Y/N; "Inclusive" → inclusive). Seen through the deployed EF from the owner's
tab: " y " → Yes saved and read back, "maybe" refused "must be one of Yes, No", cleared again (DEMO-NEWROW-0003,
three audit rows). The AL upload reconciles per model: trucks marked Yes vs MTO advances (5% × qty) on the
sheets; a 95% truck line must say Yes.

✅ **Part 2 dropped (owner, 2026-10-23: "the kind of line already exists in the table, right?").** It does —
the sheet's own **Offtake Mode** column. No setting: the check knows the meaning of each word the owner gave
(FRESH OFFTAKE = Cash Invoiced, IBND, MTO = 5% advance, AMC / PARTS PACKAGE / IALERT / EWP = add-ons on a
truck, PURCHASE RETURN); a word it does not know, or a second spelling, is simply one more line on the
monthly review list. Part 3 (a person settles a line once, remembered) stands for the upload screen.

## ❓ Questions for the owner

Answered 2026-10-21: GST by invoice date · road tax 6% of basic, 0 for staff buses / no lifetime
tax · RET-INT T–V are lookups (dropped) · subvention status dropped · cancel/rebill location and
delivery kept · AL Balance Sheet stays its own ledger. From the data: CBN = V-part; other
deductions is its own figure.

Still open (small):
Also answered: GST change 22 Sep 2025 · road tax on the bill value until 31 Jul 2025, on MRP from
1 Aug 2025 (date found in the data) · the HSRP/CRTM constant is CRETEM.

1. ~~Tippers and GST~~ ✅ **answered 2026-10-23: only RMC is always 18%** (see 33a).
2. ~~The AL ledger plan~~ ✅ **decided 2026-10-23: keep Excel, upload the final sheet monthly, the portal checks it** (section G).
5. **Stray cells** — owner 2026-10-23: "what do you want me to do here?" → read them myself (figures
   masked) and proposed a default per block; owner confirms. **What they hold:** 2025-26 AL = 59 DATES,
   each beside a filled ENDHAN (AK) + two "K-ENDHAN" labels → ❓ the Endhan given date? (if yes: an
   "Endhan Date" column) · AM = "REPLENISH" ×2, 4–5 lakh amounts, 1 formula → cell notes · PTB RETAIL
   AN = 4 lakh amounts, unlabelled → cell notes · DEALERS J = "DATE OF DELY" labels + 6 dates (+1
   "REPLENISH") → into Date of Delivery · DEALERS K = "RECD" ×3 → cell notes · DEALERS L = 15 DATES,
   unlabelled → ❓ what are they? Default for anything unanswered: a cell note on its truck (nothing lost).
   ✅ **Owner 2026-10-23:** AL dates = Endhan given date ("I believe so") → `endhan_date` (61a) · DEALERS L
   = "not sure" → cell notes · rows 720/948 GST = "not sure" → imported as billed (override). The import
   report lists all three groups so the team can correct any of them in the grid.
   Where they are (Ctrl+G):
   - `2025-26.xlsx` → `Sheet1`: column **AL** (61 cells, from AL142 down) and **AM** (AM742, AM946,
     AM1065 — a formula, AM1929, AM1962, AM1980, AM1981)
   - `INVOICE LIST - MAR 26.xlsx` → `PTB RETAIL`: **AN92, AN125, AN143, AN144**
   - same file → `DEALERS`: **J426–J444** (11 cells), **K437–K439**, **L2–L15** and on (15 cells)
