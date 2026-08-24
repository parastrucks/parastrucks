// TIV Forecast — model retraining (spec v3.0: judgment-free, audited estimators)
// Pure JS, no ML libraries. Runs client-side after every upload.
//
// Pipeline (spec §4 "Retraining pipeline"):
//   1. PPP-clean Bus PVT (idx 20–28)
//   2. Seasonal indices, all six segments
//   3. Theta params — Haulage and MAV only
//   4. yoy_t12 per segment (trailing 12 vs prior 12, cap ±15%)
//   5. adapt_params.g — ICV Trucks only
//   6. smly_plain + smly_robust anchors for the next 3-month horizon
//   7. AL / PTB shares, recent 6 months
//   8. Regenerate model_backtest — walk-forward, PERIOD-MATCHED estimators only
//
// ⚠ Read spec §5.4a before touching any YoY code. The v2.x harness compared
// FY-to-date against a FULL prior fiscal year; that ratio is structurally ≪1
// early in a FY, so capped growth pinned at −15% in 56 of 72 backtest
// segment-months when the true value was +15%. Every YoY comparison here is
// period-matched by construction. Never reintroduce the FY-to-date form.
import {
  SEGMENTS, SEG_COL,
  PPP_START_IDX, PPP_END_IDX,
  YOY_CAP, SHARE_LOOKBACK_MONTHS,
  V3_METHOD, THETA_ALPHA, THETA_SEGMENTS,
  ADAPT_WINDOW, ADAPT_SHRINK, ADAPT_CAP,
  BLEND_SMLY_WEIGHT, BLEND_THETA_WEIGHT,
} from '../constants'

const BACKTEST_MONTHS = 12
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Small helpers ────────────────────────────────────────────────────
function median(vals) {
  const v = vals.filter(x => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b)
  if (v.length === 0) return 0
  const mid = Math.floor(v.length / 2)
  return v.length % 2 !== 0 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) }

// Label for `offset` months after the month at monthsMeta[baseIdx].
function labelAfter(year, monthNum, offset) {
  let mIdx = monthNum - 1 + offset
  let y = year + Math.floor(mIdx / 12)
  mIdx = ((mIdx % 12) + 12) % 12
  return `${MONTH_ABBR[mIdx]}-${String(y).slice(-2)}`
}

// ── PPP outlier cleaning (Bus PVT only) ──────────────────────────────
// Dec-23..Aug-24: a one-time 270-unit PPP bus order. Replace with same-calendar-
// month averages drawn from OUTSIDE the window before fitting anything.
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

// ── Seasonal indices (multiplicative, normalized to mean 1.0) ────────
// ±6 centered moving average → ratio-to-MA → average by calendar month → scale.
function computeSeasonalIndices(data, monthsMeta) {
  const n = data.length
  const windowSize = 12
  const centeredMA = new Array(n).fill(null)
  for (let i = 6; i < n - 6; i++) {
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
  const scaleFactor = siSum > 0 ? 12 / siSum : 1
  for (let m = 1; m <= 12; m++) si[m] *= scaleFactor
  return si
}

function deseasonalize(data, si, monthsMeta) {
  return data.map((v, i) => {
    const s = si[monthsMeta[i].month_num]
    return s > 0 ? v / s : v
  })
}

// ── Theta params (Haulage, MAV) ──────────────────────────────────────
// Classic Theta (Assimakopoulos & Nikolopoulos) on the deseasonalized series:
//   theta-0 line  = the OLS linear fit (long-run trend)
//   theta-2 line  = 2*Y - theta-0  (deviations from the line, doubled)
//   forecast(h)   = ( theta0(n+h-1) + SES(theta-2) ) / 2  x  SI[m]
//
// ⚠ `ses` is the SES of the **theta-2 line**, NOT of the deseasonalized series.
// The spec's prose ("linear fit + SES on deseasonalized series", section 5.5)
// compresses this and reads as if SES runs on Y directly. Implementing it that
// way puts Haulage and MAV ~11-19 units low and fails the section 5 parity gate;
// every other segment is unaffected because only THETA uses this. Verified
// against the real workbook -- see scripts/tiv/parity-gate.mjs.
function computeThetaParams(deseasData) {
  const n = deseasData.length
  if (n === 0) return { slope: 0, intercept: 0, ses: 0, n: 0 }
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

  // SES over the theta-2 line.
  let ses = 2 * deseasData[0] - intercept
  for (let i = 1; i < n; i++) {
    const y2 = 2 * deseasData[i] - (intercept + slope * i)
    ses = THETA_ALPHA * y2 + (1 - THETA_ALPHA) * ses
  }
  return { slope, intercept, ses, n }
}

// ── Trailing-12M YoY, capped ±15% (spec §5.4) ────────────────────────
// Period-matched by construction: 12 months against the immediately preceding
// 12 months. This REPLACES the v2.x FY-to-date estimator entirely (§5.4a).
function computeYoYT12(d) {
  const n = d.length
  if (n < 24) return 0
  const cur = d.slice(n - 12).reduce((a, b) => a + b, 0)
  const prv = d.slice(n - 24, n - 12).reduce((a, b) => a + b, 0)
  return prv > 0 ? clamp(cur / prv - 1, -YOY_CAP, YOY_CAP) : 0
}

// ── ADAPT level-shift adapter, ICV Trucks (spec §5.5) ────────────────
// g = clamp(shrink × mean_{k=1..6}( d[t−k] / d[t−12−k] ) − shrink, ±cap)
// with t = the forecast origin, so k=1..6 are the last six OBSERVED months
// matched against the same six months a year earlier.
function computeAdaptG(d) {
  const t = d.length                       // forecast origin (one past last index)
  const ratios = []
  for (let k = 1; k <= ADAPT_WINDOW; k++) {
    const cur = d[t - k]
    const prv = d[t - k - 12]
    if (cur !== undefined && prv !== undefined && prv > 0) ratios.push(cur / prv)
  }
  if (ratios.length === 0) return 0
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length
  return clamp(ADAPT_SHRINK * mean - ADAPT_SHRINK, -ADAPT_CAP, ADAPT_CAP)
}

// ── SMLY anchors ─────────────────────────────────────────────────────
// plain  = same calendar month, prior year
// robust = median(month−1, month, month+1) of the prior year
function smlyPlain(d, i)  { return d[i] ?? 0 }
function smlyRobust(d, i) { return median([d[i - 1], d[i], d[i + 1]].filter(v => v !== undefined)) }

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

// ── One baseline forecast from an already-fitted parameter set ───────
// Shared by the forward path and the walk-forward backtest so the two can
// never drift apart. `anchors` supplies the plain/robust SMLY for this target.
function baseFromParams(seg, monthNum, h, p) {
  const method = V3_METHOD[seg]
  if (method === 'ROB')   return p.robust * (1 + p.t12)
  if (method === 'ADAPT') return p.plain  * (1 + p.g)
  if (method === 'THETA') {
    const smly  = p.plain * (1 + p.t12)
    const tp    = p.theta
    if (!tp) return smly
    const theta = (tp.intercept + tp.slope * (tp.n + h - 1) + tp.ses) / 2 * (p.si[monthNum] || 1)
    return BLEND_SMLY_WEIGHT * smly + BLEND_THETA_WEIGHT * theta
  }
  return p.plain
}

// ── Main retrain ─────────────────────────────────────────────────────
export function retrainModel(tivActuals, ptbActuals, alActuals) {
  if (!tivActuals.length) throw new Error('No TIV data to retrain on')

  const tiv = [...tivActuals].sort((a, b) => a.month_index - b.month_index)
  const ptb = [...ptbActuals].sort((a, b) => a.month_index - b.month_index)
  const al  = [...alActuals ].sort((a, b) => a.month_index - b.month_index)

  const monthsMeta = tiv.map(r => ({ month_num: r.month_num, month_index: r.month_index }))
  const n = tiv.length
  const lastIdx = n - 1

  // Step 1–2: cleaned series + seasonal indices
  const segRawData      = {}
  const seasonalIndices = {}
  for (const seg of SEGMENTS) {
    const col = SEG_COL[seg]
    let rawData = tiv.map(r => Number(r[col]) || 0)
    if (seg === 'Bus PVT') rawData = cleanBusPVT(rawData, monthsMeta)
    segRawData[seg] = rawData
    seasonalIndices[seg] = computeSeasonalIndices(rawData, monthsMeta)
  }

  // Step 3–5: method-specific params
  const thetaParams = {}
  const yoyT12      = {}
  const adaptParams = {}
  for (const seg of SEGMENTS) {
    const d = segRawData[seg]
    yoyT12[seg] = computeYoYT12(d)
    if (THETA_SEGMENTS.includes(seg)) {
      thetaParams[seg] = computeThetaParams(deseasonalize(d, seasonalIndices[seg], monthsMeta))
    }
    if (V3_METHOD[seg] === 'ADAPT') {
      adaptParams[seg] = {
        g: computeAdaptG(d), window: ADAPT_WINDOW, shrink: ADAPT_SHRINK, cap: ADAPT_CAP,
      }
    }
  }

  // Step 6: anchors for the next 3-month horizon, keyed by target label
  const smlyPlainOut  = {}
  const smlyRobustOut = {}
  for (let h = 1; h <= 3; h++) {
    const label = labelAfter(tiv[lastIdx].year, monthsMeta[lastIdx].month_num, h)
    smlyPlainOut[label]  = {}
    smlyRobustOut[label] = {}
    const sameMonthLastYear = lastIdx + h - 12
    for (const seg of SEGMENTS) {
      const d = segRawData[seg]
      smlyPlainOut[label][seg]  = sameMonthLastYear >= 0 ? smlyPlain(d, sameMonthLastYear)  : 0
      smlyRobustOut[label][seg] = sameMonthLastYear >= 0 ? smlyRobust(d, sameMonthLastYear) : 0
    }
  }

  // Step 7: cascade shares
  // ⚠ AL/LM split is absent from the upload file for Apr-26 onward, so
  // al_share_recent is STALE as of the last month AL data exists (§9 open item).
  const alShareRecent  = computeRecentShares(al, tiv)
  const ptbShareRecent = computeRecentShares(ptb, al)

  // Step 8: walk-forward backtest — retrain on data STRICTLY PRIOR to each
  // target month, then forecast 1 step ahead. Period-matched estimators only.
  const backtestStart = Math.max(24, n - BACKTEST_MONTHS)
  const modelBacktest = []
  for (let i = backtestStart; i < n; i++) {
    const record = { month_label: tiv[i].month_label }
    const m = monthsMeta[i].month_num
    const trainMeta = monthsMeta.slice(0, i)

    for (const seg of SEGMENTS) {
      const full  = segRawData[seg]
      const train = full.slice(0, i)
      const si    = computeSeasonalIndices(train, trainMeta)
      const sameMonthLastYear = i - 12

      const p = {
        t12:    computeYoYT12(train),
        g:      V3_METHOD[seg] === 'ADAPT' ? computeAdaptG(train) : 0,
        theta:  THETA_SEGMENTS.includes(seg)
          ? computeThetaParams(deseasonalize(train, si, trainMeta))
          : null,
        si,
        plain:  sameMonthLastYear >= 0 ? smlyPlain(full, sameMonthLastYear)  : 0,
        robust: sameMonthLastYear >= 0 ? smlyRobust(full, sameMonthLastYear) : 0,
      }
      record[SEG_COL[seg]] = Math.max(0, Math.round(baseFromParams(seg, m, 1, p)))
    }
    modelBacktest.push(record)
  }

  return {
    last_data_month:  tiv[lastIdx].month_label,
    total_months:     n,
    seasonal_indices: seasonalIndices,
    yoy_t12:          yoyT12,
    smly_plain:       smlyPlainOut,
    smly_robust:      smlyRobustOut,
    theta_params:     thetaParams,
    adapt_params:     adaptParams,
    v3_method:        V3_METHOD,
    al_share_recent:  alShareRecent,
    ptb_share_recent: ptbShareRecent,
    model_backtest:   modelBacktest,
  }
}
