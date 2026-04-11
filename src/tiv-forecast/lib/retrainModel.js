// TIV Forecast — model retraining (spec v2.1: champion model + calendar normalization)
// Pure JS, no ML libraries. Runs client-side after every upload.
import {
  SEGMENTS, SEG_COL,
  PPP_START_IDX, PPP_END_IDX,
  HW_ALPHA, HW_BETA,
  YOY_CAP, SHARE_LOOKBACK_MONTHS,
  CHAMPION, THETA_ALPHA, WEEK_INTENSITY, HOLIDAYS,
} from '../constants'

const BACKTEST_MONTHS = 12
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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

// ── Holt linear trend — returns terminal state + full arrays ──────────
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

// ── Deseasonalize → Holt ─────────────────────────────────────────────
function trainHoltForSegment(rawData, seasonalIndices, monthsMeta) {
  const deseasonalized = rawData.map((v, i) => {
    const si = seasonalIndices[monthsMeta[i].month_num]
    return si > 0 ? v / si : v
  })
  const { level, trend, levelArr, trendArr } = holtLinear(deseasonalized)
  const fitted = rawData.map((v, t) => {
    if (t === 0) return Math.round(v)
    const si = seasonalIndices[monthsMeta[t].month_num] || 1
    return Math.max(0, Math.round((levelArr[t - 1] + trendArr[t - 1]) * si))
  })
  return { level, trend, fitted, deseasonalized }
}

// ── SMLY for forecast horizon months ─────────────────────────────────
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

// ── YoY growth: FY-to-date sum, capped ±15% ──────────────────────────
function computeYoYSum(data, monthsMeta) {
  const n = data.length
  if (n < 13) return 0
  const lastFYAprilIdx = (() => {
    for (let i = n - 1; i >= 0; i--) {
      if (monthsMeta[i].month_num === 4) return i
    }
    return -1
  })()
  if (lastFYAprilIdx === -1) return 0
  let fySum = 0, prevFYSum = 0
  for (let i = lastFYAprilIdx; i < n; i++) {
    fySum += data[i]
    const prevYearIdx = i - 12
    if (prevYearIdx >= 0) prevFYSum += data[prevYearIdx]
  }
  if (prevFYSum === 0) return 0
  return Math.max(-YOY_CAP, Math.min(YOY_CAP, fySum / prevFYSum - 1))
}

// ── YoY growth: median of all 12-month rolling ratios, capped ±15% ───
function computeYoYMedian(data, monthsMeta) {
  const n = data.length
  const ratios = []
  for (let i = 12; i < n; i++) {
    if (data[i - 12] > 0) ratios.push(data[i] / data[i - 12] - 1)
  }
  if (ratios.length === 0) return 0
  ratios.sort((a, b) => a - b)
  const mid = Math.floor(ratios.length / 2)
  const median = ratios.length % 2 !== 0
    ? ratios[mid]
    : (ratios[mid - 1] + ratios[mid]) / 2
  return Math.max(-YOY_CAP, Math.min(YOY_CAP, median))
}

// ── Theta method params (M4) ─────────────────────────────────────────
// Fit on deseasonalized series. Returns {slope, intercept, ses, n}.
// Forecast step: f0 = intercept + slope*(n+h-1);  f2 = ses
// Theta forecast (deseasonalized) = (f0 + f2) / 2
function computeThetaParams(deseasData) {
  const n = deseasData.length
  // OLS linear regression (x = 0..n-1)
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX  += i
    sumY  += deseasData[i]
    sumXY += i * deseasData[i]
    sumX2 += i * i
  }
  const xMean = sumX / n
  const yMean = sumY / n
  const denom = sumX2 - n * xMean * xMean
  const slope     = denom !== 0 ? (sumXY - n * xMean * yMean) / denom : 0
  const intercept = yMean - slope * xMean
  // SES (alpha = THETA_ALPHA)
  let ses = deseasData[0]
  for (let i = 1; i < n; i++) {
    ses = THETA_ALPHA * deseasData[i] + (1 - THETA_ALPHA) * ses
  }
  return { slope, intercept, ses, n }
}

// ── Calendar capacity score for Tipper (M3_CAL) ──────────────────────
// Returns a score ≈ 85–90 for a typical month (Mon–Sat working days,
// weighted by weekly booking intensity 10/20/30/40).
// Sundays and HOLIDAYS (from constants) are excluded.
function computeCapacityScore(year, month) {
  const nDays = new Date(year, month, 0).getDate()
  const daysPerWeek = { 1: 7, 2: 7, 3: 7, 4: nDays - 21 }
  let cap = 0
  for (let d = 1; d <= nDays; d++) {
    const wk = d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : 4
    const dt = new Date(year, month - 1, d)
    if (dt.getDay() === 0) continue  // Sunday — closed
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (HOLIDAYS.has(key)) continue  // Public holiday
    cap += WEEK_INTENSITY[wk] / daysPerWeek[wk]
  }
  return cap
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
  const hwParams        = {}
  const smly            = {}
  const yoySum          = {}
  const yoyMedian       = {}
  const thetaParams     = {}
  const segRawData      = {}  // for champion backtest

  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    let rawData = tiv.map(r => Number(r[col]) || 0)
    if (seg === 'Bus PVT') rawData = cleanBusPVT(rawData, monthsMeta)
    segRawData[seg] = rawData

    seasonalIndices[seg] = computeSeasonalIndices(rawData, monthsMeta)
    const hwResult = trainHoltForSegment(rawData, seasonalIndices[seg], monthsMeta)
    hwParams[seg]  = { level: hwResult.level, trend: hwResult.trend }
    smly[seg]      = computeSMLY(rawData, monthsMeta, lastIdx)
    yoySum[seg]    = computeYoYSum(rawData, monthsMeta)
    yoyMedian[seg] = computeYoYMedian(rawData, monthsMeta)
    thetaParams[seg] = computeThetaParams(hwResult.deseasonalized)
  }

  // ── Tipper calendar normalization (M3_CAL) ──────────────────────────
  // Step 1: compute capacity score for every historical month
  const historicalCapScores = {}
  for (const row of tiv) {
    historicalCapScores[row.month_label] = computeCapacityScore(row.year, row.month_num)
  }

  // Step 2: normalize Tipper history (units: TIV per 100 capacity points)
  const tipperRaw  = segRawData['Tipper']
  const tipperNorm = tipperRaw.map((v, i) => {
    const cap = historicalCapScores[tiv[i].month_label]
    return cap > 0 ? v / cap * 100 : v
  })

  // Step 3: fit HW + SI on normalized Tipper
  const tipperNormSI     = computeSeasonalIndices(tipperNorm, monthsMeta)
  const tipperNormHWRes  = trainHoltForSegment(tipperNorm, tipperNormSI, monthsMeta)
  const tipperNormHW     = { level: tipperNormHWRes.level, trend: tipperNormHWRes.trend }

  // Step 4: SMLY in normalized space
  const tipperNormSmly   = computeSMLY(tipperNorm, monthsMeta, lastIdx)

  // Step 5: capacity scores for forecast horizon months (for denormalization in engine)
  // Compute forecast month labels/dates from last data month
  const capScores = {}
  let fMonthIdx = monthsMeta[lastIdx].month_num - 1  // 0-based
  let fYear     = tiv[lastIdx].year
  for (let h = 1; h <= 3; h++) {
    fMonthIdx = (fMonthIdx + 1) % 12
    if (fMonthIdx === 0) fYear++
    const fLabel = `${MONTH_ABBR[fMonthIdx]}-${String(fYear).slice(-2)}`
    capScores[fLabel] = computeCapacityScore(fYear, fMonthIdx + 1)
  }

  // Market shares
  const alShareRecent  = computeRecentShares(al, tiv)
  const ptbShareRecent = computeRecentShares(ptb, al)

  // ── Champion backtest (last BACKTEST_MONTHS in-sample, champion dispatch) ──
  // Uses global model params — not strictly walk-forward but representative.
  // Each segment uses its champion method for fitted values.
  const dampedSum = (h) => { let s = 0; for (let i = 1; i <= h; i++) s += Math.pow(0.65, i); return s }

  const backtestStart = Math.max(12, n - BACKTEST_MONTHS)
  const modelBacktest = []
  for (let i = backtestStart; i < n; i++) {
    const record = { month_label: tiv[i].month_label }
    const m = monthsMeta[i].month_num

    for (const seg of SEGMENTS) {
      const col    = SEG_COL[seg]
      const raw    = segRawData[seg]
      const method = CHAMPION[seg]
      const smlyVal = i >= 12 ? raw[i - 12] : 0
      let fitted = 0

      if (method === 'M1') {
        fitted = Math.round(smlyVal * (1 + yoySum[seg]))
      } else if (method === 'M2') {
        fitted = Math.round(smlyVal * (1 + yoyMedian[seg]))
      } else if (method === 'M4') {
        const tp   = thetaParams[seg]
        const f0   = tp.intercept + tp.slope * i  // x=i in the regression (0-indexed)
        const f2   = tp.ses
        const tDes = (f0 + f2) / 2
        const si   = seasonalIndices[seg][m] || 1
        const smlyFc = Math.round(smlyVal * (1 + yoySum[seg]))
        fitted = Math.round(0.6 * smlyFc + 0.4 * tDes * si)
      } else if (method === 'M3_CAL') {
        // Tipper: work in normalized space, denormalize with historical cap score
        const normSmlyVal = i >= 12 ? tipperNorm[i - 12] : 0
        const smlyFcNorm  = normSmlyVal * (1 + yoySum['Tipper'])
        const si          = tipperNormSI[m] || 1
        const hwNorm      = (tipperNormHW.level + tipperNormHW.trend * dampedSum(1)) * si
        const blendedNorm = 0.6 * smlyFcNorm + 0.4 * hwNorm
        const cap         = historicalCapScores[tiv[i].month_label] || 87
        fitted = Math.round(blendedNorm * cap / 100)
      }

      record[col] = Math.max(0, fitted)
    }
    modelBacktest.push(record)
  }

  return {
    last_data_month:  tiv[lastIdx].month_label,
    total_months:     n,
    seasonal_indices: seasonalIndices,
    hw_params:        hwParams,
    smly,
    yoy_sum:          yoySum,
    yoy_median:       yoyMedian,
    // Keep yoy_capped for backward compat with any existing UI reading old rows
    yoy_capped:       yoySum,
    theta_params:     thetaParams,
    tipper_norm_hw:   tipperNormHW,
    tipper_norm_si:   tipperNormSI,
    tipper_norm_smly: tipperNormSmly,
    cap_scores:       capScores,
    champion:         CHAMPION,
    al_share_recent:  alShareRecent,
    ptb_share_recent: ptbShareRecent,
    model_backtest:   modelBacktest,
  }
}
