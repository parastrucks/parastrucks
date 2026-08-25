# TIV Forecast — UI/UX remediation roadmap (execution handoff)

**Written 2026-08-25** by the session that ran the six-lane red-team audit. This document is the
execution plan for **`tiv-uiux-audit-2026-08-25.md`** (same folder) — read that first; findings are
referenced here by its IDs (A1–A8, B1–B7, C1–C13). This file adds what the audit doesn't:
sequencing, dependencies, per-item acceptance checks, risk notes, and the gotchas the executing
session will otherwise rediscover the hard way.

**Status legend** — update in place as you go: `[ ]` open · `[~]` in progress · `[x]` shipped ·
`[!]` blocked (say on what). Commit this file with each wave so progress survives the session.

---

## 0. Required context before touching anything

1. `docs/backlog/tiv-uiux-audit-2026-08-25.md` — the findings. Every claim was re-verified against
   source at `44474bd`; trust the file:line cites but re-read the code you change.
2. `docs/TIV_FORECAST_MIGRATION_SPEC.md` — v3.0 authority. **Do not change forecast math.** This
   roadmap is UI/robustness only; every wave must leave engine outputs identical (§5 below proves it).
3. `docs/backlog/tiv-multi-entity-brand.md` — the OPEN silent-overwrite defect. Its fix order
   (constraint → scoped reads → selector) is owner-gated and **not part of this roadmap**, but two
   items here interact with it (marked ⚠️MB below).
4. Memory: `project_tiv_v3`, `project_tiv_uiux_audit`, `feedback_no_internal_browser`,
   `feedback_excel_parity`, `feedback_commit_each_fix`, `feedback_prove_dont_argue`.

**Ground rules (all learned the hard way — do not relearn):**
- **Never open the portal dev server in the browser pane** — 2 confirmed crashes, cause unknown.
  Verify with `npm run build`, node self-tests, and hand the owner a URL. Vite binds IPv6 only:
  `localhost:3000` works, `127.0.0.1` refuses.
- A worktree has **no `.env`** — copy the main checkout's in (targets staging) or dev boots blank.
- `git pull --rebase` off latest `origin/portal` before starting; commit each fix as it lands
  (owner reviews the running app, not diffs); stage specific files, never `git add -A`; after any
  push, CI all-green + Vercel READY before calling done.
- Python is not installed. PowerShell 5.1 for owner-facing commands (`;` not `&&`), Git Bash for
  your own.
- **No DB rows/columns/tables deleted without explicit owner approval.** Additive tables (the C7
  snapshot table) still get flagged to the owner before the migration is applied.
- Supabase MCP reaches the portal DB **only with explicit `project_id: "mmmxvjaavdtwlpcnjgzy"`**
  (`list_projects` won't show it). `execute_sql` is read-only; writes need `apply_migration`.
- EF deploys: `npx supabase@2.109.1 functions deploy admin-tiv --project-ref mmmxvjaavdtwlpcnjgzy
  --no-verify-jwt` (no Docker needed). Watch the upload list — `_shared/*` assets must travel.

---

## 1. Wave plan — recommended order and why

Order rationale: **first stop the product from lying** (cheap, pure-frontend, highest stakes),
**then make the one destructive workflow safe**, **then fix the shell** around the tables,
**then add the value layer**. Waves 1–3 are defect repair; wave 4 is where the owner's "novel
ideas" ask gets paid. Each wave is one PR (the repo's established rhythm), branch off latest
`origin/portal`, labeled `tiv-uiux-w1` … `w4`.

A wave is DONE when: its checklist is `[x]`, `npm run build` clean, the parity gate still passes
(§5), the PR is merged with CI green + Vercel READY, and this file's statuses are updated.

---

### Wave 1 — Stop the lies (audit A1, A2, A3, A6, A7, parts of A8) — pure frontend, no EF, no schema

The unifying insight: **almost every lie is a blank-vs-zero conflation at a boundary** (parser,
anchor lookup, judgment join, chart mapper). Fix the boundaries; the middle is sound.

- [x] **W1.1 (A6) Canonical month labels** — in `parseExcel.js`, all four sheet parsers store
  `meta.canonicalLabel` instead of the raw `label` (Raw-Data path already does; copy it). ~4 lines.
  **Do this FIRST** — several later checks assume label canonicality.
  *Accept:* feed a workbook cell "April 2026" through `parseExcelFile` in a node harness → row's
  `month_label === 'Apr-26'`.
- [x] **W1.2 (A2a) Skip all-blank actuals rows** — in `parseTivSheet`/`parsePtbSheet` (and the
  judgment parsers), skip a row when **all six segment cells are `''`**; keep rows with partial
  data. Then reject (throw, parser-level) when the derived `lastDataMonth` is in the future
  relative to today. *Accept:* pre-typed FY workbook → months stop at the last month with data.
- [x] **W1.3 (A2b) AL rows only when non-blank** — `parseRawDataSheet`: emit an AL row only when
  ≥1 AL cell is non-blank; in `retrainModel.computeRecentShares`, skip (don't zero) blank
  numerators. *Accept:* workbook with Apr-26+ headers but blank AL cells → `alActuals` ends
  Mar-26 → the "⚠ AL share as of Mar-26" chip **stays visible** (this is the real prize).
- [x] **W1.4 (A1) Anchor-miss → stale state, not zero** — `forecastEngine.baseForecast` returns
  `null` when `smly_plain?.[targetLabel]` is undefined (all three methods); `runForecast`
  propagates; page renders '—' cells + a red banner "Model stale — forecast columns exceed
  trained anchors. Upload the latest workbook." Guard the AL/PTB cascade (`Math.round(null*x)` is
  NaN — cascade null). *Accept:* node harness with a params row whose anchors end Oct-26 and a
  mocked system date of Nov-15 → all cells '—', banner text present, **no 0 anywhere**.
  ⚠️ Uses the browser clock (A8) — while here, derive "current month" in IST
  (`Asia/Kolkata` via `toLocaleString`) so the boundary is deterministic.
- [x] **W1.5 (A3) Judgment blanks stay blank** — `AccuracyTrackerTab.buildJudgmentBacktest`:
  `jRow[col] === null || jRow[col] === ''` → cell `{jVal: null, ae: null}` excluded from MAPE;
  Total only when all six present. *Accept:* unit-style harness — a 5-of-6 judgment row produces
  no 100% cell, judgment MAPE excludes it, Total renders '—'.
- [x] **W1.6 (A7) Zero-vs-missing cluster** — `SegmentAnalysisTab.jsx:16` → `Number.isFinite`
  check with `?? null` (real 0 survives, missing stays null) for BOTH TIV and PTB;
  `connectNulls={false}` on actual series (keep it for none — forecast series has no holes);
  `ForecastTable` totals → `?? '—'` semantics; flag partial `jTotal` (render only when complete).
- [x] **W1.7 (A8) Header + sheet validation in the parser** — assert `row[1..7]` header labels
  (case/space-insensitive) against the canonical names the template generator already encodes
  (`parseExcel.js:264-289`); match sheets by normalized name with positional fallback; per-row
  reconcile `tiv_total` vs Σ segments (tolerance ±1 for rounding), reject with an Excel-shaped
  message naming sheet + cell. *Accept:* insert a "Notes" column after Month in a test workbook →
  error says `expected 'Bus PVT' at column B, found 'Notes'`, nothing uploads.
- [x] **W1.8 (B7) MAPE framing + live caption** — one caption sentence ("26.4% is the average
  error of a single segment in a single month; the AL 15% tolerance applies to the Total-TIV
  column") + interpolate the backtest window from `months[]` instead of the hardcoded
  "(Aug-25 to Jul-26)". Keep "reference result 26.4/28.6" as-is (correctly labeled).

**Wave-1 risk note:** W1.2/W1.3 change what the parser emits, which changes what `retrainModel`
sees. Against the REAL Jul-26 workbook this must be a no-op — prove it with the parity gate (§5)
before and after. If parity moves, you changed behavior for real data, not just degenerate data —
stop and diagnose.

#### ✅ Wave 1 SHIPPED 2026-08-25 — branch `tiv-uiux-w1`

Commits: `a45b454` (docs) · `3798972` (parser) · `6a50352` (absence handling) · `af5aa81` (caption).
Verification at each step: parity gate **21/21 exact, 736/779/850, backtest 26.4%** (never moved),
`selftest-parser` **13/13**, `selftest-stale-anchors` **14/14**, `npm run build` clean.

**Four findings from executing it — read these before wave 2:**

1. **The 2022 PTB zeros are GENUINE zeros, verified cell by cell in the source** (`Apr-22`…`Oct-22`,
   with `Sep-22` showing 62 Haulage only — a real ramp-up). This is exactly why the guard skips
   **all-blank** rows and never all-**zero** rows: the obvious-looking version of this fix would
   have deleted six months of real history and moved the forecast. Tooling to re-check on any
   workbook: `scripts/tiv/diag-blank-zero.mjs` and `diag-raw-cells.mjs`.
2. **A1 was not hypothetical — it fires on 1 Sep 2026**, seven days after the audit. The current
   model is trained through Jul-26 with anchors Aug/Sep/Oct-26; on 1 Sep the window becomes
   Sep/Oct/**Nov**-26 and Nov had no anchor. Proven by running the real trained model at a mocked
   date. Now dashes + a red banner. **If the owner has since uploaded, re-run the self-test to
   confirm the window still fits before assuming it's quiet.**
3. **`docs`/`CLAUDE.md` next-action "Owner: supply AL/LM split for Apr-26 onward" is STALE.** The
   workbook now carries real AL figures through Jul-26 (Apr-26 = 10/95/31/24/30/44 …), so the AL
   share layer is *not* frozen at Mar-26 any more and the ⚠ chip is correctly hidden. Update that
   next-action rather than chasing it.
4. **There is no ESLint config in the repo** (`npx eslint` fails on missing flat config, and
   `package.json` has no lint script). `npm run build` is the real gate — don't report a lint pass.

Follow-on noted while in the code, deliberately deferred: the forecast series is keyed separately
from the actual series with no bridging datum, so the Segments chart draws a one-month visual gap
between history and forecast, and `SegmentChart` supports only horizontal (`y`) reference lines so
there is no "actuals end here" marker. Both are chart work — wave 3.

---

### Wave 2 — Make the upload safe (A4, B2, B3, C1, C7, C11, C13) — frontend + `admin-tiv` EF (+1 optional additive migration)

The unifying insight: **parse and retrain are pure client functions, so everything about this
upload can be known before the first byte is written.** The wave converts a blind write into a
reviewed transaction.

- [x] **W2.1 (B3) Decide + enforce the EF gate** — ⚠️ **OWNER DECISION**: `admin-tiv` currently
  accepts `back_office` with service-role writes. Recommend tightening `verify(req, ["admin"])`
  — reads don't go through this EF, so nothing breaks for viewers. One line + redeploy. If the
  owner instead wants back-office uploaders, render the panel for them (make the fiction true).
- [x] **W2.2 (B2) Un-vanish the success message** — keep the panel open on success (drop the
  auto-`setCollapsed(true)`) OR toast the success; add the result line to the collapsed header
  (C13: "Last upload: 24-Aug by Dhruv · data through Jul-26" — from `upload_history[0]`, already
  fetched). *Accept:* code-trace — success text renders in a subtree that exists post-commit.
- [x] **W2.3 (C1 ⭐ + B2) Dry-run diff modal** — after parse+retrain, BEFORE any write: per-table
  added/changed/unchanged month counts (diff parsed rows vs the in-memory `tivActuals` etc.),
  cell-level changes for overlapping months (cap the list at ~10 + "and N more"), current-vs-new
  Aug/Sep/Oct forecast deltas (run `runForecast` on both param sets), and the **entity/brand
  restated in the confirm button label** ("Overwrite 51 months for PTB / Ashok Leyland").
  Per-sheet counts (TIV 51 · PTB 51 · AL 48 · Judgment 12 · Raw 51) with an amber warning when
  AL/Raw = 0 while TIV > 0. ⚠️MB: this is the interim scream for the multi-brand overwrite
  ("51 of 51 cells changed" on an incremental upload) — until the constraint lands, treat a
  ≥90%-changed diff as a red warning state in the modal.
- [x] **W2.4 (A4) Atomic upload** — new `admin-tiv` action `uploadAll`: one payload with all six
  tables + params + history, written inside **one Postgres RPC transaction** (`SECURITY DEFINER`,
  revoke EXECUTE from `anon` AND `authenticated` — the EF's service-role client calls it). Client
  drops the 8-step chain for one call; progress bar becomes parse → train → diff → write.
  Fallbacks if the RPC route is too big for one PR: (a) keep steps but write history FIRST with
  `status='started'` and PATCH it (C11 — gives crash forensics + makes `beforeunload` honest),
  (b) split the history-insert into its own try so its failure can't mislabel a committed upload.
  **Minimum bar for this wave: (b) + per-step error messages** ("failed while writing AL actuals —
  TIV and PTB were already updated; re-upload the same file to complete").
  ⚠️ If `retrainModel`'s emitted column set changes AT ALL, run the insert probe (§5) — the EF
  inserts params as a spread; one missing column breaks upload.
- [x] **W2.5 (A4) Retrain/DB coverage guard** — before upload, compare parsed month span vs
  in-memory DB months: fewer months than the DB holds → hard warning in the diff modal ("this
  file has 12 months; the database holds 51 — the model would be retrained on the file only").
  Cheapest honest fix for retrain-from-file; full fix (retrain from DB re-fetch) is optional.
- [x] **W2.6 (C7) Snapshot-before-overwrite + Download current** — ⚠️ **OWNER FLAG (additive
  table)**: `tiv_forecast_snapshots(id, taken_at, taken_by, payload jsonb)`, RLS admin-only;
  insert inside the `uploadAll` transaction. Separately, a "Download current data (.xlsx)" button
  reusing the `XLSX.writeFile` pattern — this needs no schema and can ship even if the table waits.
- [x] **W2.7** `beforeunload` while `uploading`; map 401/"Invalid token" to "Your session is
  stale — sign out and back in, then retry" (known ES256 stale-session mode); entity/brand
  prefill from latest history row (⚠️MB: prefill reduces mis-picks — do NOT turn it into a free
  selector for new pairs; keep the dropdowns).
- [x] **W2.8 (B4-admin)** UploadPanel lookups surface errors: destructure `error` on
  `outlet_brands`, render inline error + retry for both lookups.

---

#### ✅ Wave 2 SHIPPED 2026-08-25 — branch `tiv-uiux-w2`, commit `18b5715`

Owner decisions taken: EF tightened to **admin-only** ✅ · `tiv_forecast_snapshots` **approved** ✅.
Migration `tiv_atomic_upload` applied to prod; `admin-tiv` redeployed (all four assets travelled,
incl. `keys.ts`). Verification: self-aborting probe through the **real function with a real
payload** — 60→61→60 rows, 18→19→18 params, snapshot payload carried all 7 keys, Jul-26 restored
to 85/162/810, zero residue; `selftest-upload-diff` **22/22**; parity **21/21 @ 26.4%**.

**Decisions made while executing, for the record:**
- **Went past the "minimum bar."** The roadmap allowed EF-orchestrated writes with per-step errors
  as a fallback. Since the snapshot table was approved anyway, a single PL/pgSQL body was the
  honest fix — Postgres runs a function atomically, so there is no compensating-rollback logic to
  get wrong.
- **`jsonb_populate_record(...).*` was a trap**, caught before applying: it supplies an explicit
  NULL `id`, which overrides the sequence default and violates NOT NULL. Columns are enumerated,
  and `trained_at` is coalesced for the same reason.
- **The interim 409 guard rode this wave** (roadmap decision #3, never formally asked). It only
  *refuses* a write that would have silently destroyed another entity/brand's dataset, so it is
  strictly protective — but it IS a behaviour change and the owner should know. It does **not**
  replace the constraint fix; order remains constraint → scoped reads → selector.
- **Old `upsertRows`/`insertModelParams`/`insertUploadHistory` actions were kept**, now admin-only,
  so a stale cached browser tab does not break mid-deploy. They can be removed once a release has
  fully rolled out.
- ⚠️ **Pre-existing React hook-order violation noticed, not fixed:** `UploadPanel` calls
  `useCallback` *after* `if (!isAdmin) return null`. Harmless today because `isAdmin` is stable per
  session, but new hooks must go above that early return (the `beforeunload` effect does).

**Still untested by a human:** nobody has run a real upload through the new path. The probe proves
the function and the transaction boundary; it cannot prove the browser wiring. **Ask the owner to
do one real upload** (the diff preview should show "0 new · 0 amended · 52 unchanged" for the file
already loaded) before assuming wave 2 is closed.

---

### Wave 3 — The shell: failure states, hierarchy, phone, a11y (B4, B5, B6, B7)

The unifying insight: **the 08-24 pass fixed the inside of the tables; nobody ever audited the
chrome around them for phones, keyboards, or failure.** Nothing here touches data flow.

- [ ] **W3.1 (B4) Failure-state triage** — `loadData` catch → persistent inline error card +
  Retry (keep the toast); `runForecast` catch → `console.error` + a distinct "Forecast could not
  be computed from the stored model — this is a fault, not missing data" state (NEVER the upload
  CTA); empty-state copy branches on `isAdmin` ("No data loaded for your entity/brand — contact an
  administrator" for non-admins). Early-return the Segments tab's tab-level empty state before the
  chart cards (kills the triple-stack).
- [ ] **W3.2 (B5) KPI header row** — three stat tiles above the tabs (next-month TIV / AL / PTB,
  judgment small underneath) from the existing `forecastResult`. Also surface C6 here: when
  `forecastMonths[0].horizon > 1`, an amber staleness banner for ALL users ("Data ends Jul-26;
  this forecast reaches N months beyond its data.").
- [ ] **W3.3 (B6) Phone shell bundle** — `.tiv-tabs { overflow-x: auto }` (+ same for
  `.tiv-tabs-sm`); UploadPanel header → real `<button>` with `aria-expanded`; file input →
  visually-hidden-clip pattern (NOT `display:none`); trigger checkbox `aria-label={def.name}`,
  slider `aria-label`/`aria-valuetext`; delete `.tiv-slider { outline: none }` + add thumb
  focus-visible ring + 20px thumb under the existing mobile block; show-values toggle →
  `btn btn-ghost btn-sm` (drop `padding:0`); `role="img"` + `aria-label` on chart containers +
  visually-hidden data table for the Segments charts; `role="progressbar"`+`aria-live` on upload
  progress, `role="status"` on success + spinner; severity word appended to accuracy cell
  aria-labels; drop per-cell `tabIndex` (the toggle is the keyboard path — kills 168 tab stops)
  or implement roving tabindex if you're feeling thorough; `tabIndex={0} role="region"` on
  `.tiv-scroll` (pattern documented at `index.css:1504`).
- [ ] **W3.4 (B6) Contrast pass** — new token `--text-secondary-on-paper: var(--gray-600)` used
  by `.tiv-meta`, resting `.tiv-tab`, captions/notes on page ground, and the revealed
  `.tiv-cell-actual`/`.tiv-cell-sep`; Recharts `Legend formatter` → gray-700 text; PTB series
  colors → gray-600 solid / gray-500 dashed. Fix the stale "4.8:1" CSS comment while there
  (actual: 4.56/4.57). Show the arithmetic in the PR description (owner precedent).
- [ ] **W3.5 (B6) Touch reveal: tap-for-detail bottom sheet (C9)** — `ErrCell onClick` → one
  state `{month, col}` → fixed bottom card (`role="status"`) with the full payload incl. judgment
  peer; Escape/second-tap dismisses. Desktop keeps the hover.
- [ ] **W3.6 (B7) Structural** — `?tab=&layer=&seg=` search params (read on mount, `replace` on
  change); sticky first column on `.tiv-table` (`th[scope="row"] { position: sticky; left: 0;
  background: var(--white); z-index: 1 }` + right-edge fade cue on `.tiv-scroll::after`);
  trigger banner un-ellipsized with magnitudes (`Monsoon −10%`) moved into the shared meta banner
  (A5) + "personal what-if — changes only your view" caption + Reset-all button
  (`buildDefaultTriggerState()` exists) + surfaced save failures (kill the `.catch(() => {})`);
  `title=`-only content (judgment-free explainer, disabled-Upload reason) into visible text;
  GM vocabulary ("Industry / Ashok Leyland / Our sales", "Scenario adjustments") — keep layer
  numbers as small prefixes.

---

### Wave 4 — The value layer (C2, C3, C4, C5, C8, C10, C12) — ship in this order

All pure-frontend formatters over data already on the client. Each is independently shippable;
stop wherever the owner says stop.

- [ ] **W4.1 (C3) Uncertainty** — per-segment empirical range from `model_backtest`:
  `736 ⟨646–826⟩` sub-line (reuse the `tiv-sub` share pattern) + tolerance-odds line
  ("within AL's 15% in 9 of 12 backtest months", ●▲■ vocabulary). Recommend range = the middle
  10 of 12 backtest abs errors (drop best+worst) applied symmetrically; document whatever you
  choose in the UI caption — the method must be inspectable, not mystical.
- [ ] **W4.2 (C2) "Why this number" receipt** — click a forecast cell → popover/bottom-sheet
  with the 3–4 line derivation per method (ROB/THETA/ADAPT templates; all inputs in
  `model_params`). Include active-trigger multipliers when present.
- [ ] **W4.3 (C4) Model-vs-judgment scoreboard** — card row above the MAPE chart: per segment,
  months-closer count + cumulative units of error saved; headline "model closer in N/12 months,
  M units less error over the year".
- [ ] **W4.4 (C5) Trigger delta preview** — run base + adjusted `runForecast`; struck-through
  baseline next to adjusted in tables (`~~761~~ → 736`), live per-trigger impact on the trigger
  card while dragging.
- [ ] **W4.5 (C12) WhatsApp one-liner + copy-table** — per-table copy button writing
  `text/html` + TSV dual-flavor clipboard; header chip writing the one-liner
  (`TIV forecast Aug/Sep/Oct-26: 736 / 779 / 850 (model v3.0, trained 24-Aug)`).
- [ ] **W4.6 (B1) Export + print** — "Download forecast (.xlsx)"; round-trip export in the
  workbook's own prediction-sheet shape (C8; headers already encoded in the template generator);
  minimal `@media print` block (`.tiv-scroll { overflow: visible }`, hide chrome, 10px tables).
- [ ] **W4.7 (C10) Forecast-vintage ghost line** — needs a `fetchModelParamsHistory` (last N
  rows by `trained_at`); plot prior vintage faintly on the Segments chart with a legend entry.
  ⚠️MB: params rows are NOT entity/brand-scoped in reads — after the multi-brand constraint fix,
  scope this fetch too.

---

## 2. Owner decisions to collect (batch them in ONE message, early)

1. **B3 / W2.1** — tighten `admin-tiv` to admin-only, or officially allow back-office uploaders?
   (Recommend tighten.)
2. **C7 / W2.6** — approve the additive `tiv_forecast_snapshots` table? (Download-as-Excel ships
   regardless.)
3. **Interim 409 guard** from `tiv-multi-entity-brand.md` — still pending from 2026-08-24; wave 2
   touches the same EF, cheapest moment to add it. (Recommend yes, ride wave 2.)
4. **Uncertainty display** (W4.1) — ranges on the main table by default, or behind a toggle?
   (Recommend default-on sub-line; it's the honesty feature.)
5. How far down wave 4 to go before Phase 10 resumes.

## 3. What NOT to do (re-audited and judged correct as-is)

No sorting/filtering on the 7-row forecast tables · no arrow-key grid navigation · no reordering
of the accuracy table away from chronological · no dark-mode work (light-locked; verified no
half-dark state possible) · no calendar/holiday logic revival (v3.0 retired it) · **no change to
`V3_METHOD` or any engine math** (re-trial checkpoint is after Oct-26 actuals) · no viewing
selector for entity/brand until the constraint fix lands (fix order is owner-mandated).

## 4. Verification protocol (every wave)

1. **Parity gate** — before your first change and after each wave:
   `npx esbuild scripts/tiv/parity-gate.mjs --bundle --platform=node --format=esm --outfile=<tmp>/parity.mjs`
   then `node <tmp>/parity.mjs "docs/Market Data 22-27.xlsx"` → expect **21/21 exact,
   Aug/Sep/Oct-26 = 736/779/850, backtest 12 rows @ 26.4%**. ⚠️ Valid only while the gitignored
   workbook is the trained-through-Jul-26 one; if the owner has uploaded a newer workbook, capture
   fresh reference numbers with the gate BEFORE changing code, and use those. If the workbook file
   is missing, ask the owner for its path — do not skip the gate.
2. **Insert probe** — mandatory if `retrainModel`'s output shape changes (W2.4 risk):
   `scripts/tiv/emit-insert-probe.mjs` (same esbuild bundling) emits a self-aborting `DO` block;
   run via MCP `apply_migration` with explicit portal `project_id` → expect `PROBE_OK`, zero
   writes committed.
3. `npm run build` clean; `npx eslint` on touched files. ⚠️ `npx` invocations drift
   `node_modules` — if you ever A/B build outputs, run a two-build control first (lesson from the
   nanoid proof).
4. EF changes: deploy `admin-tiv` with `--no-verify-jwt`, confirm the asset upload list, then
   exercise one real call.
5. Per-item accept checks as written above; node harnesses over dev-server clicking wherever
   possible (browser-pane ban).
6. PR merged → CI all-green + Vercel READY + prod `/` and `/login` = 200.

## 5. Insights that don't fit a checklist (synthesizer's notes)

- **The engine is sound; the boundaries lie.** Every wave-1 defect is a coercion at an interface
  (`|| 0`, `?? 0`, `Number(null)`, raw labels). Fix at the boundary where the semantic is known
  (parser knows blank-vs-zero; the render layer can only guess). Resist "fixing" downstream.
- **Blank ≠ zero is THE recurring bug class of this codebase** (v2.1's harness bug was also a
  degenerate-input problem). When in doubt: preserve null through the whole pipe and decide at
  render time.
- **Convergence = confidence.** Export gap, zero-vs-null, and trigger labeling were found by 3
  independent blind lanes each — treat those as certain. Single-lane LOWs were still verified but
  deserve a second look in context.
- **The diff modal (C1) is the keystone**, not a nice-to-have: it fixes B2 (blind click), rescues
  the vanishing success message's job, guards A4's partial-workbook poisoning (W2.5 lives inside
  it), and is the only pre-constraint alarm for the multi-brand overwrite. If wave 2 ships one
  thing, ship this.
- **A1's fix must distinguish "stale" from "empty".** The whole point is a THIRD state — do not
  collapse it into the existing empty-state component or you recreate B4.
- **Touch ≠ hover-with-fingers.** `title=` never fires on touch on any mobile browser; sticky
  `:hover` on tap is flaky and un-designed. Any hover affordance you add needs a tap path (the
  bottom-sheet pattern generalizes).
- **Trigger state is per-user by RLS design** — the fix is labeling, not sharing. Do not "fix" it
  by making trigger state global; that would let one GM silently bend everyone's numbers.
- **Parity-gate discipline:** waves 1–2 touch `parseExcel`/`retrainModel`/`forecastEngine` inputs.
  The gate is what separates "hardened against degenerate workbooks" from "changed the forecast".
  Run it obsessively; a moved number is a stop-the-line event.
- Prod holds real data (16+ `model_params` rows, id 19 = the verified Jul-26 training). Nothing in
  this roadmap writes to prod outside the normal upload path — keep it that way; test uploads go
  to staging (`klpnhpnlotcbbovwswmq`, if revived) or through the insert probe.

## 6. Current state at handoff

- Audit + this roadmap live in `docs/backlog/` — **uncommitted in worktree
  `tiv-estimation-methodology-ce38b9`** (branch `claude/tiv-estimation-methodology-ce38b9`,
  synced to `44474bd` = `origin/portal` at audit time) until the owner okays the docs commit.
- Memory checkpoint: `project_tiv_uiux_audit` (lane-by-lane verified findings + agent-transcript
  recovery paths, if the raw lane reports are ever needed again).
- No code has been changed. No wave has started. Owner has seen the top-5 findings and the
  proposed wave order (numbers-lie → upload safety → phone shell) in chat and has not yet chosen.
