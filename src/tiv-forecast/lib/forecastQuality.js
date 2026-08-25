// TIV Forecast — how much to trust a number (audit findings C2, C3, C4)
//
// The forecast tab presented bare point estimates while the Accuracy tab, two
// clicks away, recorded per-segment errors of 13.8% to 33.5%. Everything needed
// to say so honestly is already on the client: model_params.model_backtest
// holds twelve months of forecast/actual pairs per segment.
//
// Nothing here changes a forecast. It only describes one.
import { SEGMENTS, SEG_COL, AL_TOLERANCE, V3_METHOD } from '../constants'

const METHOD_NAME = {
  ROB:   'robust anchor',
  THETA: 'blend of last year and trend',
  ADAPT: 'level-shift adapter',
}

// Absolute percentage errors for one segment across the backtest, using the
// actuals we hold. Returns [] when the two cannot be matched.
function segmentErrors(segment, backtest, actuals) {
  if (!Array.isArray(backtest) || !actuals?.length) return []
  const col = SEG_COL[segment]
  const actualByMonth = new Map(actuals.map(r => [r.month_label, r]))
  const out = []
  for (const row of backtest) {
    const actualRow = actualByMonth.get(row.month_label)
    if (!actualRow) continue
    const actual = Number(actualRow[col])
    const forecast = Number(row[col])
    if (!Number.isFinite(actual) || !Number.isFinite(forecast) || actual === 0) continue
    out.push(Math.abs(forecast - actual) / actual)
  }
  return out
}

// A plausible range for a point forecast, from how wrong this segment's
// forecasts have actually been — not from a distributional assumption.
//
// The band drops the single best and single worst month before taking the
// widest remaining error, so one freak month neither flatters the range nor
// blows it out. Stated in the UI, because a range whose derivation is a
// mystery is worse than no range at all.
export function forecastBand(segment, point, backtest, actuals) {
  if (point === null || point === undefined) return null
  const errors = segmentErrors(segment, backtest, actuals)
  if (errors.length < 4) return null
  const sorted = [...errors].sort((a, b) => a - b)
  const trimmed = sorted.slice(1, -1)
  const spread = trimmed[trimmed.length - 1]
  return {
    low:  Math.max(0, Math.round(point * (1 - spread))),
    high: Math.round(point * (1 + spread)),
    spread,
    months: errors.length,
  }
}

// How often this segment landed inside Ashok Leyland's tolerance. Numerate but
// non-technical readers metabolise "9 of the last 12 months" far better than
// "26.4% MAPE", and it is the same underlying data.
export function toleranceOdds(segment, backtest, actuals) {
  const errors = segmentErrors(segment, backtest, actuals)
  if (!errors.length) return null
  const within = errors.filter(e => e <= AL_TOLERANCE).length
  return { within, total: errors.length }
}

// Model vs judgment, as a scoreboard rather than two abstract percentages.
// "Model closer in 8 of 12 months, 214 units less error over the year" is the
// sentence a CEO can repeat; "26.4% vs 28.6%" is not.
export function scoreboard(modelLookup, judgmentLookup, columns) {
  const rows = []
  for (const col of columns) {
    let modelWins = 0, judgmentWins = 0, ties = 0
    let modelErrUnits = 0, judgmentErrUnits = 0, compared = 0
    for (const month of Object.keys(judgmentLookup)) {
      const j = judgmentLookup[month]?.[col]
      const m = modelLookup[month]?.[col]
      if (!j || !m) continue
      if (j.ae === null || m.ae === null || j.ae === undefined || m.ae === undefined) continue
      compared++
      if (m.ae < j.ae) modelWins++
      else if (j.ae < m.ae) judgmentWins++
      else ties++
      const actual = Number(m.aVal)
      if (Number.isFinite(actual)) {
        modelErrUnits    += Math.abs(actual * m.ae)
        judgmentErrUnits += Math.abs(actual * j.ae)
      }
    }
    if (!compared) continue
    rows.push({
      column: col,
      compared,
      modelWins,
      judgmentWins,
      ties,
      unitsSaved: Math.round(judgmentErrUnits - modelErrUnits),
    })
  }
  return rows
}

// The derivation of a single forecast cell, in the reader's language.
// Every input is already in model_params; this is a formatter, not a model.
export function explainForecast(segment, targetLabel, params) {
  if (!params) return null
  const method = (params.v3_method || V3_METHOD)[segment] || 'ROB'
  const plain  = params.smly_plain?.[targetLabel]?.[segment]
  const robust = params.smly_robust?.[targetLabel]?.[segment]
  if (plain === undefined && robust === undefined) return null

  const t12 = params.yoy_t12?.[segment] ?? 0
  const pct = v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  const steps = []

  if (method === 'ROB') {
    steps.push(`Anchor: the middle value of the same month last year and the months either side of it — ${Math.round(robust)} units.`)
    steps.push(`Growth: the last twelve months against the twelve before them — ${pct(t12)}, capped at ±15%.`)
    steps.push(`${Math.round(robust)} × ${(1 + t12).toFixed(3)} = ${Math.round(robust * (1 + t12))}`)
  } else if (method === 'ADAPT') {
    const g = params.adapt_params?.[segment]?.g ?? 0
    steps.push(`Anchor: the same month last year — ${Math.round(plain)} units.`)
    steps.push(`Level shift: recent months against the same months a year earlier, shrunk toward zero and capped at ±30% — ${pct(g)}.`)
    steps.push(`This segment uses the adapter because demand moved further than a ±15% cap can express.`)
    steps.push(`${Math.round(plain)} × ${(1 + g).toFixed(3)} = ${Math.round(plain * (1 + g))}`)
  } else if (method === 'THETA') {
    steps.push(`Anchor: the same month last year — ${Math.round(plain)} units — grown by ${pct(t12)} → ${Math.round(plain * (1 + t12))}.`)
    steps.push('Trend: a separate estimate from the whole history, adjusted for this month of the year.')
    steps.push('Result: 60% of the anchor figure plus 40% of the trend figure.')
  }

  return { method, methodName: METHOD_NAME[method] || method, steps }
}

export { SEGMENTS }
