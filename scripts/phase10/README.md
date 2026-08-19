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
