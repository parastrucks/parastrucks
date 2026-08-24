# TIV Forecast — UI/UX red-team audit (2026-08-25)

**Method:** six adversarial lanes (first-contact/hierarchy · data comprehension · Excel parity ·
a11y+touch · misleading-numbers · admin journey) run as parallel read-only source audits against
`44474bd` (= prod), each blind to the others. Every finding below was **re-verified against the
real source by the synthesizing session** — citations that did not hold were dropped or corrected.
No dev server, no browser pane (`memory/feedback_no_internal_browser`).

**Out of scope (already documented):** the entity/brand viewing selector + global
`UNIQUE (month_label)` silent-overwrite defect (`tiv-multi-entity-brand.md`), the labeled Mar-26
AL-share freeze, and the shipped Accuracy hover reveal.

**Prior a11y pass (2026-08-24) verified as holding:** captions, `th scope`, cell `aria-label` +
`tabIndex`, severity shapes ●▲■, the two contrast fixes. One recorded number is wrong: the CSS
comment claims the reveal fill keeps semantics "at 4.8:1"; actual = green 4.56:1 / amber 4.57:1
(still passing).

---

## A. The numbers can lie — correctness-of-display (highest stakes)

Stock orders ride on these numbers; every item here produces a **confident-looking wrong number**.

### A1 · 🔴 Anchor-miss on month rollover — a monthly recurring window of silent zeros
`retrainModel.js` step 6 writes SMLY anchors **only for the 3 labels after `last_data_month`**;
`forecastEngine.js:97-102` skips the forecast window forward on the **browser clock**; a missing
anchor hits `?? 0` (`forecastEngine.js:129-130`). On the 1st of any month before that month's
upload: ROB segments render a bold **0** (`ForecastTable.jsx:100` passes 0 as a real value), THETA
renders a plausible ~60%-low number (`0.6·0 + 0.4·theta·SI`), charts draw 0-height slices, and the
AL/PTB layers cascade it. Nothing links the "Last data" chip to the dead columns.
**Fix:** `baseForecast` returns `null` when `smly_plain[targetLabel]` is absent → cells render '—'
+ a red "model stale — forecast horizon exceeds trained anchors" banner.

### A2 · 🔴 Blank Excel cells become real zeros (`Number(x) || 0`) — two live scenarios
Parser coerces every blank/text cell to 0 (`parseExcel.js:71-77, 217-219`) and accepts any row
whose month label parses:
- **Pre-typed future months** (normal Excel habit: fill the Month column for the FY): zeros enter
  `tiv_actuals`, `last_data_month` jumps into the future, `yoy_t12` pins −15%, seasonals poisoned;
  the Accuracy tab **greys those months** (`absErr` nulls on 0-actual) so nothing flags it.
- **Blank AL cells under present month headers** (the known AL/LM lag): `parseRawDataSheet` emits
  an AL row for *every* month header → `lastAlMonth` advances → the "⚠ AL/PTB share as of…" chip —
  the one safeguard — **disappears** (`TivForecastPage.jsx:151`); the share drags toward the 5%
  floor on partial blanks or, at exactly 0, hits `al_share_recent[seg] || 0.5` and renders a
  default-looking **50%**.
**Fix:** skip actuals rows whose six segment cells are all blank; emit AL rows only when ≥1 AL cell
is non-blank; reject a `lastDataMonth` in the future; treat blank as null (skip) in
`computeRecentShares`.

### A3 · 🔴 Accuracy tab invents "Judgment predicted 0" — and flatters the model
`AccuracyTrackerTab.jsx:38-45`: `Number(jRow[col])` on a legitimately-blank judgment cell
(`parseExcel` preserves null) gives 0 → `absErr(0, actual)` = a fake red **100% error**, hover
asserting "Judgment 0". Totals sum partial rows as complete. Every fake 100% inflates judgment
MAPE — systematically biasing the model-vs-judgment verdict this tab exists to render.
`ForecastTable.jsx:94` handles the *same* null correctly ('—'), so two tabs disagree about what
judgment said. **Fix:** null judgment cell → skip (excluded from MAPE); Total only when complete.

### A4 · 🔴 Non-atomic upload + retrain-from-file: half-states, ghost months, no undo
`UploadPanel.jsx:122-183` runs **8 sequential EF awaits in one try** (6 upserts → client
`retrainModel(parsed rows)` → `insertModelParams` → `insertUploadHistory` last):
- Mid-chain failure → prod half-overwritten (e.g. new TIV+PTB actuals under the **old** model),
  error toast names no step, no history row exists at all.
- History-insert failure alone → **"Upload failed" toast for a fully-committed upload**.
- Retrain uses only the file's rows while upsert merges into the DB → a 12-month partial workbook
  trains a poisoned model (flat seasonals, empty backtest); no minimum-months gate.
- Upsert-only writes mean a bad month, once uploaded, **can never be removed** by re-upload.
**Fix:** one `uploadAll` EF action (ideally a single RPC transaction); retrain from a DB re-fetch
or validate file-vs-DB coverage; surface `max(actuals.month_index)` vs `model.last_data_month`
disagreement as a warning chip; per-step error messages.

### A5 · 🟠 Trigger-adjusted numbers masquerade as the official forecast
One shared `forecastResult` feeds all tabs; the "Active: …" banner exists **only** on the Forecast
tab (`ForecastOutputTab.jsx:72-81` — also nowrap+ellipsis, names only, no magnitude/direction).
The Segments tab charts the same adjusted numbers with zero markers — under a page banner reading
"Judgment-free forecast". Trigger state **persists per-user** (`tiv_forecast_trigger_state`,
`user_id` RLS) so a toggle from weeks ago silently shapes every session; saves fail silently
(`saveTriggerStateRow(...).catch(() => {})`, `TivForecastPage.jsx:100`); nothing says the sandbox
is private; no reset-to-defaults exists. **Fix:** move the active-trigger chip into the shared meta
banner with magnitudes (`Monsoon −10%`), caption "personal what-if — changes only your view", add
Reset-all, surface save failures.

### A6 · 🟠 Tolerant month formats stored raw → duplicate months and a blank forecast tab
`parseMonthLabel` accepts "April 2026" and computes `canonicalLabel` (`parseExcel.js:44`) — which
**4 of 5 parsers then discard**, storing the raw string. Consequences: `onConflict: month_label`
treats "Apr-26"/"April 2026" as two months (dupes inflate retrain `n`); every `month_label` join
misses; `computeForecastMonths`' regex fails → `forecastMonths = []` → **Forecast tab silently
blank under a healthy banner**. **Fix:** store `meta.canonicalLabel` in all parsers (one line each).

### A7 · 🟠 Zero-vs-missing conflation cluster
- `SegmentAnalysisTab.jsx:16`: PTB `|| null` erases a real 0; `connectNulls` then draws a
  fabricated interpolated line across it. The TIV series uses `|| 0` — fabricating a **zero** for a
  *missing* month. The two series lie in opposite directions.
- `ForecastTable.jsx:121-126`: `total || '—'` / `jTotal || '—'` render a real 0 as "no data";
  `jTotal` sums partial judgment rows as if complete.
**Fix:** `?? null` + `Number.isFinite`; `connectNulls={false}` for actual series; `?? '—'`.

### A8 · 🟡 Loaded guns (latent, cheap to defuse)
- `dataQueries.js:41,50` order judgment fetches by **text** `month_label` — currently harmless
  (all consumers key-lookup) but this exact class already shipped one bug here.
- `forecastEngine.js:90-93`: "current month" from the browser's local clock — wrong-clock client
  silently shifts the whole grid; derive in IST.
- Parser validates nothing structural: sheets by position (`sheetNames[1..5]`), header row by
  "month" in col 0, **column labels never checked** — an inserted Excel column silently
  mis-buckets every segment and retrains the model on it; "Expected 6 sheets, found N" is the only
  gate. **Fix:** assert header labels (case/space-insensitive), match sheets by normalized name
  with positional fallback, reconcile `tiv_total ≈ Σ segments` per row.

---

## B. Glaring gaps — the "viewing section" class

### B1 · 🔴 The section is a one-way valve: no export, no copy, no print
Zero occurrences of clipboard/export/`@media print` code anywhere under `src/tiv-forecast/` —
while `parseExcel.js:291` proves `XLSX.writeFile` **already ships in the bundle** (template
download). The page's own subtitle says "AL submission preparation", yet every number leaves the
screen by retyping or screenshot — the highest-stakes transcription step is the one the tool
doesn't touch. Print amputates the accuracy grid inside `.tiv-scroll`. **Fix:** per-table copy
(dual-flavor: `text/html` + TSV), "Download forecast (.xlsx)" (~30 lines, zero new deps), cheap
`@media print` block.

### B2 · 🔴 The most consequential click in the portal is blind
Upload preview = two integers ("N months found · Last data: M"). No per-table counts, no diff vs
prod, no new-forecast preview, no confirm dialog, no entity/brand restated — then 7 prod writes.
And the **success message never paints**: `setSuccessMsg` + `setCollapsed(true)` land in one React
commit while the alert renders inside `{!collapsed && …}` (`UploadPanel.jsx:165-168` vs `212-219`)
— a monthly ritual that ends in silence. A Raw-sheet parse failure returns empty arrays with **no
error** while the preview (TIV-derived) still says "51 months found" → AL layer freezes on a
"successful" upload. **Fix:** the dry-run diff modal (C1), per-sheet counts in the preview, toast
the success / keep the panel open.

### B3 · 🔴 Server gate wider than the UI gate: any back-office user can rewrite the forecast
`admin-tiv` verifies `["admin", "back_office"]` (`index.ts:118`) with **no per-action gate**, and
writes via the service-role client (bypasses RLS). The UI hides the panel at
`permission_level === 'admin'` — so "only the admin uploads" is client-side fiction; any
back-office JWT can upsert all six tables + model_params from a console. **Fix:** tighten the EF
to `["admin"]` (or deliberately widen the UI); one-line change, decide the contract.

### B4 · 🔴 Every failure mode collapses into "no data" — with the wrong call to action
- All seven fetches in one `Promise.all`; any rejection → a 6-second toast, then the page renders
  **exactly like an empty database**. No error state, no retry (`TivForecastPage.jsx:68-72`).
- `runForecast` crash → `catch { return null }` (no `console.error`) → "No forecast data / Upload
  a Market Data file" — inviting a **destructive re-upload** to fix a code bug.
- A non-admin whose RLS returns zero rows sees empty states instructing them to **upload a file**
  — while `UploadPanel` is `if (!isAdmin) return null`. The distress call is addressed to someone
  who cannot act on it and reads as "the tool is broken".
**Fix:** persistent inline error card + Retry; distinct engine-fault state; branch empty-state copy
on `isAdmin`.

### B5 · 🟠 No hierarchy: the number the page exists for is the hardest to find
Next-month total TIV renders as the bottom-left cell of the Total row — under the admin upload
card, meta strip, tab bar, sub-tab bar, and six segment rows, at the same 13px as everything else.
**Fix:** a KPI header row (next-month TIV / AL / PTB stat tiles, judgment small underneath) always
visible above the tabs.

### B6 · 🟠 The phone shell was never audited (desktop tables got the 08-24 pass; the chrome didn't)
- `.tiv-tabs`: no wrap, no overflow-x, nowrap tabs ≈388px wide vs 347px available at 375px, under
  `body { overflow-x: hidden }` → the Accuracy tab is **clipped and unreachable** on phones.
  Zero media queries touch any `.tiv-*` rule.
- Admin upload flow is **keyboard-dead**: collapse header is a bare `div onClick` (no tabIndex/
  role/keydown/aria-expanded); file input is `display:none` (removed from tab order and the
  accessibility tree) — no keyboard or SR path to choosing a file.
- Trigger controls are nameless: textless `<label>` around the checkbox, no aria-label on the
  range → TalkBack says "checkbox, not checked" with no clue which trigger. `.tiv-slider` has
  unconditional `outline: none` → no focus indicator at all.
- Charts: raw SVG, no role/label/table-equivalent — historical TIV/PTB data has **no accessible
  representation anywhere**.
- The peer-comparison `title` tooltip **never fires on touch**; the toggle shows values but not
  the judgment peer; the toggle itself is `btn-ghost` without `btn` + `padding: 0` → ~14px target,
  missing the mobile 44px floor. 168 forced tab stops in the accuracy grid.
- Contrast: gray-500 `#767676` on the gray-50 `#F4F4F4` page ground = **4.13:1** (fails AA) —
  meta strip, resting tabs, captions/notes, revealed sub-values. Recharts legend inherits series
  colors: "PTB (forecast)" legend text at gray-300 = **1.84:1**, effectively invisible.
- `title`-only disclosures ("Judgment-free forecast" explainer, disabled-Upload reason) invisible
  on touch — the disabled Upload button just looks broken on a phone.
**Fix bundle:** overflow-x on tab bars; real `<button>` header + visually-hidden-clip file input;
aria-labels on trigger controls; delete `outline:none` + thumb focus ring; `role="img"` + hidden
table for charts; `btn btn-ghost btn-sm` on the toggle; `--text-secondary-on-paper: --gray-600`;
legend formatter + darker PTB series; move title= content into visible notes.

### B7 · 🟠 Structural friction
- Tab/layer/segment state is all `useState` — nothing deep-linkable, F5 loses your place; mirror
  `?tab=&layer=&seg=` into search params.
- No sticky first column on the ~1000px accuracy grid — month identity lost on horizontal scroll
  (the one thing Excel's Freeze Panes never allows). ~4 CSS lines.
- Entity/brand dropdowns reset every visit — prefill from the latest `upload_history` row (and a
  mis-pick currently feeds the documented overwrite defect).
- UploadPanel lookups: entities error → console only; `outlet_brands` never destructures `error`
  → admin faces empty dropdowns + disabled Upload with no visible reason.
- No `beforeunload` during upload; a tab close mid-chain orphans a half-write with zero trace.
- MAPE framing: caption juxtaposes 26.4% with "≤15% AL tolerance" without saying the tolerance
  applies to the **Total-TIV** column (segment errors partially cancel) — a reader concludes the
  model fails ~2× over. Hardcoded window "(Aug-25 to Jul-26)" will silently drift from the live
  table (the 26.4/28.6 figures are correctly labeled "reference result").
- Spec vocabulary in GM-facing chrome: "Layer 1/2/3", "Triggers" → lead with Industry / Ashok
  Leyland / Our sales; "Scenario adjustments".

---

## C. Novel ideas — ranked by value-per-line

1. **Upload dry-run diff modal** ⭐ — parse + retrain are pure client functions and current data is
   already fetched: on file-select show "3 new months (May/Jun/Jul-26) · 2 changed cells (Apr-26
   Haulage 118→121) · 588 unchanged · new forecast 736→741", confirm worded as "Overwrite N months
   for {Entity}/{Brand}". Zero backend change. Catches wrong-file picks, makes same-file re-upload
   self-explaining ("0 changes"), and — until the constraint fix lands — is the **only thing that
   would scream before the multi-brand silent overwrite** ("51 of 51 cells changed").
2. **"Why this number" receipt** — every input is already in `model_params`; click "736" →
   "ROB: median(Jul/Aug/Sep-25) = 640 anchor × (1 + 15.0% trailing-12M, capped) = 736 · no
   triggers". A formatter over fetched data; converts the method-map footnote into trust.
3. **Honest uncertainty** — per-segment empirical range from the `model_backtest` already shipped
   to the client: `736 ⟨646–826⟩` sub-line + shaded band on charts. Companion framing:
   **tolerance odds** — "within AL's 15% in 9 of the last 12 months" (frequencies beat MAPE for
   this audience, reusing the ●▲■ vocabulary).
4. **Model-vs-judgment scoreboard** — from existing lookups: "model closer in 8/12 months ·
   214 units less error over the year", per segment. The sentence the CEO repeats to AL; also the
   direct answer to "is 26.4% garbage?"
5. **Trigger delta preview** — `runForecast` is pure: run base + adjusted, show
   `~~761~~ → 736 (−25)` in tables and a live per-trigger impact readout while the slider drags.
   Today the feedback loop that would make triggers trustworthy doesn't exist.
6. **Staleness sentinel** — `forecastMonths[0].horizon > 1` is already computed in the engine's
   skip-ahead loop; surface it as an amber banner for all users ("Data ends Jul-26; forecast
   reaches N months beyond its data. Last upload 24 Aug by Dhruv.").
7. **Snapshot-before-overwrite + "Download current data as Excel"** — no undo exists and the UI
   never says so; the XLSX writer is already in the bundle. A JSONB snapshot row before the first
   upsert makes any upload one-click revertible (~50 months × 8 cols — trivial).
8. **Round-trip export in the workbook's own sheet shape** — write the 3-month forecast into
   sheets shaped exactly like `Segment wise prediction - TIV/PTB` so the owner pastes model
   numbers back into his living workbook. Feeds the Excel process instead of competing with it.
9. **Tap-for-detail bottom sheet** — `ErrCell onClick` → fixed bottom card "Jul-26 · Haulage —
   Actual 118 · Model 97 (17.8%) · Judgment 104 (11.9%)". Delivers the mouse-only tooltip payload
   to the field-Android audience in ~20 lines.
10. **Forecast-vintage ghost line** — params history is already in the DB (every retrain inserts);
    plot last vintage's forecast faintly behind the current one: "we said 700, now we say 736" —
    the actual review-meeting question, unanswered today.
11. **Upload history → audit trail** — history renders but records no entity/brand, no outcome
    (failed uploads leave no row), no per-table counts, no engine version/MAPE. Write a
    `status='started'` row first and patch it — audit trail + crash trace + `beforeunload` story
    in one.
12. **WhatsApp one-liner** — one chip: `TIV forecast Aug/Sep/Oct-26: 736 / 779 / 850 (model v3.0,
    trained 24-Aug)` to the clipboard. WhatsApp is already a first-class share target (Phase 9.7).
13. **Last-upload status on the collapsed header** — "Last upload: 24-Aug by Dhruv · data through
    Jul-26" answers "is this current?" without expanding; also absorbs the vanishing-success fix.

## D. Deliberately NOT recommended (judged right as-is)
Sorting/filtering on 7-row forecast tables (fixed layout is correct) · arrow-key grid navigation
(read-only tables; over-engineering) · chronological-only accuracy ordering (time is the only
meaningful order) · dark-mode work (light-locked by owner; verified no half-dark state possible) ·
segment pills are adequate filtering.

## Verification note
Six lanes ran blind to each other; convergent independent hits (export gap ×3 lanes, zero-vs-null
×3, trigger labeling ×3, positional parser ×2, sticky column ×2) are the highest-confidence
findings. Corrections applied during verification: AL-share collapse mechanism (0-share falls to
the `|| 0.5` default = 50%, not the 5% floor); accuracy-caption severity downgraded (26.4/28.6
already labeled "reference result" — only the hardcoded window drifts); back_office EF gate
promoted (service-role writes bypass RLS). Fix ordering interacts with
`tiv-multi-entity-brand.md`: the diff modal (C1) and entity/brand prefill mitigate but do not
replace the constraint fix — constraint → scoped reads → selector still holds.
