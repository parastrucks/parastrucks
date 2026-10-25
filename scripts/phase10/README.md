# Phase 10 — workbook re-derivation scripts

These are the scripts behind every empirical number in
[`docs/backlog/phase10-review-round2.md`](../../docs/backlog/phase10-review-round2.md).
They are **read-only** — they open the back-office Excel files and print counts. They
never write.

They exist so no Phase 10 claim has to be taken on faith. If a number in the plan looks
wrong, re-run the script and check.

## Running

Run from the repo root. Needs Node and the repo's `xlsx` dependency (SheetJS 0.20.3, already in `package.json`).
Python is not installed on this machine — these are Node, deliberately.

```bash
node scripts/phase10/inventory.cjs
```

Run from the repo root. The workbook paths are absolute and hard-coded at the top of each
script (the files live outside the repo, under `D:\PTB\Finances\` and
`C:\Users\dhruv\Downloads\PAYMENT TRACKER LIST 2025-26\`) — edit them if the files move.

| Script | What it derives |
|---|---|
| `inventory.cjs` | Sheet inventory: row counts, formula counts, cell-comment counts per sheet |
| `a_claims.cjs` | Duplicate chassis, cross-file conflict rates (CTC 26.5% etc.), the FY multi-layout break, the DEALERS column mislabel |
| `b_it_formulas.cjs` | INVOICE TRACKER money formulas, the per-column formula-variance scan, the comment census, qty |
| `c_sale_g.cjs` | Sale-side formulas (**TCS basis**, total, CRETEM), text-in-money columns, settlement/G-series numbers, VIN decode, DSE slab |
| `d_followup.cjs` | Three-way retention relationship, empirical VIN month mapping, the SRS incentive override |
| `columns.cjs` | Every header of the data sheets with its shape (fill, number/text/date counts, dominant formula) — the input to [`phase10-column-map.md`](../../docs/backlog/phase10-column-map.md). Prints no cell values |
| `gst_rmc.cjs` | Which trucks were billed at 18% before the GST change (the RMC rule; rows 720 / 948) |
| `al_balance_check.cjs` | The 12 monthly AL Balance Sheets checked against the invoice tracker — what the monthly upload would flag (counts and chassis only) |
| `e_sources.cjs` | The import's sources: which files hold which trucks, overlaps, and where they disagree, per column — the evidence for the importer's home files |

## The first-load importer (`import/`)

Real data passes through these; they print COUNTS ONLY and write their output OUTSIDE the repository
(`run.cjs` refuses a folder inside it).

| Step | Script | What it does |
|---|---|---|
| 1 | `import/read.cjs` | Workbooks → rows, each cell with value, formula, comment, fill, number format. A file is recognised by its sheets + headers, never its name |
| 2 | `import/merge.cjs` | One record per truck: a HOME file per column (`RULES`, measured), every other file's different value kept as a note; comments, flag colours, hand formulas, overrides, incentives, rebill links |
| — | `import/run.cjs` | `node scripts/phase10/import/run.cjs <scratch folder> [files/folders]` → `import.json` + counts. No files given = EVERY year on this PC (2022-23 →), ordered by year then month; refuses two copies of one year's purchase/sales book (`ALLOW_OVERLAP=1` overrides) |
| 3 | `import/sql.cjs` | `node scripts/phase10/import/sql.cjs <scratch folder> <actor uuid>` → `import.sql`: ONE transaction, `recompute = false`, one import batch |
| 4 | `import/recompute-diff.sql` | Self-aborting: per worked-out column, how many imported rows the database's rules would give another figure |
| 4b | `import/recompute-by-year.sql` | The same, split by financial year — do the rules hold for older years? |
| test | `selftest-import-merge.cjs` | The merge rules on made-up rows (39 checks) — `node scripts/phase10/selftest-import-merge.cjs` |
| test | `selftest-import-read.cjs` | The reader on made-up workbooks: the older layouts land in the right families under the newer names (12) |

## Tests of the tracker itself (Stage 1)

| Script | What it proves | How to run |
|---|---|---|
| `probe-foundation.sql` | The schema: every formula on both sides of both switch dates, the write procedure, grants (42 checks) | `supabase db query --linked -f` (staging) or PGlite; **self-aborting** — green ends in "PROBE COMPLETE: N passed, 0 failed" |
| `probe-supersede.sql` | Rebill in one transaction (19 checks) | same |
| `probe-numeric-before.sql` | A stored 1310.50 is not a conflict against a browser's 1310.5 (9 checks; the old function fails 3) | same |
| `probe-create-units.sql` | New rows from the grid: one savepoint per row, a duplicate chassis fails alone and by name, a repeated request replays (18 checks) | same |
| `probe-rmc-gst.sql` | RMC = 18% on any date; an override still wins (9) | same |
| `probe-endhan-date.sql` | The Endhan Date column: stored, typed, audited, cleared (6) | same |
| `probe-mto-advance.sql` | The MTO Advance Yes/No column; the table refuses anything else (6) | same |
| `probe-al-retail-date.sql` | The AL Retail Date column: stored, typed, audited, cleared; the internal date untouched (6) | same |
| `probe-two-ctc.sql` | Two CTCs: Retention + App Amt on AL CTC, Total + internal retention on PTB CTC, a blank AL CTC = PTB (9) | same |
| `probe-working-set.sql` | tracker_book: the working set (this year + still open), a year, ids; columns + no empty cells; incentives only when asked; notes/colours of the page only; whole-book DSE counts; pages add up; no API grant (16) | same |
| `load-x4.sql` | STAGING load test: 11 copies of the DEMO seed (~24,600 trucks, 34k notes, 6.6k colours), one batch "DEMO LOAD x4" | `db query --linked -f` (refuses twice) |
| `load-x4-shape.sql` | Makes those copies look like years of history (dates spread back, most closed); `share` 0.35 = pessimistic, 0 = steady | same |
| `selftest-tracker-cells.mjs` | The screen's own logic: grid cell ↔ database value, the save planner, the new-row planner, cell colours, the paid rule, the screen columns, Find, Copy for mail, history text, the financial year; a source contract: no `push(...)` / `Math.max(...)` spread in `src/tracker` (155) | `node scripts/phase10/selftest-tracker-cells.mjs` |
| `selftest-load-book.mjs` | The working set's paging: pages in order, one at a time, merged, progress, retry 1.5 s / 3 s, third failure reported (19). Fakes only `callEdge` (a loader hook) | `node scripts/phase10/selftest-load-book.mjs` |
| `selftest-vehicle-units.mjs` | The Edge Function's own modules: drift against ALL the tracker migrations (columns added later, the newest allowlist), every person × action, every value check (556) | `node scripts/phase10/selftest-vehicle-units.mjs` (Node 24 strips the types). `AUTHORITY_FILE=<path>` runs it against another authority file (mutants) |
| `probe-ef-tracker.mjs` | The DEPLOYED functions on staging, as real logins: gate, switch, write path. **Writes dummy data** (see its header) | owner: `$env:PROBE_PASSWORD = '…'; node scripts/phase10/probe-ef-tracker.mjs; Remove-Item Env:\PROBE_PASSWORD` |

## The one that matters most

`c_sale_g.cjs` is what caught round 1's inverted TCS formula: `tally_bill × 1%` matches
**266/266** rows while `ctc × 1%` matches only 65.8%. The two agree wherever
`tally_bill == ctc`, which is why a high-looking score hid a wrong basis. That failure
mode — a confident conclusion resting on uniformity the data doesn't have — is the reason
these scripts are committed rather than described.

## Cell formatting

The formatting census (0 bold / 0 italic, `#C6EFCE` on one rule-driven column, ~148 manual
yellow/red highlights) was derived with inline `node -e` calls using
`XLSX.readFile(path, {cellStyles: true})`. SheetJS CE **does** populate `cell.s` for xlsx —
worth knowing, as it is commonly assumed to be a Pro-only feature.
