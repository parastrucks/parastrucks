# The team's file pile — the analyses behind the 2026-10-26/27 findings

One-off, READ-ONLY analyses of `D:\PTB\Finances\Backup data` (the only folder the owner allowed). Each prints COUNTS
(and file names / column headings) only — never a chassis number, amount or customer. Most take the repo root as their
first argument (for SheetJS): `node scripts/phase10/import/pile-analysis/<file>.cjs "$PWD" [...]`. The source path is
written at the top of each; they read the outputs of `inventory.cjs` / `vehicle-scan.cjs` in `_Sorted\_Inventory`.

| Script | Question it answered |
|---|---|
| `salesbooks.cjs` | Which sales book is final for a year? (every candidate: trucks, filled cells, months, last date, which others it holds) — `… "$PWD" "D:/PTB/Finances/Backup data" 2023-24 2024-25` |
| `master.cjs` | The master `PAYMENT TRACKER FROM NOV22 ONWARDS.xlsx`: its sheets, and how many of the monthly files' trucks it holds |
| `space.cjs` | Where the 134 GB goes: duplicates by kind and PC folder, installers, lock files (takes the inventory.csv path) |
| `missing-files.cjs` | The files holding the most trucks not in the sorted books: headings and in/not-in counts per sheet |
| `missing-classify.cjs` | Each truck not in the books → the kind of list it is on and its date → `vehicle-check\missing-classified.csv` |
| `missing-own.cjs` | Yard stock registers + DMS sales data: status / type / plant values, in-books vs not |
| `stock-invoice-shape.cjs` | The stock-register-only trucks vs in-book ones: invoice-number shape, plant, receive month |
| `invoice-list-test.cjs` | The deciding test: 2025-26 yard receipts on AL's "Invoice List 2025-26" — in-books 673/797, missing 0/51 |

Results and conclusions: `docs/history/PORTAL_HISTORY.md` → "Session log — 2026-10-26 → 10-27".
