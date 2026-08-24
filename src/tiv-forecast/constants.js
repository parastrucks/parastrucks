// TIV Forecast — shared constants (direct port from migration spec Section 13)

export const SEGMENTS = [
  'Bus PVT', 'Haulage', 'MAV', 'Tractor', 'Tipper', 'ICV Trucks',
]

// Muted categorical palette — distinct hues at the design tokens' (low) saturation
// so multi-segment charts stay legible without the old saturated-rainbow look.
// Bus PVT leads on the accent blue; the rest are spaced, deep, print-report tones.
export const SEG_COLORS = {
  'Bus PVT':   '#2563EB', // accent blue
  'Haulage':   '#0E7490', // teal
  'MAV':       '#7C3AED', // violet
  'Tractor':   '#B45309', // amber
  'Tipper':    '#475569', // slate
  'ICV Trucks':'#9D174D', // rose (kept clear of the semantic red)
}

// DB column names for each segment (snake_case mapping)
export const SEG_COL = {
  'Bus PVT':   'bus_pvt',
  'Haulage':   'haulage',
  'MAV':       'mav',
  'Tractor':   'tractor',
  'Tipper':    'tipper',
  'ICV Trucks':'icv_trucks',
}

// Forecast horizon: current month + next 2 = 3 months
export const FORECAST_HORIZON_LENGTH = 3

// PPP outlier window — Bus PVT only (Dec 2023 to Aug 2024)
// Apr-22 is month_index 0; Dec-23 = 20; Aug-24 = 28
export const PPP_START_IDX = 20
export const PPP_END_IDX   = 28
export const PPP_OUTLIER_START = 'Dec-23'
export const PPP_OUTLIER_END   = 'Aug-24'

// Holt-Winters smoothing parameters.
// ⚠ v3.0: NO method uses Holt any more (ROB/THETA/ADAPT all avoid it). Retained
// only because spec §13 still lists them; safe to delete once §5.3 is retired.
export const HW_ALPHA = 0.3
export const HW_BETA  = 0.1
export const HW_DAMPENING_PHI = 0.65

// Blend weights — used INSIDE the THETA method only (0.6 SMLY + 0.4 Theta)
export const BLEND_SMLY_WEIGHT = 0.6
export const BLEND_THETA_WEIGHT = 0.4

// YoY growth cap: ±15% max.
// The estimator MUST be trailing-12M vs prior-12M — never FY-to-date vs full FY.
// See spec §5.4a: the FY-to-date form pinned growth at -15% in 56 of 72 backtest
// segment-months and invalidated every v2.x model selection.
export const YOY_CAP = 0.15

// PTB share of AL: hard cap (LM must survive)
export const PTB_SHARE_CAP = 0.75

// AL market share soft bounds
export const AL_SHARE_MIN = 0.05
export const AL_SHARE_MAX = 0.85

// AL forecast tolerance (15% = green, 25% = amber, >25% = red)
export const AL_TOLERANCE = 0.15

// Raw Data sheet — row indices (0-based) where segment totals appear
export const RAW_SEGMENT_ROWS = {
  'Bus PVT':   4,
  'Haulage':   7,
  'MAV':       22,
  'Tractor':   29,
  'Tipper':    41,
  'ICV Trucks':48,
}

// Market share columns in Raw Data per-month block (0-based offset from block start)
// Columns per month block: AL | PTB | LM | TML | EML | M&M | BB | Others | TIV | MS%
export const RAW_COL_OFFSET = {
  AL: 0, PTB: 1, LM: 2, TML: 3, EML: 4, 'M&M': 5, BB: 6, Others: 7, TIV: 8, 'MS%': 9,
}

// Number of columns per month block in Raw Data sheet
export const RAW_COLS_PER_MONTH = 11  // 10 data cols + 1 spacer

// Recent N months for market share averages
export const SHARE_LOOKBACK_MONTHS = 6

// ── v3.0 method map ──────────────────────────────────────────────────
// Adopted from the CORRECTED 12-month walk-forward backtest (Aug-25..Jul-26).
// The v2.1 champion map (M1/M2/M4/M3_CAL) is WITHDRAWN — it was selected on a
// harness with the §5.4a YoY defect and none of its evidence stands.
//
//   ROB   robust-anchor SMLY × (1 + trailing-12M YoY, ±15%)
//   THETA 0.6·plain SMLY·(1+t12) + 0.4·Theta(h)·SI[m]
//   ADAPT plain SMLY × (1 + g), level-shift adapter
//
// Per-segment 12-mo MAPE: 28.2 / 29.9 / 30.0 / 33.5 / 23.1 / 13.8
// Overall model 26.4% vs judgment benchmark 28.6%.
//
// ⚠ Do NOT recompute this map on routine retrains — it is a code constant.
// Changing it requires a deliberate re-trial with period-matched estimators.
// Next re-trial checkpoint: after Oct-26 actuals (15-month window).
export const V3_METHOD = {
  'Bus PVT':   'ROB',
  'Haulage':   'THETA',
  'MAV':       'THETA',
  'Tractor':   'ROB',
  'Tipper':    'ROB',
  'ICV Trucks':'ADAPT',
}

// Theta method (Haulage + MAV only): linear fit + SES on the deseasonalized series
export const THETA_ALPHA    = 0.5
export const THETA_SEGMENTS = ['Haulage', 'MAV']

// Robust anchor = median(month-1, month, month+1) of the prior year.
// Halves Tractor error and neutralizes one-month spikes arithmetically
// (e.g. Jun-26 Bus PVT 239 STU tender → median(87,239,85) = 87).
// Wrong for MAV, whose sharp seasonality is real signal — hence per-segment.
export const ROBUST_ANCHOR_SEGMENTS = ['Bus PVT', 'Tractor', 'Tipper']

// ADAPT — level-shift adapter (ICV Trucks only).
// Exists because GST 2.0 (CV rate 28%→18%, Sep-25) shifted demand beyond what a
// ±15%-capped estimator can express; ICV raw t12 growth is +43.6%.
export const ADAPT_WINDOW = 6     // seasonally-matched trailing months
export const ADAPT_SHRINK = 0.7
export const ADAPT_CAP    = 0.30

// RETIRED in v3.0: calendar-capacity normalization (WEEK_INTENSITY, HOLIDAYS,
// cap_scores, tipper_norm_*). Its 2.8pp Tipper advantage was an artefact of the
// defective harness; under corrected estimators plain t12 + robust anchor wins
// (23.1% vs 24.6%). Do not reintroduce without a fresh trial.
