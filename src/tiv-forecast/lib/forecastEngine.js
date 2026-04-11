// TIV Forecast — core forecast engine (spec v2.1: champion dispatch)
import {
  SEGMENTS,
  HW_DAMPENING_PHI,
  AL_SHARE_MIN,
  AL_SHARE_MAX,
  PTB_SHARE_CAP,
  FORECAST_HORIZON_LENGTH,
  CHAMPION,
} from '../constants'
import { TRIGGER_DEFS } from './triggerDefs'

// ── Damped trend sum: Σ φ^i for i=1..h ──────────────────────────────
function dampedTrendSum(h) {
  let s = 0
  for (let i = 1; i <= h; i++) s += Math.pow(HW_DAMPENING_PHI, i)
  return s
}

// ── Apply all active triggers to a baseline forecast ─────────────────
function applyTriggers(base, segment, monthNum, triggerState) {
  let f = base
  for (const def of TRIGGER_DEFS) {
    const t = triggerState[def.id]
    if (!t || !t.on) continue
    const sev = Number(t.severity) || 0
    if (sev === 0) continue

    // Type 1: Custom monthEffect (FY Push)
    if (def.type === 'custom' && def.monthEffect) {
      const effect = def.monthEffect[monthNum]
      if (effect !== undefined && def.affected.includes(segment)) {
        f *= (1 + effect * sev / 100)
      }
      continue
    }

    // Type 2: Segment-specific custom effect (Navratri)
    if (def.type === 'segcustom' && def.segEffect) {
      if (def.months?.includes(monthNum) && def.segEffect[segment] !== undefined) {
        f *= (1 + def.segEffect[segment] * sev / 100)
      }
      continue
    }

    // Type 3: Sinusoidal annual cycle (kept for potential future triggers)
    if (def.type === 'sine') {
      if ((!def.months || def.months.includes(monthNum)) && def.affected.includes(segment)) {
        const sineVal = Math.sin(2 * Math.PI * (monthNum - (def.sineZeroMonth ?? 3)) / 12)
        f *= (1 + sineVal * sev / 100)
      }
      continue
    }

    // Type 4: Standard dampen / boost / both
    if (!def.affected.includes(segment)) continue
    if (def.months && !def.months.includes(monthNum)) continue
    const fac = sev / 100
    if (def.type === 'dampen') f *= (1 - fac)
    else if (def.type === 'boost') f *= (1 + fac)
    else if (def.type === 'both') {
      const dir = t.direction === 'boost' ? 1 : -1
      f *= (1 + dir * fac)
    }
  }
  return f
}

// ── Compute forecast month metadata ─────────────────────────────────
function computeForecastMonths(lastDataMonth) {
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = lastDataMonth?.match(/^([A-Za-z]{3})-(\d{2})$/)
  if (!m) return []
  let monthIdx = MONTH_ABBR.indexOf(m[1])
  let year = parseInt(m[2]) + 2000
  const result = []
  for (let h = 1; h <= FORECAST_HORIZON_LENGTH; h++) {
    monthIdx = (monthIdx + 1) % 12
    if (monthIdx === 0) year++
    result.push({
      label:     `${MONTH_ABBR[monthIdx]}-${String(year).slice(2)}`,
      month_num: monthIdx + 1,
      horizon:   h,
    })
  }
  return result
}

// ── Champion baseline forecast dispatcher ────────────────────────────
// Dispatches to the per-segment method that minimised MAPE in backtest.
// Falls back gracefully if v2.1 params not yet present (old DB rows).
function baseForecast(segment, monthNum, horizon, targetLabel, params) {
  const method  = (params.champion || CHAMPION)[segment] || 'M1'
  const smlyMap = params.smly[segment] || {}
  const smlyVal = smlyMap[monthNum] || 0

  if (method === 'M1') {
    const yoy = params.yoy_sum?.[segment] ?? params.yoy_capped?.[segment] ?? 0
    return smlyVal * (1 + yoy)
  }

  if (method === 'M2') {
    const yoy = params.yoy_median?.[segment] ?? params.yoy_capped?.[segment] ?? 0
    return smlyVal * (1 + yoy)
  }

  if (method === 'M4') {
    // 60% SMLY-sum + 40% Theta (linear extrapolation + SES blend in deseasonalized space)
    const yoy    = params.yoy_sum?.[segment] ?? params.yoy_capped?.[segment] ?? 0
    const smlyFc = smlyVal * (1 + yoy)
    const tp     = params.theta_params?.[segment]
    if (!tp) return smlyFc
    const f0          = tp.intercept + tp.slope * (tp.n + horizon - 1)
    const thetaDeseas = (f0 + tp.ses) / 2
    const si          = (params.seasonal_indices[segment] || {})[monthNum] || 1
    return 0.6 * smlyFc + 0.4 * thetaDeseas * si
  }

  if (method === 'M3_CAL') {
    // Tipper: HW+SMLY in capacity-normalized space, then × (cap/100) to denormalize
    const yoy        = params.yoy_sum?.['Tipper'] ?? params.yoy_capped?.['Tipper'] ?? 0
    const normSmly   = (params.tipper_norm_smly || {})[monthNum] || 0
    const normHW     = params.tipper_norm_hw
    if (!normHW) return smlyVal  // fallback: old DB row without cal-norm data
    const si         = (params.tipper_norm_si || {})[monthNum] || 1
    const hwNorm     = (normHW.level + normHW.trend * dampedTrendSum(horizon)) * si
    const blendedNorm = 0.6 * (normSmly * (1 + yoy)) + 0.4 * hwNorm
    const cap        = (params.cap_scores || {})[targetLabel] || 87
    return blendedNorm * cap / 100
  }

  // Default fallback: M1
  const yoy = params.yoy_sum?.[segment] ?? params.yoy_capped?.[segment] ?? 0
  return smlyVal * (1 + yoy)
}

// ── Main forecast engine ─────────────────────────────────────────────
export function runForecast(modelParams, triggerState) {
  if (!modelParams) return null

  const forecastMonths = computeForecastMonths(modelParams.last_data_month)
  const bySegment = {}

  for (const seg of SEGMENTS) {
    bySegment[seg] = []
    const alShare  = Math.min(AL_SHARE_MAX, Math.max(AL_SHARE_MIN, modelParams.al_share_recent[seg] || 0.5))
    const ptbShare = Math.min(PTB_SHARE_CAP, modelParams.ptb_share_recent[seg] || 0.5)

    for (const fm of forecastMonths) {
      const baseline    = baseForecast(seg, fm.month_num, fm.horizon, fm.label, modelParams)
      const tivForecast = Math.max(0, Math.round(applyTriggers(baseline, seg, fm.month_num, triggerState)))
      const alForecast  = Math.round(tivForecast * alShare)
      const ptbForecast = Math.round(alForecast  * ptbShare)

      bySegment[seg].push({
        month:     fm.label,
        month_num: fm.month_num,
        horizon:   fm.horizon,
        tiv:       tivForecast,
        al:        alForecast,
        ptb:       ptbForecast,
        alShare,
        ptbShare,
      })
    }
  }

  const totals = forecastMonths.map((fm, idx) => {
    let tiv = 0, al = 0, ptb = 0
    for (const seg of SEGMENTS) {
      tiv += bySegment[seg][idx].tiv
      al  += bySegment[seg][idx].al
      ptb += bySegment[seg][idx].ptb
    }
    return { month: fm.label, tiv, al, ptb }
  })

  return { forecastMonths, bySegment, totals }
}
