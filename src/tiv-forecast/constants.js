// TIV Forecast — shared constants (direct port from migration spec Section 13)

export const SEGMENTS = [
  'Bus PVT', 'Haulage', 'MAV', 'Tractor', 'Tipper', 'ICV Trucks',
]

export const SEG_COLORS = {
  'Bus PVT':   '#0080C9',
  'Haulage':   '#E67E22',
  'MAV':       '#2ECC71',
  'Tractor':   '#9B59B6',
  'Tipper':    '#E74C3C',
  'ICV Trucks':'#1ABC9C',
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

// Holt-Winters smoothing parameters
export const HW_ALPHA = 0.3
export const HW_BETA  = 0.1

// Dampening factor for multi-step Holt-Winters forecast
export const HW_DAMPENING_PHI = 0.65

// Blend weights: 60% SMLY anchor + 40% HW signal
export const BLEND_SMLY_WEIGHT = 0.6
export const BLEND_HW_WEIGHT   = 0.4

// YoY growth cap: ±15% max
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

// ── v2.1 Champion model ──────────────────────────────────────────────

// Per-segment champion method after 8-month walk-forward backtest (Aug-25 to Mar-26)
// M1=SMLY×(1+yoy_sum)  M2=SMLY×(1+yoy_median)  M4=Theta  M3_CAL=CalNorm+HW
// Do NOT auto-update on retrain — re-run trial framework after Jun-26 forward validation
export const CHAMPION = {
  'Bus PVT':   'M1',
  'Haulage':   'M2',
  'MAV':       'M1',
  'Tractor':   'M4',
  'Tipper':    'M3_CAL',
  'ICV Trucks':'M2',
}

// SES smoothing parameter for Theta method (M4)
export const THETA_ALPHA = 0.3

// Tipper calendar normalization: weekly booking intensity (must sum to 100)
// Week 1 (days 1-7) = 10%, Week 2 (8-14) = 20%, Week 3 (15-21) = 30%, Week 4 (22-end) = 40%
export const WEEK_INTENSITY = { 1: 10, 2: 20, 3: 30, 4: 40 }

// PTB closed days: Sundays (computed) + these public holidays (YYYY-MM-DD)
// Fixed: Republic Day Jan 26, Independence Day Aug 15, Gandhi Jayanti Oct 2
// Variable: Holi (1 day), Diwali block (5 days from Diwali day)
// Note: Jan 1 and Dec 25 are NOT PTB holidays; Uttarayan (Jan 14-15) included for Gujarat
export const HOLIDAYS = new Set([
  // Republic Day
  '2022-01-26','2023-01-26','2024-01-26','2025-01-26','2026-01-26','2027-01-26',
  // Uttarayan (Makar Sankranti) — Jan 14-15
  '2022-01-14','2022-01-15','2023-01-14','2023-01-15',
  '2024-01-14','2024-01-15','2025-01-14','2025-01-15',
  '2026-01-14','2026-01-15','2027-01-14','2027-01-15',
  // Holi (1 day)
  '2022-03-18','2023-03-08','2024-03-25','2025-03-14','2026-03-03','2027-03-22',
  // Independence Day
  '2022-08-15','2023-08-15','2024-08-15','2025-08-15','2026-08-15','2027-08-15',
  // Gandhi Jayanti
  '2022-10-02','2023-10-02','2024-10-02','2025-10-02','2026-10-02','2027-10-02',
  // Diwali block (5 working days starting Diwali)
  '2022-10-24','2022-10-25','2022-10-26','2022-10-27','2022-10-28',
  '2023-11-12','2023-11-13','2023-11-14','2023-11-15','2023-11-16',
  '2024-11-01','2024-11-02','2024-11-03','2024-11-04','2024-11-05',
  '2025-10-20','2025-10-21','2025-10-22','2025-10-23','2025-10-24',
  '2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12',
  '2027-10-29','2027-10-30','2027-10-31','2027-11-01','2027-11-02',
])
