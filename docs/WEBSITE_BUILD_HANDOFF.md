# PTB TIV Forecast — Website Build Handoff (v3.0)

**Audience:** the session/developer building the TIV forecast tool into the existing React + Vite + Supabase site (Vercel).
**Status of the model:** DONE and verified. This document tells you how to port it. It does not ask you to redesign anything.

**Companion documents (read in this order):**
1. This file — build order, contracts, gates.
2. `TIV_FORECAST_MIGRATION_SPEC.md` (v3.0) — the authoritative spec: schema, math, triggers, UI, acceptance criteria.
3. `forecast-dashboard.jsx` — the working v3.0 reference implementation. Behaviour parity target.
4. `v3-engine-reference.js` — the engine block in isolation (constants + dispatcher + backtest), easiest thing to port from.

> `V3_EXECUTION_HANDOFF.md` is **superseded** — it described splicing v3.0 into the standalone dashboard, which is complete.

---

## 1. What you are building

A route (`/tiv-forecast`) where Dhruv uploads `Market_Data_22-2X.xlsx` each month and gets a 3-month TIV / AL / PTB forecast, plus trigger controls, segment analysis, and an accuracy tracker. Parameters recompute on every upload. Nothing else changes.

**Two rules that override any design instinct:**
- **The forecast is judgment-free.** No judgment value may enter any forecast computation. Judgment appears only as (a) a comparison row on the forecast tab and (b) a benchmark column in the accuracy tracker.
- **No external or manually maintained data.** No API fetches, no hand-kept columns. Upload → forecast. This is a settled decision; do not propose share-of-national or live-data features.

## 2. Current state

| Layer | State |
|---|---|
| Model math | v3.0, audited, frozen. See spec §5.4a–5.5. |
| TIV data | Current through **Jul-26** (52 months). |
| PTB data | Current through Jul-26. |
| AL (PTB+LM) share layer | **STALE at Mar-26** — the Apr-26+ AL/LM split is not in the upload file. Label it in the UI; see §7. |
| Judgment predictions | Present through **Sep-26** in the prediction sheets. |
| Triggers | All default OFF. `fuelCrisis` deleted. |

## 3. Build order

1. **Supabase schema** — spec §4. Note the v3.0 `tiv_forecast_model_params` columns: `yoy_t12`, `smly_plain`, `smly_robust`, `theta_params`, `adapt_params`, `v3_method`, `model_backtest`. Dropped: `yoy_sum`, `yoy_median`, `cap_scores`, `tipper_norm_*`.
2. **`lib/parseExcel.js`** — read the six sheets, handle Excel date serials, scan all columns (spec §3). Contract in §4 below.
3. **`lib/retrainModel.js`** — the 8-step pipeline in spec §5 ("Retraining pipeline"). Port from `v3-engine-reference.js` computations.
4. **`lib/forecastEngine.js`** — `baseForecast` + `forecastTIV` + trigger application. Copy from `v3-engine-reference.js`; it is already correct.
5. **UI** — four tabs per spec §7, mirroring `forecast-dashboard.jsx`.
6. **Run the parity gates in §5 below before calling it done.**

## 4. Upload file contract

| Sheet | Shape |
|---|---|
| `Segment wise data - TIV` | `Month, Bus PVT, Haulage, MAV, Tractor, Tipper, ICV Trucks, TIV` — one row per month, `Apr-22` onward |
| `Segment wise data - PTB` | same columns (no TIV total column guaranteed — sum the segments) |
| `Segment wise prediction - TIV` | judgment forecasts, `Month` + 6 segments + `TIV` |
| `Segment wise prediction - PTB` | judgment forecasts, 6 segments + `Estimated Sale` |
| `Metadata`, `Raw Data` | not used by the engine |

Month labels are `MMM-YY`. Validate on ingest: segment sum vs the `TIV` column, PTB ≤ TIV per segment, no nulls. The current file passes all three.

## 5. Parity gates — must pass before shipping

With **all triggers OFF**, trained through Jul-26, the engine must return exactly (order: Bus PVT, Haulage, MAV, Tractor, Tipper, ICV Trucks):

| Month | Segments | Total |
|---|---|---|
| Aug-26 | 64 / 109 / 125 / 88 / 147 / 203 | **736** |
| Sep-26 | 89 / 184 / 102 / 92 / 147 / 165 | **779** |
| Oct-26 | 94 / 159 / 157 / 92 / 170 / 178 | **850** |

Also: `model_backtest` has **12 rows** (Aug-25..Jul-26) with mean model error **26.4%** (judgment benchmark 28.6%); `fuelCrisis` absent from the trigger list; every trigger initialises `on:false`.

**A deviation means your port is wrong, not the expected values.** These were verified twice against an independent Python implementation.

## 6. The one defect you must not reintroduce

v2.x computed YoY as *FY-to-date ÷ full prior FY*. Early in a fiscal year that ratio is structurally ≪1, so growth pinned at −15% in 56 of 72 backtest months when the true value was +15%. It invalidated every v2.x model selection and meant the deployed model was never actually validated.

**Rule: every YoY comparison must be period-matched** — N months against the same N calendar months of the prior year, or trailing-12M vs prior-12M. v3.0 uses trailing-12M throughout. Spec §5.4a has the full record.

## 7. Known open items

1. **AL/LM split missing for Apr-26 onward.** `al_share_recent` and the AL share chart are frozen at Mar-26. Display "AL/PTB share layer as of Mar-26" wherever the cascade appears. Resolves itself when Dhruv adds AL data to the upload.
2. **Oct-26 judgment row absent** from the prediction sheet (Aug-26 and Sep-26 are present and already wired in). The comparison row must render only when a judgment row exists — guard for `undefined`.
3. **Next model re-trial: after Oct-26 actuals** (15-month window). Re-check ADAPT stability on ICV Trucks, and whether Haulage should move to ADAPT — it was second-best there and carries a persistent −19% to −37% bias under capped methods. Do not change methods before then.

## 8. Do-nots

- No judgment in forecast math, ever.
- No FY-to-date-vs-full-FY YoY, ever.
- No externally fetched or manually maintained data.
- Do not recompute `v3_method` on routine retrains — it is a code constant. Changing it requires a deliberate re-trial.
- Do not re-add `fuelCrisis`, do not enable the monsoon trigger by default in 2026, do not reintroduce calendar-capacity normalisation.
- No ML methods — N ≈ 52 months per segment.
- No manual outlier lists; the robust anchor neutralises spikes arithmetically.

## 9. Expected behaviour worth understanding before you "fix" it

The model under-forecasts during the current boom **by design**. GST 2.0 (CV rate 28%→18%, Sep-25) produced a level shift no SMLY-anchored model can anticipate; territory growth ran +37/+16/+68% YoY in Q1 FY27 against a ±15% cap. ADAPT exists to track that shift for ICV Trucks, where it is largest. Conservative under-forecasting is the organisation's stated preference — it is not a bug to be tuned away.
