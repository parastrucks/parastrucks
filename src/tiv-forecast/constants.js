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
