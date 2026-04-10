// TIV Forecast — model retraining (migration spec Section 5)
// Pure JS, no ML libraries. Runs client-side after every upload.
import {
  SEGMENTS, SEG_COL,
  PPP_START_IDX, PPP_END_IDX,
  HW_ALPHA, HW_BETA,
  YOY_CAP, SHARE_LOOKBACK_MONTHS,
} from '../constants'

const BACKTEST_MONTHS = 12  // how many historical months to store as model backtest

// ── PPP outlier cleaning (Bus PVT only) ──────────────────────────────
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
  const windowSize = 12
  const centeredMA = new Array(n).fill(null)
  for (let i = Math.floor(windowSize / 2); i < n - Math.floor(windowSize / 2); i++) {
    let sum = 0
    for (let j = i - 6; j < i + 6; j++) sum += data[j]
    centeredMA[i] = sum / windowSize
  }
  const rawSI = {}
  for (let i = 0; i < n; i++) {
    if (centeredMA[i] === null || centeredMA[i] === 0) continue
    const m = monthsMeta[i].month_num
    if (!rawSI[m]) rawSI[m] = []
    rawSI[m].push(data[i] / centeredMA[i])
  }
  const si = {}
  let siSum = 0
  for (let m = 1; m <= 12; m++) {
    const vals = rawSI[m] || []
    si[m] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 1.0
    siSum += si[m]
  }
  const scaleFactor = 12 / siSum
  for (let m = 1; m <= 12; m++) si[m] *= scaleFactor
  return si
}

// ── Holt linear trend — returns terminal state + full level/trend arrays ──
function holtLinear(data) {
  const n = data.length
  if (n === 0) return { level: 0, trend: 0, levelArr: [], trendArr: [] }
  const levelArr = new Array(n).fill(0)
  const trendArr = new Array(n).fill(0)
  levelArr[0] = data[0]
  trendArr[0] = n > 1 ? (data[Math.min(11, n - 1)] - data[0]) / Math.min(11, n - 1) : 0
  for (let t = 1; t < n; t++) {
    levelArr[t] = HW_ALPHA * data[t] + (1 - HW_ALPHA) * (levelArr[t - 1] + trendArr[t - 1])
    trendArr[t] = HW_BETA  * (levelArr[t] - levelArr[t - 1]) + (1 - HW_BETA) * trendArr[t - 1]
  }
  return { level: levelArr[n - 1], trend: trendArr[n - 1], levelArr, trendArr }
}

// ── Train HW for one segment — also returns per-month fitted values ──
function trainHoltForSegment(rawData, seasonalIndices, monthsMeta) {
  const deseasonalized = rawData.map((v, i) => {
    const si = seasonalIndices[monthsMeta[i].month_num]
    return si > 0 ? v / si : v
  })
  const { level, trend, levelArr, trendArr } = holtLinear(deseasonalized)

  // 1-step-ahead fitted: (L[t-1] + T[t-1]) × SI[month]
  const fitted = rawData.map((v, t) => {
    if (t === 0) return Math.round(v)
    const si = seasonalIndices[monthsMeta[t].month_num] || 1
    return Math.max(0, Math.round((levelArr[t - 1] + trendArr[t - 1]) * si))
  })

  return { level, trend, fitted }
}

// ── SMLY values for forecast horizon months ──────────────────────────
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
function computeYoYCapped(data, monthsMeta) {
  const n = data.length
  if (n < 13) return 0
  const lastMonth = monthsMeta[n - 1]
  const lastFYAprilIdx = (() => {
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
    if (prevYearIdx >= 0) { fy25Sum += data[prevYearIdx]; count++ }
  }
  if (fy25Sum === 0 || count === 0) return 0
  const raw = fy26Sum / fy25Sum - 1
  return Math.max(-YOY_CAP, Math.min(YOY_CAP, raw))
}

// ── Market share averages (recent N months) ──────────────────────────
function computeRecentShares(numeratorActuals, denominatorActuals) {
  const denomMap = {}
  for (const row of denominatorActuals) denomMap[row.month_index] = row
  const shares = {}
  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    const recent = []
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
  const segFitted = {}  // per-segment array of in-sample fitted values

  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    let rawData = tiv.map(r => Number(r[col]) || 0)
    if (seg === 'Bus PVT') rawData = cleanBusPVT(rawData, monthsMeta)

    seasonalIndices[seg] = computeSeasonalIndices(rawData, monthsMeta)
    const hwResult = trainHoltForSegment(rawData, seasonalIndices[seg], monthsMeta)
    hwParams[seg] = { level: hwResult.level, trend: hwResult.trend }
    segFitted[seg] = hwResult.fitted
    smly[seg] = computeSMLY(rawData, monthsMeta, lastIdx)
    yoyCapped[seg] = computeYoYCapped(rawData, monthsMeta)
  }

  // Market shares
  const alShareRecent  = computeRecentShares(al, tiv)
  const ptbShareRecent = computeRecentShares(ptb, al)

  // ── Model backtest: last BACKTEST_MONTHS of in-sample fitted values ──
  // Stored as array of { month_label, [seg_col]: fitted_value }
  // Used in Accuracy Tracker to compare model error vs judgment error
  const backtestStart = Math.max(1, n - BACKTEST_MONTHS)
  const modelBacktest = []
  for (let i = backtestStart; i < n; i++) {
    const record = { month_label: tiv[i].month_label }
    for (const seg of SEGMENTS) {
      record[SEG_COL[seg]] = segFitted[seg][i]
    }
    modelBacktest.push(record)
  }

  return {
    last_data_month:  tiv[lastIdx].month_label,
    total_months:     n,
    seasonal_indices: seasonalIndices,
    hw_params:        hwParams,
    smly,
    yoy_capped:       yoyCapped,
    al_share_recent:  alShareRecent,
    ptb_share_recent: ptbShareRecent,
    model_backtest:   modelBacktest,
  }
}
