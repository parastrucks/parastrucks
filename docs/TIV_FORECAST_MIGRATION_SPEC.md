# TIV Forecast Tool — Migration Specification

**Spec version:** v3.0 (Judgment-free engine — audited estimators, robust anchors, level-shift adapter)

> **v3.0 supersedes v2.x entirely.** The v2.x champion selections were produced by a defective backtest harness (see §5.4a) and are withdrawn. Trained through Jul-26 (52 months).

This document describes how to migrate a standalone React forecasting dashboard into an existing React + Vite + Supabase website deployed on Vercel. It is written to be self-contained so another Claude chat (managing the website codebase) can build this without needing conversation history from the tool's development.

---

## 1. Context — What This Tool Does

**Paras Trucks and Buses (PTB)** is an authorized Ashok Leyland dealership in Ahmedabad, Gujarat, dealing in Medium and Heavy Commercial Vehicles (M&HCV) across four districts: Ahmedabad, Gandhinagar, Kheda, and Anand.

Each month on the 19th, PTB must submit a 3-month forecast to Ashok Leyland containing:
- **Total Industry Volume (TIV)** — vehicle sales of all brands combined in PTB's territory
- **PTB's own retail sales** forecast

Both must be broken down across six M&HCV segments: **Bus PVT, Haulage, MAV, Tractor, Tipper, ICV Trucks**.

The Ashok Leyland tolerance is 15% absolute percentage error per segment per month. Forecasts feed AL's retail target-setting methodology.

**Key business constraint:** In PTB's territory, `AL = PTB + LM` where LM (Landmark Motors) is a legacy low-volume dealer that will never exit but will never grow. PTB's share of AL has a practical ceiling of ~75%.

---

## 2. High-Level Architecture

The migrated tool consists of three concerns:

1. **Data ingestion** — An upload page that accepts a specific Excel file, parses it client-side with SheetJS, and upserts the data into Supabase tables.
2. **Model retraining** — After upload, a client-side function recomputes all model parameters (seasonal indices, Holt-Winters level/trend, YoY growth, market shares) and stores them in a parameters table.
3. **Forecast dashboard** — A page that reads data + parameters + trigger state from Supabase, runs the blended forecast math client-side, and displays results across four tabs.

**Routing:** Add a "TIV Forecast" tab/card to the home dashboard that routes to `/tiv-forecast`. This page contains the upload widget at the top and the forecast dashboard below it (or split into two sub-routes — designer's choice).

**All forecast computation runs client-side** on every render. The math is fast (milliseconds for the full three-layer cascade across six segments and three forecast months).

---

## 3. Excel File Format (Input)

The uploaded file is always named similarly to `Market_Data_YY-YY.xlsx` and contains 6 sheets. The format is fixed — the parser can assume exact column positions.

### Sheet 1: `Metadata`
Documentation only. Parser ignores.

### Sheet 2: `Segment wise data - TIV`
Header row at row 1. Columns: `Month | Bus PVT | Haulage | MAV | Tractor | Tipper | ICV Trucks | TIV`. Month format is `MMM-YY` (e.g., `Apr-22`, `Mar-26`). Each row is one month starting from April 2022. The `TIV` column is the sum of the six segment columns.

### Sheet 3: `Segment wise data - PTB`
Same structure. Last column is `Total Sale` instead of `TIV`. PTB started operations November 2022 (one billing happened in September 2022). Zero values in early months are legitimate — PTB wasn't operational yet.

### Sheet 4: `Segment wise prediction - TIV`
Judgment predictions for past and current forecast submissions. Same 6-segment columns. Starts from Aug-25. Column name: `TIV` for total.

### Sheet 5: `Segment wise prediction - PTB`
Same as above but for PTB. Total column name: `Estimated Sale`.

### Sheet 6: `Raw Data`
A wide pivot table. Row 0 contains month headers every 11 columns starting at column 2 (merged cell format — only the first cell of each month block has a value, others are null). Row 1 contains column labels that repeat per month: `AL | PTB | LM | TML | EML | M&M | BB | Others | TIV | MS%`. Rows 2 onwards contain sub-segment rows; the segment total rows are at indices:
- Row 4: `Bus PVT`
- Row 7: `Haulage Total`
- Row 22: `MAV`
- Row 29: `TRACTOR`
- Row 41: `TIPPER`
- Row 48: `ICV Trucks`

The sub-segments between these total rows are detail rows (e.g., `4 X 2 HAULAGE`, `4 X 2 32 FT`, `6 X 2 MAV STD`, etc.) that roll up to the totals.

Brand meanings: TML = Tata Motors, EML = Eicher, M&M = Mahindra, BB = Bharat Benz, Others = any other brand. AL is always PTB + LM. TIV is always AL + TML + EML + M&M + BB + Others.

**Negative values in raw data are company reversals** (OEM buying back vehicles from dealer). They are rare and have already been netted into the segment totals. The parser should preserve them as-is.

### Parser notes

- Use SheetJS (`xlsx` npm package).
- Read with `{ cellDates: false, raw: true }` to keep month strings intact.
- Upload replaces the full file each time — but because the file contains all historical data, the DB operation is an upsert keyed on `month_label`, not a truncate-and-reinsert. This preserves referential integrity if past months get corrected.

---

## 4. Supabase Schema

All tables should use a `tiv_forecast_` prefix to namespace this feature. Apply RLS policies matching the existing patterns in the project (same auth model as the rest of the dashboard).

### Table: `tiv_forecast_tiv_actuals`
```sql
CREATE TABLE tiv_forecast_tiv_actuals (
  id BIGSERIAL PRIMARY KEY,
  month_label TEXT NOT NULL UNIQUE,  -- e.g. "Apr-22"
  year INT NOT NULL,
  month_num INT NOT NULL,            -- 1-12
  month_index INT NOT NULL,          -- 0-based sequence from Apr-22
  bus_pvt NUMERIC NOT NULL DEFAULT 0,
  haulage NUMERIC NOT NULL DEFAULT 0,
  mav NUMERIC NOT NULL DEFAULT 0,
  tractor NUMERIC NOT NULL DEFAULT 0,
  tipper NUMERIC NOT NULL DEFAULT 0,
  icv_trucks NUMERIC NOT NULL DEFAULT 0,
  tiv_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tiv_actuals_month ON tiv_forecast_tiv_actuals(month_index);
```

### Table: `tiv_forecast_ptb_actuals`
Identical structure but `total_sale` instead of `tiv_total`.

### Table: `tiv_forecast_al_actuals`
AL segment-wise data, extracted from the Raw Data sheet at each segment's total row, reading the `AL` column of each month block.
```sql
CREATE TABLE tiv_forecast_al_actuals (
  id BIGSERIAL PRIMARY KEY,
  month_label TEXT NOT NULL UNIQUE,
  month_index INT NOT NULL,
  bus_pvt NUMERIC NOT NULL DEFAULT 0,
  haulage NUMERIC NOT NULL DEFAULT 0,
  mav NUMERIC NOT NULL DEFAULT 0,
  tractor NUMERIC NOT NULL DEFAULT 0,
  tipper NUMERIC NOT NULL DEFAULT 0,
  icv_trucks NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `tiv_forecast_judgment_tiv`
```sql
CREATE TABLE tiv_forecast_judgment_tiv (
  id BIGSERIAL PRIMARY KEY,
  month_label TEXT NOT NULL UNIQUE,
  bus_pvt NUMERIC,
  haulage NUMERIC,
  mav NUMERIC,
  tractor NUMERIC,
  tipper NUMERIC,
  icv_trucks NUMERIC,
  tiv_total NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `tiv_forecast_judgment_ptb`
Same structure, `total_sale` instead of `tiv_total`.

### Table: `tiv_forecast_raw_data`
Flexible JSONB storage for the sub-segment pivot data. One row per month.
```sql
CREATE TABLE tiv_forecast_raw_data (
  id BIGSERIAL PRIMARY KEY,
  month_label TEXT NOT NULL UNIQUE,
  month_index INT NOT NULL,
  -- JSONB structure: { "segment_row_name": { "AL": 0, "PTB": 0, "LM": 0, "TML": 0, "EML": 0, "M&M": 0, "BB": 0, "Others": 0, "TIV": 0, "MS%": 0 }, ... }
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `tiv_forecast_model_params`
Stores the retrained model parameters after each upload. Always one active row. **v2.1 schema includes per-segment champion method config.**
```sql
CREATE TABLE tiv_forecast_model_params (
  id BIGSERIAL PRIMARY KEY,
  trained_at TIMESTAMPTZ DEFAULT NOW(),
  last_data_month TEXT NOT NULL,        -- e.g. "Jul-26"
  total_months INT NOT NULL,            -- e.g. 52
  -- ─── Core ───
  seasonal_indices JSONB NOT NULL,      -- { seg: {1..12} }, mean 1.0
  -- yoy_t12: trailing-12M vs prior-12M, capped ±15%. NEVER FY-to-date vs full FY (§5.4a).
  yoy_t12 JSONB NOT NULL,
  -- smly_plain / smly_robust: anchors for the 3-month horizon, keyed by target label
  smly_plain JSONB NOT NULL,            -- { "Aug-26": { seg: value }, ... }
  smly_robust JSONB NOT NULL,           -- median(m-1, m, m+1) of prior year
  -- ─── Method-specific ───
  theta_params JSONB NOT NULL,          -- { "Haulage": {slope,intercept,ses,n}, "MAV": {...} }
  adapt_params JSONB NOT NULL,          -- { "ICV Trucks": {g, window:6, shrink:0.7, cap:0.30} }
  -- ─── Method map (constant; do NOT recompute on retrain) ───
  v3_method JSONB NOT NULL,             -- { "Bus PVT":"ROB", ..., "ICV Trucks":"ADAPT" }
  -- ─── Cascade shares ───
  al_share_recent JSONB NOT NULL,       -- STALE as of Mar-26 pending AL data (see §9)
  ptb_share_recent JSONB NOT NULL,      -- recent 6-month
  -- ─── Backtest record for AccuracyTrackerTab ───
  -- Regenerate on retrain USING PERIOD-MATCHED ESTIMATORS ONLY.
  model_backtest JSONB,
  notes TEXT
);
-- REMOVED in v3.0: yoy_sum, yoy_median, cap_scores, tipper_norm_hw, tipper_norm_si, tipper_norm_smly
```

Only the latest row is used by the forecast engine. Keep history for audit. Query with `ORDER BY trained_at DESC LIMIT 1`.

**Retraining pipeline (`retrainModel.js`), in order:**
1. PPP-clean Bus PVT (idx 20–28, Dec-23..Aug-24) → same-month averages from non-PPP periods.
2. Seasonal indices for all six segments (±6 centered moving average, normalised to mean 1.0).
3. Theta params for **Haulage and MAV only** (linear fit + SES α=0.5 on the deseasonalised series).
4. `yoy_t12` per segment (trailing 12 vs prior 12, cap ±15%).
5. `adapt_params.g` for **ICV Trucks** (6-month seasonally-matched ratio mean, shrink 0.7, cap ±30%).
6. `smly_plain` and `smly_robust` anchors for the next 3-month horizon.
7. PTB share of TIV, recent 6 months.
8. Regenerate `model_backtest` (walk-forward, period-matched estimators only).

`v3_method` is a code constant, not a retrained field.

---

## 5. Forecasting Math (Client-Side)

All math runs in the browser. Pure JavaScript, no ML libraries.

### 5.1 Data preparation — PPP outlier handling

**Important business rule:** Between December 2023 and August 2024 (9 months), PTB fulfilled a one-time 270-unit PPP bus order. This inflated the Bus PVT TIV and distorted seasonal patterns. Before computing seasonal indices or Holt-Winters parameters for **Bus PVT only**, replace the values in these 9 months with same-month averages from non-PPP periods.

Implementation:
```js
// Bus PVT only. Apr-22 is index 0, so Dec-23 = idx 20, Aug-24 = idx 28.
const PPP_START_IDX = 20;
const PPP_END_IDX = 28;

function cleanBusPVT(busPvtArray, monthsMeta) {
  const cleaned = [...busPvtArray];
  for (let i = PPP_START_IDX; i <= PPP_END_IDX; i++) {
    const targetMonth = monthsMeta[i].month_num;
    // Collect same-calendar-month values from OUTSIDE the PPP window
    const sameMonthValues = [];
    for (let j = 0; j < busPvtArray.length; j++) {
      if (j >= PPP_START_IDX && j <= PPP_END_IDX) continue;
      if (monthsMeta[j].month_num === targetMonth) {
        sameMonthValues.push(busPvtArray[j]);
      }
    }
    if (sameMonthValues.length > 0) {
      cleaned[i] = Math.round(
        sameMonthValues.reduce((a, b) => a + b, 0) / sameMonthValues.length
      );
    }
  }
  return cleaned;
}
```

This cleaned array is used for computing Bus PVT seasonal indices and Holt-Winters parameters. The original raw values stay in the database and are displayed in the historical chart.

### 5.2 Seasonal indices (multiplicative, normalized to avg = 1.0)

For each segment, compute a centered 12-month moving average, take the ratio of each actual value to its MA, then average those ratios by calendar month, then normalize so the 12 indices average to 1.0.

```js
function computeSeasonalIndices(data, monthsMeta) {
  const n = data.length;
  const ma = new Array(n).fill(null);
  for (let i = 6; i < n - 6; i++) {
    const window = data.slice(i - 6, i + 6);
    ma[i] = window.reduce((a, b) => a + b, 0) / 12;
  }
  const ratios = {};
  for (let m = 1; m <= 12; m++) ratios[m] = [];
  for (let i = 0; i < n; i++) {
    if (ma[i] && ma[i] > 0) {
      ratios[monthsMeta[i].month_num].push(data[i] / ma[i]);
    }
  }
  const indices = {};
  for (let m = 1; m <= 12; m++) {
    indices[m] = ratios[m].length > 0
      ? ratios[m].reduce((a, b) => a + b, 0) / ratios[m].length
      : 1.0;
  }
  // Normalize to average 1.0
  const avg = Object.values(indices).reduce((a, b) => a + b, 0) / 12;
  for (let m = 1; m <= 12; m++) indices[m] = +(indices[m] / avg).toFixed(4);
  return indices;
}
```

### 5.3 Holt's linear trend on deseasonalized series

Standard Holt exponential smoothing with alpha=0.3, beta=0.1. First deseasonalize the data by dividing each observation by its seasonal index, then fit Holt on the deseasonalized series. The final level and trend are what's used for forecasting.

```js
function holtLinear(data, alpha = 0.3, beta = 0.1) {
  const n = data.length;
  const level = new Array(n).fill(0);
  const trend = new Array(n).fill(0);
  level[0] = data[0];
  trend[0] = (data[Math.min(11, n - 1)] - data[0]) / Math.min(11, n - 1);
  for (let t = 1; t < n; t++) {
    level[t] = alpha * data[t] + (1 - alpha) * (level[t - 1] + trend[t - 1]);
    trend[t] = beta * (level[t] - level[t - 1]) + (1 - beta) * trend[t - 1];
  }
  return { level: level[n - 1], trend: trend[n - 1] };
}

function trainHoltForSegment(rawData, seasonalIndices, monthsMeta) {
  const deseasonalized = rawData.map((v, i) => {
    const si = seasonalIndices[monthsMeta[i].month_num];
    return si > 0 ? v / si : v;
  });
  return holtLinear(deseasonalized);
}
```

### 5.4a AUDIT DEFECT — mandatory reading before touching any YoY code

The v2.x walk-forward harness computed YoY as `FY-to-date sum ÷ FULL prior-FY sum`. Early and mid fiscal year that ratio is structurally far below 1, so the capped growth term pinned at **−15% in 56 of 72 backtest segment-months** when the correct capped value was **+15%** — a 30-point error in the growth input for every sum-based method.

Consequences: (a) every v2.x champion selection was made on corrupted evaluations and is withdrawn; (b) the backtested model was **not** the deployed model — production constants were computed correctly at train time on full years, so the shipped forecasts were sound but the validation claims about them were not.

**RULE (never violate):** any YoY comparison must be *period-matched* — compare N months against the same N calendar months of the prior year, or use trailing-12M vs prior-12M. Never compare a partial period against a full year.

### 5.4 Same-Month-Last-Year (SMLY) anchors and trailing-12M YoY

For each segment, store the SMLY values for the forecast horizon months (April, May, June, and optionally March for current-month tracking). These are simply the values from 12 months prior.

v3.0 uses **two anchor types** and **one growth estimator**.

```js
// Growth: trailing-12M vs prior-12M, capped ±15%. Fiscal-boundary-safe by construction.
function computeYoYT12(d) {                 // d = cleaned segment series
  const n = d.length; if (n < 24) return 0;
  const cur = d.slice(n - 12).reduce((a, b) => a + b, 0);
  const prv = d.slice(n - 24, n - 12).reduce((a, b) => a + b, 0);
  return prv > 0 ? Math.max(-0.15, Math.min(0.15, cur / prv - 1)) : 0;
}

// Plain anchor: same month, prior year.
function smlyPlain(d, idxSameMonthLastYear) { return d[idxSameMonthLastYear]; }

// Robust anchor: median of (month-1, month, month+1) of the prior year.
function smlyRobust(d, i) { return median([d[i - 1], d[i], d[i + 1]]); }
```

**Why the robust anchor matters:** it halves Tractor's error (single-month anchors there are wild) and it *automatically neutralises one-month spikes* — e.g. Jun-26 Bus PVT 239, a confirmed STU tender (national AL bus sales fell 20–28% that same month). median(87, 239, 85) = 87. **No manual outlier list is needed or permitted.** It is wrong for MAV, whose sharp seasonality is real signal — hence per-segment assignment below.

### 5.5 v3.0 model — per-segment method dispatch

| Segment | Method | Formula | 12-mo MAPE |
|---|---|---|---|
| Bus PVT | ROB | robust SMLY × (1 + t12) | 28.2% |
| Haulage | THETA | 0.6·plain SMLY·(1+t12) + 0.4·Theta(h)·SI[m] | 29.9% |
| MAV | THETA | same | 30.0% |
| Tractor | ROB | robust SMLY × (1 + t12) | 33.5% |
| Tipper | ROB | robust SMLY × (1 + t12) | 23.1% |
| ICV Trucks | ADAPT | plain SMLY × (1 + g) | 13.8% |

Corrected 12-month walk-forward (Aug-25..Jul-26): **model 26.4% vs judgment benchmark 28.6%**.

**ADAPT (level-shift adapter)** is new in v3.0 and exists because GST 2.0 (CV rate 28%→18%, Sep-25) shifted the demand level beyond anything a ±15%-capped estimator can express. ICV raw trailing-12M growth is +43.6%; ADAPT is the only method permitted to track it.

`g = clamp(0.7 × (mean of TIV[t−k]/TIV[t−12−k] for k=1..6) − 0.7, −0.30, +0.30)` — seasonally matched, shrunk 0.7, capped ±30%.

```js
const V3_METHOD = { "Bus PVT":"ROB","Haulage":"THETA","MAV":"THETA",
                    "Tractor":"ROB","Tipper":"ROB","ICV Trucks":"ADAPT" };
const PHI = 0.65;
const dts = h => { let s = 0; for (let i = 1; i <= h; i++) s += Math.pow(PHI, i); return s; };

function baseForecast(seg, m, h, targetLabel, P) {
  const method = V3_METHOD[seg];
  if (method === "ROB")   return P.smly_robust[targetLabel][seg] * (1 + P.yoy_t12[seg]);
  if (method === "ADAPT") return P.smly_plain[targetLabel][seg]  * (1 + P.adapt_params[seg].g);
  if (method === "THETA") {
    const smly = P.smly_plain[targetLabel][seg] * (1 + P.yoy_t12[seg]);
    const tp = P.theta_params[seg];                       // {slope, intercept, ses, n}
    const theta = (tp.intercept + tp.slope * (tp.n + h - 1) + tp.ses) / 2 * P.seasonal_indices[seg][m];
    return 0.6 * smly + 0.4 * theta;
  }
  return P.smly_plain[targetLabel][seg];
}
```

**The forecast is judgment-free.** No judgment value enters any forecast computation. Judgment appears in the UI only as a benchmark column in the Accuracy Tracker.

**Do not recompute `V3_METHOD` on routine retrains.** Changing the map requires a deliberate re-trial with period-matched estimators.

### 5.6 Three-layer cascade (TIV → AL → PTB)

```js
function forecastAllLayers(segment, forecastMonth, horizonStep, triggers, params) {
  const tiv = forecastTIV(segment, forecastMonth, horizonStep, triggers, params);
  const alShare = Math.min(0.85, Math.max(0.05, params.al_share_recent[segment]));
  const al = Math.round(tiv * alShare);
  const ptbShare = Math.min(0.75, params.ptb_share_recent[segment]);  // Hard cap at 75%
  const ptb = Math.round(al * ptbShare);
  return { tiv, al, alShare, ptb, ptbShare };
}
```

**Market share parameters are simply the last 6-month average** of actual AL share and actual PTB share of AL, computed from the raw data on each retrain. No trend extrapolation on shares — shares have been too volatile historically for a trend model to add value.

### 5.7 Calendar capacity normalization — RETIRED in v3.0

Removed. Its apparent 2.8pp advantage for Tipper was an artefact of the defective harness (§5.4a). Under corrected estimators, plain trailing-12M with a robust anchor beats it (23.1% vs 24.6%). Drop `tipper_norm_*` and `cap_scores` from the schema and delete the normalisation code. Do not reintroduce without a fresh trial.

## 6. External Trigger System

Triggers are multiplicative adjustments applied to the TIV forecast after the baseline is computed. Each trigger has an on/off toggle and a severity slider (0 to max%). Trigger state is persisted per user in Supabase.

### Trigger definitions

```js
const TRIGGER_DEFS = [
  {
    id: "fyPush",
    name: "FY End Push / Hangover",
    desc: "March billing push amplification, April hangover, slight May drag",
    affected: ALL_SEGMENTS,
    monthEffect: { 3: 1, 4: -1, 5: -0.4 },  // March +sev%, April -sev%, May -40% of sev
    type: "custom",
    defaultSev: 12,
    max: 30
  },
  {
    id: "ais153",
    name: "AIS 153 Bus Recovery",
    desc: "Body builder license approvals expected to boost MDV/ICV bus through Q1-Q2 FY27. Affects Bus PVT only (ICV buses fall under Bus PVT in AL taxonomy, NOT under ICV Trucks). ⚠ DEFAULT OFF: retroactive backtest (Sep-25 to Mar-26) showed dampening this hurt Bus PVT MAPE — calibration is unverified. Investigate before enabling.",
    affected: ["Bus PVT"],
    months: [4, 5, 6, 7, 8, 9],
    type: "boost",
    defaultSev: 20,
    max: 50
  },
  {
    id: "monsoon",
    name: "Monsoon Dampening",
    desc: "Jul-Sep construction slowdown affecting Tippers",
    affected: ["Tipper"],
    months: [7, 8, 9],
    type: "dampen",
    defaultSev: 5,
    max: 20
  },
  {
    id: "navratri",
    name: "Navratri 2026 (Oct 11-19)",
    desc: "Week 2-3 of October. Tipper gets auspicious boost, other segments see mild disruption",
    affected: ALL_SEGMENTS,
    segEffect: {
      "Bus PVT": -0.5, "Haulage": -0.5, "MAV": -0.5,
      "Tractor": -0.5, "Tipper": 1.0, "ICV Trucks": -0.5
    },
    months: [10],
    type: "segcustom",
    defaultSev: 10,
    max: 25
  },
  {
    id: "diwali",
    name: "Diwali 2026 (Nov 8) + Vacation",
    desc: "Week 2 of November plus 5-day Ahmedabad vacation kills ~35% of November capacity",
    affected: ALL_SEGMENTS,
    months: [11],
    type: "dampen",
    defaultSev: 30,
    max: 50
  },
  {
    id: "credit",
    name: "Credit Environment",
    desc: "Interest rate / bank lending ease affecting all segments",
    affected: ALL_SEGMENTS,
    months: [1,2,3,4,5,6,7,8,9,10,11,12],
    type: "both",  // Can boost or dampen
    defaultSev: 0,
    max: 15
  },
  {
    id: "fuelCrisis",
    name: "Iran War + Input Cost",
    desc: "Strait of Hormuz disruption. Fuel-cost-sensitive segments defer purchases. 2% OEM cost pass-through expected.",
    affected: ["Haulage", "MAV", "Tractor"],
    months: [1,2,3,4,5,6,7,8,9,10,11,12],
    type: "dampen",
    defaultSev: 12,
    max: 30
  }
];
```

### Trigger application logic

```js
function applyTriggers(baseForecast, segment, monthNum, triggers) {
  let f = baseForecast;
  for (const t of triggers) {
    if (!t.on) continue;
    const def = TRIGGER_DEFS.find(d => d.id === t.id);
    if (!def) continue;

    // Type 1: Custom monthEffect (e.g., FY Push affects March+Apr+May differently)
    if (def.type === "custom" && def.monthEffect) {
      const effect = def.monthEffect[monthNum];
      if (effect !== undefined && def.affected.includes(segment)) {
        f *= (1 + effect * t.severity / 100);
      }
      continue;
    }

    // Type 2: Segment-specific custom effect (e.g., Navratri boosts Tipper, dampens others)
    if (def.type === "segcustom" && def.segEffect) {
      if (def.months?.includes(monthNum) && def.segEffect[segment] !== undefined) {
        f *= (1 + def.segEffect[segment] * t.severity / 100);
      }
      continue;
    }

    // Type 3: Standard dampen/boost/both
    if (!def.affected.includes(segment)) continue;
    if (def.months && !def.months.includes(monthNum)) continue;

    const fac = t.severity / 100;
    if (def.type === "dampen") f *= (1 - fac);
    else if (def.type === "boost") f *= (1 + fac);
    else if (def.type === "both") f *= (1 + (t.direction === "boost" ? fac : -fac));
  }
  return f;
}
```

### Domain knowledge behind triggers

**Weekly booking pattern:** PTB's sales follow a consistent 10/20/30/40 pattern across weeks of the month — Week 1 is 10% (deliveries + lost-order analysis), Week 2 is 20% (lead gathering), Week 3 is 30% (prospect filtering), Week 4 is 40% (order closure). This pattern is used to calibrate festival impact: Diwali in Week 2 with a 5-day vacation wipes Week 2 entirely and halves Week 3, which equals roughly 35% of the month's bookings. Navratri in Weeks 2-3 of October hits 50% of the month's booking capacity but only mildly disrupts non-Tipper segments because the Week 4 closure surge remains intact.

**ALL triggers default OFF in v3.0.** They are manual scenario knobs; the base forecast is untouched historical data.

`fuelCrisis` (Iran War + Input Cost) is **deleted**, not disabled. The war ended Jun-26, and both backtest and market research showed its premise was inverted: CV demand rose *through* the war (GST 2.0 dominated, and buyers treated vehicles as an inflation hedge, pulling purchases forward). It dampened exactly the segments that were booming. Do not reintroduce.

`fyPush` premise also failed forward testing — Apr-26 came in above forecast (683) despite a record Mar-26. Retained as a manual knob only.

`monsoon`: leave OFF for 2026. IMD forecasts a below-normal monsoon (~90% LPA, El Niño developing); less rain means less construction disruption, and the base seasonal indices already carry the normal Jul–Sep dip.

---

## 7. UI Structure

The dashboard has **four tabs**:

1. **Forecast Output** — Shows three tables (TIV Layer 1, AL Volume Layer 2, PTB Sales Layer 3) for the forecast horizon (3 months ahead). When judgment predictions exist for a forecast month, display them on a second row per month labeled "Judg" for comparison. Include a prominent context card showing any active market event warnings (e.g., the current Iran war context).
2. **Trigger Controls** — List of all triggers with toggles, severity sliders, and (for dual-type triggers) Boost/Dampen direction buttons. Include an info box explaining the weekly booking pattern.
3. **Segment Analysis** — Segment selector pills at top. For the selected segment, show: (a) historical TIV line chart with PTB overlay and forecast extension as dashed lines, (b) AL market share trend line chart, (c) stacked bar chart of all segments across forecast months.
4. **Accuracy Tracker** — Backtest table comparing model errors vs judgment errors for the past 7-8 months (Aug 2025 onwards is when judgment recording began). Green for ≤15% error, amber for ≤25%, red for >25%. Include two side-by-side bar charts showing average MAPE per segment for model vs judgment, with a reference line at 15% (the AL tolerance threshold).

The current standalone version uses inline styles with a dark theme (background `#0B0F1A`, card `#111827`, blue accent `#0080C9`). **Feel free to re-style to match the existing website's design system.** The structure and behavior matter more than the specific colors.

---

## 8. File Structure (Suggested)

```
src/
  tiv-forecast/
    pages/
      TivForecastPage.jsx         # Main page, mounted at /tiv-forecast
    components/
      UploadPanel.jsx              # Excel upload + parse + retrain trigger
      ForecastOutputTab.jsx
      TriggerControlsTab.jsx
      SegmentAnalysisTab.jsx
      AccuracyTrackerTab.jsx
      ForecastTable.jsx            # Reusable 3-layer table
      SegmentChart.jsx             # Historical + forecast line chart
    lib/
      parseExcel.js                # SheetJS parsing → structured data
      retrainModel.js              # Computes seasonal_indices, hw, smly, yoy, shares
      forecastEngine.js            # Core math: blended SMLY + dampened HW + triggers
      triggerDefs.js               # TRIGGER_DEFS constant
      supabaseClient.js            # Re-export or wrap existing client
      dataQueries.js               # Supabase read/write helpers
    constants.js                   # SEGS, SEG_COLORS, PPP constants, etc.
```

---

## 9. Data Flow

### On file upload:
1. User selects file in `UploadPanel`
2. SheetJS reads workbook → extract 5 relevant sheets (metadata ignored)
3. Parse each sheet into typed row arrays
4. Extract AL segment totals from Raw Data by reading the `AL` column at each segment total row for each month block
5. **Upsert** into `tiv_forecast_tiv_actuals`, `tiv_forecast_ptb_actuals`, `tiv_forecast_al_actuals`, `tiv_forecast_judgment_tiv`, `tiv_forecast_judgment_ptb`, `tiv_forecast_raw_data` (keyed on `month_label`)
6. Call `retrainModel(supabase)`:
   - Fetch all actuals ordered by month_index
   - Apply PPP outlier cleaning to Bus PVT
   - Compute seasonal indices per segment
   - Train Holt-Winters per segment
   - Compute SMLY map for forecast horizon months
   - Compute YoY capped per segment
   - Compute recent 6-month AL share per segment
   - Compute recent 6-month PTB share of AL per segment
   - `INSERT` new row into `tiv_forecast_model_params`
7. Show success toast with "Last data month: X, Total months: Y"
8. Forecast dashboard auto-refreshes reading the latest params

### On dashboard load:
1. Fetch latest row from `tiv_forecast_model_params`
2. Fetch all TIV actuals, PTB actuals, AL actuals (for charts)
3. Fetch judgment predictions (for comparison display)
4. Fetch user's trigger state from `tiv_forecast_trigger_state`, merge with defaults for any missing triggers
5. Compute forecasts client-side using `forecastEngine.js`
6. Render

### On trigger change:
1. Update local React state (immediate UI response)
2. Debounced upsert to `tiv_forecast_trigger_state` (200-500ms)

---

## 10. Navigation Integration

Add a tab/card/link titled **"TIV Forecast"** to the home dashboard that navigates to `/tiv-forecast`. The icon could be a chart or a truck — the other Claude chat can match the existing home dashboard's tab styling. If the home dashboard uses a grid of cards, add a new card. If it uses a tab bar, add a new tab.

The route should be protected by the same auth middleware as the rest of the dashboard.

---

## 11. Environment Variables

Use the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — no new env vars needed. These are already configured on Vercel.

Install one new dependency:
```bash
npm install xlsx
```
(SheetJS — MIT licensed community edition is sufficient for this use case.)

---

## 12. Migration Steps (In Order)

1. **Create Supabase tables** — Run the SQL from Section 4 via Supabase SQL editor
2. **Apply RLS policies** — Match existing project patterns (authenticated read/write, per-user trigger state)
3. **Install xlsx** — `npm install xlsx`
4. **Build `lib/parseExcel.js`** — Parse the 6-sheet workbook into typed arrays
5. **Build `lib/retrainModel.js`** — Port the Python retraining logic to JS. **v2.1 must produce all fields**: PPP cleaning, seasonal indices, Holt-Winters params, sum-based YoY, **median-based YoY**, **Theta params (slope/intercept/ses/n) per segment**, **capacity scores for forecast horizon and prior-year SMLY months**, **Tipper capacity-normalized HW level/trend, SI, and SMLY**, AL/PTB shares, and a **`model_backtest` JSONB** containing the 8-month walk-forward champion forecasts (re-run on each upload to refresh the AccuracyTrackerTab)
6. **Build `lib/forecastEngine.js`** — Champion dispatcher (Section 5.5) + trigger application logic (Section 6). The CHAMPION mapping is a constant — do not recompute it on each retrain
7. **Build `components/UploadPanel.jsx`** — File input, parse, upsert, retrain, toast
8. **Build the four tab components** — Match existing website styling
9. **Build `TivForecastPage.jsx`** — Container with upload panel + tabbed dashboard
10. **Add `/tiv-forecast` route** — Register in React Router config
11. **Add navigation entry** — Tab/card on home dashboard
12. **Test with a real Excel file upload** — Verify data lands correctly, params retrain, dashboard shows sensible forecasts
13. **Deploy to Vercel**

---

## 13. Key Constants and Parameters

These should be defined as constants in `src/tiv-forecast/constants.js`:

```js
export const SEGMENTS = [
  "Bus PVT", "Haulage", "MAV", "Tractor", "Tipper", "ICV Trucks"
];

export const SEG_COLORS = {
  "Bus PVT": "#0080C9",
  "Haulage": "#E67E22",
  "MAV": "#2ECC71",
  "Tractor": "#9B59B6",
  "Tipper": "#E74C3C",
  "ICV Trucks": "#1ABC9C"
};

// Forecast horizon = current month + next 2 months = 3-month forecast
// "Current month" is determined by last_data_month + 1
export const FORECAST_HORIZON_LENGTH = 3;

// PPP outlier window (Bus PVT only, December 2023 to August 2024)
export const PPP_OUTLIER_START = "Dec-23";
export const PPP_OUTLIER_END = "Aug-24";

// Holt-Winters parameters
export const HW_ALPHA = 0.3;
export const HW_BETA = 0.1;

// Dampening factor for multi-step forecasts
export const HW_DAMPENING_PHI = 0.65;

// Blend weights (used inside the THETA method only: 0.6 SMLY + 0.4 Theta)
export const BLEND_SMLY_WEIGHT = 0.6;
export const BLEND_THETA_WEIGHT = 0.4;

// YoY cap. Estimator MUST be trailing-12M vs prior-12M — never FY-to-date vs full FY (§5.4a).
export const YOY_CAP = 0.15;  // ±15%

// ─── v3.0 method map (constant; changing it requires a deliberate re-trial) ───
export const V3_METHOD = {
  "Bus PVT":    "ROB",     // robust-anchor SMLY × trailing-12M YoY
  "Haulage":    "THETA",   // 60% SMLY + 40% Theta
  "MAV":        "THETA",
  "Tractor":    "ROB",
  "Tipper":     "ROB",
  "ICV Trucks": "ADAPT",   // level-shift adapter
};

export const THETA_ALPHA = 0.5;          // Theta internal SES
export const THETA_SEGMENTS = ["Haulage", "MAV"];

// ADAPT — level-shift adapter (ICV Trucks)
export const ADAPT_WINDOW = 6;           // seasonally-matched trailing months
export const ADAPT_SHRINK = 0.7;
export const ADAPT_CAP = 0.30;

// Robust anchor = median(month-1, month, month+1) of prior year.
export const ROBUST_ANCHOR_SEGMENTS = ["Bus PVT", "Tractor", "Tipper"];

// RETIRED in v3.0: calendar-capacity normalization (CALENDAR_NORM_SEGMENTS, WEEK_INTENSITY, PTB_OPEN_DAYS)

// PTB share of AL hard cap (LM must survive)
export const PTB_SHARE_CAP = 0.75;

// AL market share soft bounds
export const AL_SHARE_MIN = 0.05;
export const AL_SHARE_MAX = 0.85;

// AL tolerance for forecast error (used for accuracy tracker coloring)
export const AL_TOLERANCE = 0.15;  // 15%

// Raw Data sheet row indices for segment totals
export const RAW_SEGMENT_ROWS = {
  "Bus PVT": 4,
  "Haulage": 7,
  "MAV": 22,
  "Tractor": 29,
  "Tipper": 41,
  "ICV Trucks": 48
};
```

---

## 14. Things NOT to Do

- **Do not hardcode any model parameters** in the migrated version. Everything except the trigger definitions must be recomputed from data on each upload.
- **Do not run forecast math in a Supabase Edge Function** — there is no need and client-side keeps things simple.
- **Do not truncate tables on upload** — always upsert by month to preserve audit trail and RLS behavior.
- **Do not skip the PPP outlier cleaning** — Bus PVT forecasts become nonsensical without it.
- **Do not cap PTB share above 75%** — this is a binding business constraint, not a heuristic.
- **Do not forget the Bus PVT PPP order was fulfilled entirely by PTB/AL** — so when you compute AL market share and PTB share during the PPP window (Dec 23 - Aug 24), those shares are also artificially inflated and should be handled with the same logic (replace with same-month averages from outside the window). This applies to the `tiv_forecast_al_actuals` historical chart display as well.
- **Do not try to predict AL market share with a trend model** — use recent 6-month average only. Market share is too noisy for meaningful trend extrapolation at this volume.

---

## 15. Reference: Model Math Summary (One-Pager)

```
For segment S, forecast month m, horizon step h (1,2,3), target label L:

  method = V3_METHOD[S]

  ROB    (Bus PVT, Tractor, Tipper):
    base = median(actual_S[m-1,yr-1], actual_S[m,yr-1], actual_S[m+1,yr-1]) x (1 + t12_S)

  THETA  (Haulage, MAV):
    smly  = actual_S[m, yr-1] x (1 + t12_S)
    theta = (theta_ic_S + theta_sl_S x (n + h - 1) + theta_ses_S) / 2 x SI_S[m]
    base  = 0.6 x smly + 0.4 x theta

  ADAPT  (ICV Trucks):
    g    = clamp(0.7 x (mean_{k=1..6} actual_S[t-k]/actual_S[t-12-k]) - 0.7, -0.30, +0.30)
    base = actual_S[m, yr-1] x (1 + g)

  tiv(S,m,h) = base x PRODUCT(manual trigger adjustments; all default OFF)
  al (S,m,h) = tiv x clamp(recent_6m_AL_share_S, 0.05, 0.85)
  ptb(S,m,h) = al  x min(recent_6m_PTB_share_S, 0.75)

Where:
  t12_S = clamp(sum(last 12 months) / sum(prior 12 months) - 1, -0.15, +0.15)
          ** period-matched by construction; never FY-to-date vs full FY (see 5.4a) **
  SI_S[m] = seasonal index, +/-6 centered moving average, normalised to mean 1.0
  Judgment appears nowhere in this computation.
```

## 16. Acceptance Criteria

The migration is complete when:

1. A user can navigate to `/tiv-forecast` from the home dashboard
2. A user can upload the latest `Market_Data_YY-YY.xlsx` file
3. After upload, a success toast confirms the number of months loaded
4. The Forecast Output tab shows three tables with numbers in the same ballpark as the standalone version (±2-3 units per segment per month is acceptable rounding variance)
5. Toggling triggers on the Trigger Controls tab updates the forecast tables in real time
6. Trigger state persists across page reloads and logins
7. The Segment Analysis tab shows historical data with the forecast extended as dashed lines
8. The Accuracy Tracker shows the backtest of model vs judgment errors with appropriate color coding
9. Uploading a new file with one more month of data causes seasonal indices, Holt-Winters parameters, theta parameters, capacity-normalized Tipper params, and market shares to visibly update (can verify by comparing before/after values in `tiv_forecast_model_params`)
10. The Accuracy Tracker shows the corrected **12-month** walk-forward backtest (Aug-25 to Jul-26) with overall model MAPE of **26.4%** reproducible from `model_backtest`, alongside the judgment benchmark of 28.6%. Judgment is a display column only and must not enter any forecast computation.
11. The Mar-26 v1.3 historical validation card (5.8% total TIV error) remains visible as the predecessor-model reference, clearly labelled as historical and not the current engine
12. **Every** trigger appears in Trigger Controls with default OFF, and `fuelCrisis` is absent from the list entirely
13. With all triggers OFF, the engine reproduces exactly: **Aug-26 = 64/109/125/88/147/203 (total 736), Sep-26 = 89/184/102/92/147/165 (total 779), Oct-26 = 94/159/157/92/170/178 (total 850)** in segment order Bus PVT, Haulage, MAV, Tractor, Tipper, ICV Trucks. Any deviation means the constants or splice are wrong — not the expected values.

---

## 17. Questions to Resolve With the User Before Building

- **Auth scope:** Is the TIV forecast tool restricted to specific users (e.g., just PTB staff), or available to all authenticated users of the website?
- **Multi-user trigger state:** If multiple users access the tool, should they share one set of triggers (the "official" PTB view) or each have their own sandbox? The schema above assumes per-user — this can be changed to a single-row global state if preferred.
- **Forecast horizon length:** Currently fixed at 3 months. Should this be user-configurable?
- **Upload history:** Should the upload panel show a history of past uploads (who uploaded, when)?
- **Export:** Does PTB need to export the forecast output to Excel/PDF for submission to Ashok Leyland, or is the on-screen view sufficient?

---

## 18. Model Methodology, Audit History, and Validation Plan

This section captures the reasoning behind the v2.1 per-segment champion mapping so that whoever maintains the model in 6 months can reason about whether to update it.

### How the v2.x champion was selected (SUPERSEDED — retained for history)

A walk-forward backtest was run over 8 months (Aug-25 to Mar-26 — the window for which judgment predictions exist as a baseline). For each month, the model was retrained using only data prior to that month, then made a 1-step-ahead forecast. **8 forecasting methods × 2 calendar variants = 16 method+variant combinations** were evaluated per segment:

| Code | Method | Description |
|---|---|---|
| M1 | SMLY-sum | Pure SMLY × (1 + sum-based YoY, capped ±15%) |
| M2 | SMLY-median | Pure SMLY × (1 + median-of-monthly-YoY-ratios, capped ±15%) |
| M3 | SMLY+HW | 60% M1 + 40% Dampened Holt-Winters (φ=0.65) — prior production |
| M4 | SMLY+Theta | 60% M1 + 40% Theta method on deseasonalized series |
| M5 | SMLY+HW+Theta | 60% M1 + 40% (HW + Theta averaged) |
| M6 | SMLY+Momentum | SMLY with 50/50 blend of YoY and 3-month momentum signal |
| M7 | Median Ensemble | Median of {M1, M3, M4, M6} per forecast |
| M8 | Volatility-aware | M3 with per-segment YoY cap based on coefficient of variation |

Each was tested both with and without **calendar capacity normalization** (Sundays + holidays subtracted, weekly intensity weighted 10/20/30/40).

The winner per segment is the combination with the lowest 8-month MAPE. Results:

| Segment | Winner | MAPE | Notes |
|---|---|---|---|
| Bus PVT | M1 (no cal) | 33.9% | Volatility CV=0.77 makes any smoothing model whipsaw |
| Haulage | M2 (no cal) | 31.5% | Median YoY is more robust to single-month shocks |
| MAV | M1 (no cal) | 36.6% | Same as Bus PVT — pure SMLY anchor wins on noisy series |
| Tractor | M4 (no cal) | 33.5% | Theta captures the slow linear growth pattern in tractor demand |
| Tipper | M3 with cal | 14.8% | Construction is genuinely day-count sensitive; cal-norm helps 2.8 pts |
| ICV Trucks | M2 (no cal) | 22.5% | Median YoY robust to ICV volatility |

**Champion overall MAPE: 28.8%** vs prior production M3 single-method 32.9% (12% relative improvement). **Judgment baseline: 26.5%** — judgment still wins over the same window, and wins 5 of 8 individual months. The model is a quantitative anchor for judgment, not a replacement.

### Why simpler beat complex

The recurring finding across all 6 segments: pure SMLY anchors beat smoothing models. Holt-Winters and Theta both try to extract trend from noisy series with CV between 0.4 and 0.77. With 48 observations they get whipsawed by individual shock months (record March 2026 alone moved HW trend estimates significantly). Pure SMLY ignores local trend and anchors to last year's same-month value, which is more robust precisely because it carries less information.

Theta only helped Tractor (the segment with the cleanest linear growth signal). The median ensemble (M7) didn't beat any single method because the constituent methods all miss the same shock months together — their errors are correlated. Volatility-aware caps (M8) didn't move the needle.

### Key caveats

1. **In-sample selection bias.** With 16 combinations × 6 segments × 8 months, the champion was picked on the same data it was evaluated on. Real overfitting risk exists. A method that wins by 0.5pp may not generalize.
2. **Short backtest window.** 8 months is event-heavy: Iran war, AIS 153 hypothesis, FY-end record March all fall inside it. Per-segment MAPE numbers are noisy at this sample size.
3. **YoY cap saturation.** For Apr-Jun 2026 specifically, the +15% YoY cap binds for Bus PVT, Haulage, MAV, and ICV Trucks because the market grew strongly through FY26. This means M1 and M2 produce identical forward forecasts for these segments in this window — the per-segment method choice only matters when the cap stops binding.
4. **Bus PVT is fundamentally hard.** CV of 0.77, dependent on tender pipelines that aren't visible in the time series. Even the champion gives 34% MAPE. No model will fix this without seeing private demand information.

### Validation plan — DO NOT change the champion mapping until this completes

**Phase 1 — Apr-26 to Jun-26 (forward validation):**
- Lock the champion mapping and trigger defaults as they are
- Each month before the actual is known, record the model's prediction (it's stored in the forecast tab automatically; just take a snapshot)
- After the actual lands, compare model vs judgment vs actual for that month
- Compute rolling 3-month MAPE for each

**Phase 2 — Decision point after Jun-26 actual:**
- If champion's 3-month forward MAPE ≤ judgment's: lock the mapping for production use
- If champion's 3-month forward MAPE > judgment's by more than 5pp: revert to prior M3 production model and re-investigate
- Either way, re-run the trial framework on the now-11-month backtest (Aug-25 to Jun-26) and check whether the per-segment winners are stable. Only commit a mapping change if at least 2 of 6 segments produce a different winner with the longer window.

**Phase 3 — AIS 153 investigation:**
- The AIS 153 trigger is OFF by default because retroactive backtest dampening (Sep-25 to Mar-26) made Bus PVT MAPE worse, not better. This means one of: the AIS 153 hypothesis was overstated, PTB Bus PVT was driven by specific contracts that bypassed the hypothesized dynamics, or the calibration was too aggressive.
- Before re-enabling, look at the actual Bus PVT order-book composition for Sep-25 to Mar-26 and identify what drove sales. If the strong months were tender-driven (PPP-style), the trigger should remain off and judgment-only adjustments should be used for tender-sensitive forecasts. If they were normal commercial demand despite the body builder license issues, then the AIS 153 hypothesis itself was wrong.

### What NOT to do

- **Do not add more forecasting methods.** The trial showed diminishing returns past M1-M4. Adding more methods just creates more places for overfitting bias.
- **Do not try ML methods (random forest, XGBoost, neural nets).** With N=48 per segment you would overfit catastrophically.
- **Do not try to beat judgment outright on average MAPE.** Use the model as an anchor that judgment adjusts.
- **Do not recompute the champion mapping on every retrain.** The CHAMPION constant should change only after a deliberate trial re-run, never silently.
- **Do not enable AIS 153 by default until Phase 3 investigation completes.**

---

### v3.0 audit history and standing prohibitions

**What happened.** The v2.x walk-forward harness used an FY-to-date-vs-full-FY YoY ratio (§5.4a). It pinned growth at −15% in 56 of 72 backtest segment-months. Every v2.x champion selection rested on those numbers and has been withdrawn. The deployed model was never actually validated, because production constants were computed correctly at train time while the backtest used the broken path — the shipped numbers were fine, the evidence for them was not.

**What replaced it.** A corrected 12-month walk-forward (Aug-25..Jul-26) over ten candidate estimators. Findings: the growth estimator barely matters (all saturate at the cap in this regime); the **anchor** matters a great deal (robust anchors halve Tractor error, but destroy MAV's genuine sharp seasonality); calendar normalisation's advantage vanished; and ADAPT decisively wins ICV Trucks (13.8% vs 19.5%), holding up out-of-sample when selected on the first 8 months and tested blind on the last 4.

**Market context behind the numbers (for whoever inherits this).** GST 2.0 cut CV GST from 28% to 18% in Sep-25 — a durable level shift, which is what ADAPT exists to track. The 2026 Iran war (Feb–Jun) did *not* suppress demand; CV sales rose through it. Territory Q1 FY27 growth (+37/+16/+68% YoY) ran far hotter than AL's national M&HCV (+5% Q1), and analysts expect FY27 to decelerate to low single digits. The model will therefore under-forecast while the boom persists. **That is accepted, conservative-by-design behaviour, not a defect** — no SMLY-anchored model can forecast a tax reform.

**Standing prohibitions:**
- No judgment in forecast math, ever. Judgment is a benchmark column in the Accuracy Tracker and nothing more.
- No FY-to-date-vs-full-FY YoY, ever.
- No features requiring manually maintained or externally fetched data (rules out share-of-national modelling).
- No recomputing `V3_METHOD` on routine retrains.
- No ML methods (N≈52 per segment) and no re-adding `fuelCrisis`.
- No manual outlier lists — the robust anchor handles spikes arithmetically.

### Open items (not blocking)

1. **AL/LM split for Apr-26 onward is missing** from the upload file, so `al_share_recent`, `ptb_share_recent` and the AL share chart are stale as of Mar-26. UI must label the cascade "shares as of Mar-26" until Dhruv supplies AL data.
2. Aug-26 judgment row → populate `JT` for the forecast-tab display comparison when available.
3. Next re-trial checkpoint: **after Oct-26 actuals** (15-month window). Re-examine ADAPT stability for ICV, and whether Haulage warrants ADAPT too — it was second-best there, and Haulage bias remains −19% to −37% under every capped method.

---

*End of specification.*
