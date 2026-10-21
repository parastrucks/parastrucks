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
| 15 | `ctc` | numeric | IN | IT `CTC` (+ RETAIL/FY/RET `CTC`) | 26.5% cross-file conflicts → conflict report |
| 16 | `ctd` | numeric | IN | IT `CTD` (+ RETAIL `CTD`, RET `CTD`, AL BS `CTD`) | hand formulas like `2055000/1.28*1.18` → kept as a cell note |
| 17 | `ctc_basis` | `inclusive` \| `exclusive` | IN | derived once on import (N1) | 530/2050 exclusive |
| 18 | `amc_to_al` | numeric | IN | IT `AMC/SERVICE` | |
| 19 | `dsa` | numeric | IN | IT `DSA` | |
| 20 | `ad_blue` | numeric | IN | IT `AD BLUE` | `1310*8` style → value + cell note |
| 21 | `retention_dealer` | numeric | DB | IT `Retention` | `IF(ctc=0, 0, ctc − ctd − amc − dsa − ad_blue)` |
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
| 32 | `diff_base` | numeric | DB | `Difference - Base Value` | `… / 1.28` ❓Q1 GST rate |
| 33 | `diff_gst` | numeric | DB | `Difference - GST` | `… × 0.28 / 1.28` ❓Q1 |
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
| 46 | `total` | numeric | DB | `TOTAL` | `ctc + tcs` |
| 47 | `margin_money` | numeric | IN | `MARGIN MONEY` | |
| 48 | `finance_recd` | numeric | IN | `FINANCE RECD` | |
| 49 | `finance_paymt_recd_date` | date | IN | `FINANCE PAYMT. RECD DATE` | a DATE — never summed |
| 50 | `subvention` | numeric | IN | `SUBVENTION` | |
| 51 | `total_recd` | numeric | DB | `TOTAL RECD` | `margin_money + finance_recd + subvention` |
| 52 | `insurance` | numeric | IN | `INSURANCE` | |
| 53 | `cretem` | numeric | IN | `CRETEM` | raw (11+ values) |
| 54 | `full_tax` | numeric | IN ❓Q2 | `FULL TAX` | sheet: `MRP / 1.18 × 6%` on 240/266 + 1,630/2,015 rows, typed on the rest |
| 55 | `total_receivable` | numeric | DB | `TOTAL RECEIVABLE` | `total + insurance + cretem + full_tax` |
| 56 | `net_refund` | numeric | DB | `NET REFUND` | `total_recd − total_receivable` |
| 57 | `refund_status` | text | IN | `Refund Status` | 11 spellings → normalised list on import |
| 58 | `delivery_status` | text | IN | `Delivery Status` | |
| 59 | `payment_status` | text | DB | `Payment Status` | `IF(delivery_status='Stock','Stock', IF(no finance_paymt_recd_date,'Pending','Payment Recd'))` |
| 60 | `ad_blu_given` | text | TXT$ | `AD-BLU` | carries DSA/URIYA deals too |
| 61 | `endhan` | text | TXT$ | `ENDHAN` | 84 numeric rows in FY |
| — | ~~`subvention_status`~~ | | dropped | `Subvention Status` | blank (0 RETAIL, 4 FY) — ❓Q6 the 4 FY values |

## D · Retention and incentives (RETENTION TRACKER internal + AL)

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 62 | `dsm` | text | IN | RET-INT `DSM` | |
| 63 | `date_of_retail` | date | IN | RET `DATE OF RETAIL` | the incentive month key |
| 64 | `date_of_delivery` | date | IN | RET `DATE OF DELIVERY` | |
| 65 | `other_deductions` | numeric | IN | RET `Other deductions` | ✅ a separate figure: equals IT amc + dsa + ad_blue on **0 of 167** filled rows |
| 66 | `retention_internal` | numeric | DB | RET-INT `Retention` = RET-AL `Diff between CTC and CTD` | `ctc − ctd − other_deductions` |
| 67 | `retention_al_claim` | numeric | IN | RET-AL `Retention` | negotiated, ₹500 steps — never computed |
| 68 | `app_amt` | numeric | DB | RET-AL `App Amt` | `retention_al_claim − retention_internal` |
| 69 | `retention_remarks` | text | IN | RET `Remarks` | |
| 70 | `sale_category` | text | IN | RET-AL `Sale Category` | |
| 71 | `al_invoice_no` | text | IN | RET-AL `AL Invoice No.` | |
| 72 | `dealer_invoice_no` | text | IN | RET-AL `Dealer Invoice No.` | |
| 73 | `al_claim_age` | int | IN | RET-AL `Age` | typed, no formula |
| 74 | `al_claim_interest` | numeric | IN | RET-AL `Interest` | typed, no formula |
| — | `dse_incentive` | — | SCREEN, HID | RET-INT `DSE INCENTIVE` | monthly slab on that DSE's count: <5 → 0, <9 → 1,200, <13 → 1,500, else 1,800 |
| 75 | `dse_incentive_override` | numeric | IN, HID | — | SRS rows are zeroed by hand (60 rows); shown as overridden |
| 76 | `dsm_incentive` | numeric | IN, HID | RET-INT `DSM INCENTIVE` | |
| 77 | `gm_incentive` | numeric | IN, HID | RET-INT `GM INCENTIVE` | |
| ❓ | three unnamed columns | ? | ❓Q4 | RET-INT columns **T, U, V** — filled on all 268 rows | numbers on most rows; the text ones are shaped like `35K-DSA`, `10K-URIYA & 5` (deal notes, like AD-BLU). Equal to no known column. **What are they?** |

## E · Inter-dealer and cancel/rebill

| # | Column | Type | Role | Source | Notes / formula |
|---|---|---|---|---|---|
| 78 | `sold_to_dealer` | text | IN | DEALERS `NAME OF DEALER` | chassis sits under the "Model" header there (R2-5) |
| 79 | `dealer_basic_value` | numeric | DB | DEALERS `BASIC VALUE` | `ctd / 1.28` ❓Q1 |
| 80 | `dealer_tds` | numeric | DB | DEALERS `TDS( 0.1%)` | `dealer_basic_value × 0.1%` |
| 81 | `dealer_net_payable` | numeric | DB | DEALERS `NET PAYABLE` | `ctd − dealer_tds` |
| 82 | `vehicle_location` | text | IN | canc rebill `Vehicle Location` | ❓Q7 keep the cancel/rebill columns? |
| — | cancel/rebill link | | system | canc rebill `NEW CHASSIS NO` | becomes `superseded_by_id` (decision: superseded rows) |

## F · System columns (not typed by anyone)

`id` uuid · `superseded_at` · `superseded_by_id` · `notes` (long text) · `user_field_1..5`
(admin-labelled scratch) · `source_file` · `source_row` · `import_batch_id` · `recompute` (false
only while the importer writes history — R2-25) · `created_at/by` · `updated_at/by`.
Side tables: `unit_cell_notes` (the 124 Excel comments + new ones) · `unit_cell_formats` (the ~148
highlights; the Univer formatting store) · `tracker_audit` · `tracker_views` · `customer_settlements` +
`settlement_items`.

**Count:** 82 stored business columns + 3 screen-only + system columns. The `AL Balance Sheet` is a
ledger (dated debit/credit lines), not one row per chassis — ❓Q8.

## ❓ Questions for the owner (the schema waits on these)

1. **GST rate in the formulas.** INVOICE TRACKER's difference columns and the DEALERS sheet divide by
   **1.28** (28% GST) on every row; the retail road-tax formula divides by **1.18** (18%). Trucks and
   buses moved from 28% to 18% in September 2025. Should the rate follow each row's invoice date
   (28% before the change, 18% after), or is 1.28 deliberate there?
2. **Road tax (`FULL TAX`).** Calculated as MRP ÷ 1.18 × 6% on most rows, typed on some. Calculate it
   with a visible override (like the DSE incentive), or keep it typed?
3. ~~Other deductions~~ — ✅ answered by the data: a separate figure (0 of 167 rows equal AMC + DSA + Ad Blue).
4. **Retention tracker (internal), columns T, U, V** have no header but are filled on every row —
   mostly numbers, the rest deal notes like `35K-DSA`. What are they?
5. ~~CBN = V-part?~~ — ✅ answered by the data: yes, 265 of 266.
6. **Subvention Status** is blank except 4 rows in 2025-26 — drop it?
7. **Cancel/rebill sheet** — keep its location/delivery columns, or only link the old and new chassis?
8. **AL Balance Sheet** — leave it as its own ledger (out of the tracker), or bring in per-chassis
   fields (its `Offtake Mode`)?
9. Unlabelled columns elsewhere: 2025-26 `AL`, `AM`; PTB RETAIL `AN`; DEALERS `J`–`L` (a few values
   each) — notes, or real data?
