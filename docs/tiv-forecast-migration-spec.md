# TIV Forecast Tool — Migration Specification

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
Stores the retrained model parameters after each upload. Always one active row.
```sql
CREATE TABLE tiv_forecast_model_params (
  id BIGSERIAL PRIMARY KEY,
  trained_at TIMESTAMPTZ DEFAULT NOW(),
  last_data_month TEXT NOT NULL,        -- e.g. "Mar-26"
  total_months INT NOT NULL,            -- e.g. 48
  -- seasonal_indices: { "Bus PVT": {1: 0.63, 2: 0.91, ...}, ... }
  seasonal_indices JSONB NOT NULL,
  -- hw_params: { "Bus PVT": {level: 93.96, trend: 1.0}, ... }
  hw_params JSONB NOT NULL,
  -- smly: { "Bus PVT": {4: 65, 5: 68, 6: 128}, ... }  -- values for forecast horizon
  smly JSONB NOT NULL,
  -- yoy_capped: { "Bus PVT": -0.057, "Haulage": 0.15, ... }
  yoy_capped JSONB NOT NULL,
  -- al_share_recent: { "Bus PVT": 0.33, "Haulage": 0.62, ... }  -- recent 6-month avg
  al_share_recent JSONB NOT NULL,
  -- ptb_share_recent: { "Bus PVT": 0.72, ... }
  ptb_share_recent JSONB NOT NULL,
  -- Raw Bus PVT cleaned data for reference
  notes TEXT
);
```

Only the latest row is used by the forecast engine. Keep history for audit. Query with `ORDER BY trained_at DESC LIMIT 1`.

### Table: `tiv_forecast_trigger_state`
Persisted trigger configuration. Scoped per user via RLS.
```sql
CREATE TABLE tiv_forecast_trigger_state (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_id TEXT NOT NULL,     -- e.g. "fuelCrisis"
  on_state BOOLEAN NOT NULL DEFAULT FALSE,
  severity INT NOT NULL DEFAULT 0,
  direction TEXT DEFAULT 'dampen',  -- 'boost' or 'dampen' for dual-type triggers
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, trigger_id)
);
```

### RLS policies
Apply policies consistent with the existing project — typically: authenticated users can read all `tiv_forecast_*` tables, only authenticated users can write to actuals/judgment/raw_data/model_params. The `trigger_state` table should restrict read/write to the user's own rows.

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

### 5.4 Same-Month-Last-Year (SMLY) and YoY growth

For each segment, store the SMLY values for the forecast horizon months (April, May, June, and optionally March for current-month tracking). These are simply the values from 12 months prior.

Compute YoY growth as FY-to-date-this-year vs FY-to-date-last-year, then cap at ±15% to prevent runaway extrapolation. The Indian fiscal year runs April–March, so FY26 spans Apr-25 through Mar-26.

```js
function computeYoYCapped(segmentData, monthsMeta) {
  // Find all indices in FY26 (Apr 2025 through Mar 2026 — or latest available)
  // and the matching months in FY25
  // Use completed months only
  // ...
  const rawYoY = fy26Sum > 0 && fy25Sum > 0 ? fy26Sum / fy25Sum - 1 : 0;
  return Math.max(-0.15, Math.min(0.15, rawYoY));
}
```

### 5.5 Blended forecast formula

For each forecast month with horizon step `h` (1 = next month, 2 = month after, etc.):

```js
const PHI = 0.65;  // Damping factor

function dampedTrendSum(h) {
  let s = 0;
  for (let i = 1; i <= h; i++) s += Math.pow(PHI, i);
  return s;
}

function forecastTIV(segment, forecastMonth, horizonStep, triggers, modelParams) {
  const m = forecastMonth;  // 1-12
  const h = horizonStep;

  // Method 1: Dampened Holt-Winters
  const tp = modelParams.hw_params[segment];
  const si = modelParams.seasonal_indices[segment][m];
  const hw = (tp.level + tp.trend * dampedTrendSum(h)) * si;

  // Method 2: Same-Month-Last-Year with capped YoY growth
  const smlyBase = modelParams.smly[segment][m] || 0;
  const smly = smlyBase * (1 + modelParams.yoy_capped[segment]);

  // Blend: 60% SMLY anchor (conservative) + 40% HW signal
  let forecast = 0.6 * smly + 0.4 * hw;

  // Apply triggers (see section 6)
  forecast = applyTriggers(forecast, segment, m, triggers);

  return Math.max(0, Math.round(forecast));
}
```

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

---

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
    desc: "Body builder license approvals boost MDV Bus through Q1-Q2 FY27, 30% spillover to ICV Trucks",
    affected: ["Bus PVT", "ICV Trucks"],
    segWeight: { "Bus PVT": 1.0, "ICV Trucks": 0.3 },
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

    // Type 3: Weighted segment boost (e.g., AIS 153 full for Bus PVT, 30% for ICV)
    if (def.segWeight) {
      const w = def.segWeight[segment];
      if (w && def.months?.includes(monthNum)) {
        f *= (1 + w * t.severity / 100);
      }
      continue;
    }

    // Type 4: Standard dampen/boost/both
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

**Default triggers that should be ON at initial load:** `fyPush`, `ais153`, `fuelCrisis`. The rest default OFF.

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
5. **Build `lib/retrainModel.js`** — Port the Python retraining logic to JS (PPP cleaning, seasonal indices, Holt-Winters, SMLY, YoY, shares)
6. **Build `lib/forecastEngine.js`** — Core blended forecast math + trigger application
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

// Blend weights
export const BLEND_SMLY_WEIGHT = 0.6;
export const BLEND_HW_WEIGHT = 0.4;

// YoY cap to prevent runaway extrapolation
export const YOY_CAP = 0.15;  // ±15%

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
For each segment S, forecast month m, horizon step h (1,2,3):

  HW(S,m,h)   = (level_S + trend_S × Σᵢ₌₁ʰ φⁱ) × SI_S[m]
  SMLY(S,m)   = actual_S[m, year-1] × (1 + capped_YoY_S)
  base(S,m,h) = 0.6 × SMLY(S,m) + 0.4 × HW(S,m,h)
  tiv(S,m,h)  = base × Π (trigger adjustments)
  al(S,m,h)   = tiv × clamp(recent_6m_AL_share_S, 0.05, 0.85)
  ptb(S,m,h)  = al × min(recent_6m_PTB_share_S, 0.75)

Where:
  φ = 0.65 (dampening factor)
  capped_YoY_S = clamp(FY26_sum_S / FY25_sum_S - 1, -0.15, 0.15)
  SI_S[m] = normalized seasonal index, average 1.0 across 12 months
  level_S, trend_S = Holt(deseasonalized, α=0.3, β=0.1)
```

---

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
9. Uploading a new file with one more month of data causes seasonal indices, Holt-Winters parameters, and market shares to visibly update (can verify by comparing before/after values in `tiv_forecast_model_params`)
10. The AL accuracy of the Mar-26 model run against actuals (5.8% total TIV error) remains traceable in the Accuracy Tracker

---

## 17. Questions to Resolve With the User Before Building

- **Auth scope:** Is the TIV forecast tool restricted to specific users (e.g., just PTB staff), or available to all authenticated users of the website?
- **Multi-user trigger state:** If multiple users access the tool, should they share one set of triggers (the "official" PTB view) or each have their own sandbox? The schema above assumes per-user — this can be changed to a single-row global state if preferred.
- **Forecast horizon length:** Currently fixed at 3 months. Should this be user-configurable?
- **Upload history:** Should the upload panel show a history of past uploads (who uploaded, when)?
- **Export:** Does PTB need to export the forecast output to Excel/PDF for submission to Ashok Leyland, or is the on-screen view sufficient?

---

*End of specification.*
