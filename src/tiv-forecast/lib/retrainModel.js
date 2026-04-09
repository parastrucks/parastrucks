// TIV Forecast — model retraining (migration spec Section 5)
// Pure JS, no ML libraries. Runs client-side after every upload.
import {
  SEGMENTS, SEG_COL,
  PPP_START_IDX, PPP_END_IDX,
  HW_ALPHA, HW_BETA,
  YOY_CAP, SHARE_LOOKBACK_MONTHS,
} from '../constants'

// ── PPP outlier cleaning (Bus PVT only) ──────────────────────────────
// Dec 2023 – Aug 2024: replace with same-calendar-month averages from outside window
function cleanBusPVT(data, monthsMeta) {
  const cleaned = [...data]
  for (let i = PPP_START_IDX; i <= PPP_END_IDX && i < data.length; i++) {
    const targetMonth = monthsMeta[i].month_num
    const sameMonthValues = []
    for (let j = 0; j < data.length; j++) {
      if (j >= PPP_START_IDX && j <= PPP_END_IDX) continue
      if (monthsMeta[j].month_num === targetMonth) sameMonthValues.push(data[j])
    }
    if (sameMonthValues.length > 0) {
      cleaned[i] = Math.round(sameMonthValues.reduce((a, b) => a + b, 0) / sameMonthValues.length)
    }
  }
  return cleaned
}

// ── Seasonal indices (multiplicative, normalized to avg = 1.0) ───────
function computeSeasonalIndices(data, monthsMeta) {
  const n = data.length
  const ma = new Array(n).fill(null)
  for (let i = 6; i < n - 6; i++) {
    const window = data.slice(i - 6, i + 6)
    ma[i] = window.reduce((a, b) => a + b, 0) / 12
  }
  const ratios = {}
  for (let m = 1; m <= 12; m++) ratios[m] = []
  for (let i = 0; i < n; i++) {
    if (ma[i] && ma[i] > 0) {
      ratios[monthsMeta[i].month_num].push(data[i] / ma[i])
    }
  }
  const indices = {}
  for (let m = 1; m <= 12; m++) {
    indices[m] = ratios[m].length > 0
      ? ratios[m].reduce((a, b) => a + b, 0) / ratios[m].length
      : 1.0
  }
  const avg = Object.values(indices).reduce((a, b) => a + b, 0) / 12
  for (let m = 1; m <= 12; m++) indices[m] = parseFloat((indices[m] / avg).toFixed(4))
  return indices
}

// ── Holt's linear trend on deseasonalized series ─────────────────────
function holtLinear(data) {
  const n = data.length
  if (n === 0) return { level: 0, trend: 0 }
  const level = new Array(n).fill(0)
  const trend = new Array(n).fill(0)
  level[0] = data[0]
  trend[0] = n > 1 ? (data[Math.min(11, n - 1)] - data[0]) / Math.min(11, n - 1) : 0
  for (let t = 1; t < n; t++) {
    level[t] = HW_ALPHA * data[t] + (1 - HW_ALPHA) * (level[t - 1] + trend[t - 1])
    trend[t] = HW_BETA  * (level[t] - level[t - 1]) + (1 - HW_BETA) * trend[t - 1]
  }
  return { level: level[n - 1], trend: trend[n - 1] }
}

function trainHoltForSegment(rawData, seasonalIndices, monthsMeta) {
  const deseasonalized = rawData.map((v, i) => {
    const si = seasonalIndices[monthsMeta[i].month_num]
    return si > 0 ? v / si : v
  })
  return holtLinear(deseasonalized)
}

// ── SMLY values for forecast horizon months ──────────────────────────
// Given last data month index, compute SMLY for the next 3 forecast months
function computeSMLY(data, monthsMeta, lastIdx) {
  const smly = {}
  for (let h = 1; h <= 3; h++) {
    const forecastIdx = lastIdx + h
    const forecastMonthNum = monthsMeta[forecastIdx]?.month_num
      ?? ((monthsMeta[lastIdx].month_num - 1 + h) % 12) + 1
    const sameMonthLastYear = forecastIdx - 12
    if (sameMonthLastYear >= 0 && sameMonthLastYear < data.length) {
      smly[forecastMonthNum] = data[sameMonthLastYear]
    } else {
      smly[forecastMonthNum] = 0
    }
  }
  return smly
}

// ── YoY growth capped at ±15% ────────────────────────────────────────
// FY runs Apr–Mar. Use FY-to-date comparison.
function computeYoYCapped(data, monthsMeta) {
  const n = data.length
  if (n < 13) return 0
  // Find current and last FY ranges using Apr as start (month_num 4)
  // Use all completed months in current fiscal year vs same months last year
  const lastMonth = monthsMeta[n - 1]
  const lastFYAprilIdx = (() => {
    // Walk back to find the most recent April
    for (let i = n - 1; i >= 0; i--) {
      if (monthsMeta[i].month_num === 4) return i
    }
    return -1
  })()
  if (lastFYAprilIdx === -1) return 0

  let fy26Sum = 0, fy25Sum = 0, count = 0
  for (let i = lastFYAprilIdx; i < n; i++) {
    fy26Sum += data[i]
    const prevYearIdx = i - 12
    if (prevYearIdx >= 0) {
      fy25Sum += data[prevYearIdx]
      count++
    }
  }
  if (fy25Sum === 0 || count === 0) return 0
  const raw = fy26Sum / fy25Sum - 1
  return Math.max(-YOY_CAP, Math.min(YOY_CAP, raw))
}

// ── Market share averages (recent N months) ──────────────────────────
// Returns { [segment]: averageShare } for recent SHARE_LOOKBACK_MONTHS
function computeRecentShares(numeratorActuals, denominatorActuals) {
  // Both arrays must be aligned by month_index
  const denomMap = {}
  for (const row of denominatorActuals) {
    denomMap[row.month_index] = row
  }
  const shares = {}
  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    const recent = []
    // Take the last SHARE_LOOKBACK_MONTHS months where both num and denom exist
    const sorted = [...numeratorActuals].sort((a, b) => b.month_index - a.month_index)
    for (const numRow of sorted) {
      const denomRow = denomMap[numRow.month_index]
      if (!denomRow) continue
      const num = Number(numRow[col]) || 0
      const den = Number(denomRow[col]) || 0
      if (den > 0) recent.push(num / den)
      if (recent.length >= SHARE_LOOKBACK_MONTHS) break
    }
    shares[seg] = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0.5
  }
  return shares
}

// ── Main retrain function ─────────────────────────────────────────────
export function retrainModel(tivActuals, ptbActuals, alActuals) {
  if (!tivActuals.length) throw new Error('No TIV data to retrain on')

  // Sort by month_index ascending
  const tiv = [...tivActuals].sort((a, b) => a.month_index - b.month_index)
  const ptb = [...ptbActuals].sort((a, b) => a.month_index - b.month_index)
  const al  = [...alActuals ].sort((a, b) => a.month_index - b.month_index)

  const monthsMeta = tiv.map(r => ({ month_num: r.month_num, month_index: r.month_index }))
  const n = tiv.length
  const lastIdx = n - 1

  const seasonalIndices = {}
  const hwParams = {}
  const smly = {}
  const yoyCapped = {}

  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    let rawData = tiv.map(r => Number(r[col]) || 0)

    // Apply PPP cleaning for Bus PVT
    if (seg === 'Bus PVT') rawData = cleanBusPVT(rawData, monthsMeta)

    seasonalIndices[seg] = computeSeasonalIndices(rawData, monthsMeta)
    hwParams[seg] = trainHoltForSegment(rawData, seasonalIndices[seg], monthsMeta)
    smly[seg] = computeSMLY(rawData, monthsMeta, lastIdx)
    yoyCapped[seg] = computeYoYCapped(rawData, monthsMeta)
  }

  // Market shares: AL share of TIV, PTB share of AL
  const alShareRecent = computeRecentShares(al, tiv)
  const ptbShareRecent = computeRecentShares(ptb, al)

  return {
    last_data_month:  tiv[lastIdx].month_label,
    total_months:     n,
    seasonal_indices: seasonalIndices,
    hw_params:        hwParams,
    smly,
    yoy_capped:       yoyCapped,
    al_share_recent:  alShareRecent,
    ptb_share_recent: ptbShareRecent,
  }
}
