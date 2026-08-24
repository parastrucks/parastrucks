# PTB Forecast Engine v3.0 — Execution Handoff (SUPERSEDED)

> **SUPERSEDED — the dashboard splice described here is COMPLETE.** `forecast-dashboard.jsx` is already at v3.0 and passes all gates; `TIV_FORECAST_MIGRATION_SPEC.md` is already at v3.0.
> For the website build, use **`WEBSITE_BUILD_HANDOFF.md`**.
> This file is retained only as the record of the frozen decisions (§1) and the audit defect (§2).

**Purpose:** A fresh session (any model) executes the v3.0 update from this document alone. All decisions are already made and frozen by Dhruv; do not relitigate them. All constants are pre-computed and verified. Your job is mechanical: splice, edit labels, sanity-check, update the migration spec.

**Files involved (all in `/mnt/user-data/outputs/` or supplied by user):**
- `v3-engine-reference.js` — complete, verified v3 constants + engine block (the framework)
- `forecast-dashboard.jsx` — currently v2.1; target of the splice
- `TIV_FORECAST_MIGRATION_SPEC.md` — currently v2.1; needs section updates
- Source data: `Market_Data_22-27.xlsx` (52 months, Apr-22..Jul-26) — already baked into the reference constants; only needed if re-verifying

---

## 1. Frozen decisions (dated, with reasoning — do NOT reopen)

| Date | Decision | Basis |
|---|---|---|
| Aug-26 | Forecast is **judgment-free**: purely historical data. No blend layer, no judgment in any math. Judgment appears ONLY as a benchmark column in the accuracy tab (user: "It is there by design"). | User ruling |
| Aug-26 | **No manual/external data features.** No share-of-national column, no real-time fetching. Website = upload Excel → forecast. | User ruling |
| Aug-26 | Jul-26 Haulage PTB = 2 units is **genuine**, stays in share calculations. | User confirmed |
| Aug-26 | All triggers default **OFF** (manual scenario knobs). `fuelCrisis` **deleted** — war ended Jun-26; backtest + research showed its dampening thesis was inverted (demand rose through the war). | Audit + research |
| Aug-26 | **Trailing-12M YoY** replaces FY-to-date YoY everywhere. Reason: the FY-to-date estimator, if computed against the full prior FY, pins at −15% early in a fiscal year (audit defect, see §2). | Audit |
| Aug-26 | Calendar-capacity normalization (Tipper) **retired** — its advantage disappeared under corrected estimators (23.1% plain-robust vs 24.6% cal-norm). | Audit |
| Aug-26 | v3 method map (see §3) adopted from corrected 12-month backtest. Do not recompute the map on retrain; changing it requires a deliberate re-trial. | Audit |

## 2. The audit defect (must be documented in the spec, §7 below)

The v2.x walk-forward harness computed YoY as `FY-to-date sum ÷ FULL prior-FY sum`. Early/mid fiscal year the ratio is structurally ≪1, so the capped growth pinned at **−15% in 56 of 72 backtest segment-months** while the true capped value was +15%. Consequences: (a) all v2.x champion selections were made on corrupted evaluations; (b) the backtested model ≠ deployed model (production constants were computed correctly at train time on full years). Rule going forward, verbatim into the spec: **any YoY comparison must be period-matched — compare N months against the same N calendar months of the prior year, or use trailing-12M vs prior-12M.**

## 3. v3.0 model (already implemented in `v3-engine-reference.js`)

| Segment | Method | Formula | 12-mo backtest MAPE |
|---|---|---|---|
| Bus PVT | ROB | robust SMLY × (1 + t12 YoY, ±15%) | 28.2% |
| Haulage | THETA | 0.6·plain SMLY·(1+t12) + 0.4·Theta(h)·SI[m] | 29.9% |
| MAV | THETA | same | 30.0% |
| Tractor | ROB | robust SMLY × (1 + t12, ±15%) | 33.5% |
| Tipper | ROB | robust SMLY × (1 + t12, ±15%) | 23.1% |
| ICV Trucks | ADAPT | plain SMLY × (1 + g), g = 0.7·(mean₆ seasonal ratios − 1), ±30% | 13.8% |

Overall: **model 26.4% vs judgment benchmark 28.6%** on Aug-25..Jul-26, honest estimators.

Definitions (retrain formulas — must go in the spec):
- **plain SMLY** for target month M-YY = actual of M-(YY−1).
- **robust SMLY** = median of months (M−1, M, M+1) of the prior year. Side effect: automatically neutralizes single-month spikes (e.g., Jun-26 Bus PVT 239 STU tender — a confirmed outlier; national AL bus sales fell 20-28% that month). No manual outlier list needed.
- **t12 YoY** = sum(last 12 months) ÷ sum(prior 12 months) − 1, capped ±15%.
- **ADAPT g** = 0.7 × (mean of TIV[t−k]/TIV[t−12−k] for k=1..6 − 1), capped ±30%. Level-shift adapter; exists because GST 2.0 (Sep-25 CV rate 28%→18%) shifted the demand level beyond what ±15%-capped methods can track.
- **Theta** = linear fit + SES(α=0.5) on deseasonalized series, f(h) = (intercept + slope·(n+h−1) + ses)/2 × SI[m]. Haulage and MAV only.
- **SI** = multiplicative seasonal indices via ±6 centered moving average, normalized to mean 1.0.
- **PPP cleaning** unchanged: Bus PVT idx 20-28 (Dec-23..Aug-24) replaced with same-month averages from non-PPP periods.

## 4. Dashboard execution steps

1. **Splice:** in `forecast-dashboard.jsx`, replace everything from the line starting `const SEGS=` up to (not including) the line `// ═══════════ UI ═══════════` with the full contents of `v3-engine-reference.js` (strip its header comment block if desired). This removes: old TIV/PTB (48-mo), SI/TP/SMLY/YOY blend constants, v2.1 champion constants (CHAMPION, YOY_MEDIAN, YOY_SUM, THETA_PARAMS, CAP_SCORES, TIPPER_NORM_*), JP array, old TRIGGER_DEFS, old engine, old CHAMPION_BACKTEST.
2. **JP removal fallout:** the Mar-26 v1.3 validation box and any UI code may reference `JP`. Repoint judgment errors to `BACKTEST_V3` (its Mar-26 row has `_judgErr` fields), or drop the judgment column from that box. Search for `JP` and `JT[` usages; `JT`/`JP_PTB` are now empty objects — every lookup must guard `undefined`.
3. **JT population (optional):** read sheet `Segment wise prediction - TIV` for an Aug-26 row; if present, fill `JT={"Aug-26":{...,"total":...}}` for the forecast-tab comparison. If absent, leave empty.
4. **Trigger state init:** set the `useState` triggers line so ALL are off: `on:false` for every def (previously `["fuelCrisis","fyPush"].includes(d.id)`).
5. **Labels:**
   - Header: `v3.0 · Judgment-free engine · Robust-anchor SMLY + Theta + ADAPT · Trained through Jul-26 · Aug–Oct 2026`
   - Footer: `PTB Forecast Engine v3.0 · Bus/Tractor/Tipper: robust-SMLY×t12 · Haulage/MAV: SMLY+Theta · ICV: ADAPT · 12-mo backtest: model 26.4% vs judgment 28.6% · All triggers manual, default OFF`
   - Forecast-tab footnote: replace v2.1 champion text with the v3 method map and "All triggers OFF by default; base forecast is untouched historical data."
   - Accuracy-tab caption: replace the 28.8% in-sample warning block with: corrected 12-month backtest (Aug-25..Jul-26), honest estimators; model 26.4% vs judgment 28.6%; judgment shown as benchmark only; note the v2.x backtest was invalidated by the period-matching defect.
   - Remove any remaining "champion 28.8%" / calendar-normalization / AIS-153-default-OFF-pending text that conflicts.
6. **Shares:** ALS/PTS constants and the ASH array are stale (through Mar-26) — AL/LM split for Apr-Jul 26 is not in the upload file. Add a small UI note "AL/PTB share layer as of Mar-26" wherever the cascade is displayed. **Open item for Dhruv:** supply AL data for Apr-26 onward to refresh.

## 5. Sanity gates (must pass before presenting; expected values verified against Python)

- Forward forecast, all triggers OFF: **Aug-26 = 64/109/125/88/147/203, TOTAL 736 · Sep-26 = 89/184/102/92/147/165, TOTAL 779 · Oct-26 = 94/159/157/92/170/178, TOTAL 850** (order: Bus PVT, Haulage, MAV, Tractor, Tipper, ICV).
- `backtestModel()` returns 12 rows; mean `avgModelErr` = **26.4%**.
- `fuelCrisis` absent from TRIGGER_DEFS.
- JSX parses (esbuild or equivalent).
- Open the file after writing to confirm it is valid and non-empty.

## 6. Context for the numbers (so the next session doesn't "correct" them)

- Aug-26 ICV = 203 is intentional: ADAPT g = +29.1% on anchor 157. ICV's raw t12 growth is +43.6%; ADAPT is the only method allowed to track it.
- Tipper t12 is only +6.1% (Jul-26 crash to 77 — monsoon hit construction) and Tractor +9.5%; their caps don't bind.
- Raw t12 for Bus PVT/Haulage/MAV/ICV is +36% to +73% — all cap at +15% except ICV via ADAPT. The model will under-forecast if the GST-2.0 boom persists; that is accepted, conservative-by-design behavior (organizational preference), not a bug.
- Jun-26 Bus PVT actual 239 stays in the data (it happened) but robust anchors will neutralize it at the Jun-27 retrain.

## 7. Migration spec updates (`TIV_FORECAST_MIGRATION_SPEC.md`)

- Header → **Spec v3.0 (judgment-free, audited estimators)**.
- §5.4 (YoY): replace FY-to-date with trailing-12M; include the §2 period-matching rule and defect history verbatim.
- §5.5: replace champion dispatcher with the §3 method table + formulas + the `baseForecast` code from the reference file.
- §5.7 (calendar normalization): replace body with a short "RETIRED in v3.0" note + reason; delete the code.
- §6 triggers: all default OFF; delete fuelCrisis def; update descriptions per reference file.
- Schema `tiv_forecast_model_params`: drop `tipper_norm_hw/si/smly`, `cap_scores`, `yoy_median`, `yoy_sum`; add `yoy_t12 JSONB`, `smly_plain JSONB`, `smly_robust JSONB`, `adapt_params JSONB` ({seg:{g, window:6, shrink:0.7, cap:0.30}}), `theta_params` scoped to Haulage/MAV; keep `champion` renamed `v3_method`; `model_backtest` = the corrected walk-forward (regenerate on retrain **with period-matched estimators only**).
- `retrainModel.js` steps: PPP clean → SI (all segs) → Theta (Haulage, MAV) → t12 per seg → ADAPT g (ICV) → plain+robust SMLY anchors for the new 3-month horizon → PTB shares (6-mo) → regenerate model_backtest.
- §13 constants: `YOY_T12` note ("never FY-to-date"), `ADAPT` params, `V3_METHOD` map with "do not recompute on retrain".
- §15 one-pager: rewrite per §3 formulas.
- §18: append the audit history — harness defect, invalidation of v2.x selections, corrected results, the deployed-vs-validated mismatch lesson, and the do-nots below.

## 8. Do-nots (carry into spec §18)

- No judgment anywhere in forecast math. No blend layer in the tool (Dhruv may blend by hand when writing the AL submission; that is outside the tool).
- No FY-to-date-vs-full-FY YoY, ever.
- No features requiring manually maintained or externally fetched data.
- No recomputing the V3_METHOD map on routine retrains.
- No ML methods (N=52/segment), no re-adding fuelCrisis, no monsoon trigger by default in 2026 (below-normal monsoon year; base seasonality already carries the dip).

## 9. Known open items (for Dhruv, not blocking)

1. AL/LM data Apr-26 onward → refresh ALS/PTS/ASH (share layer stale at Mar-26).
2. Aug-26 judgment row in prediction sheet → populate JT for display comparison.
3. Next re-trial checkpoint: after Oct-26 actuals (15-month window) — re-examine ADAPT stability for ICV and whether Haulage warrants ADAPT too (it was 2nd-best there and Haulage bias remains −19% to −37% under capped methods).
