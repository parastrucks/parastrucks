// TIV Forecast — core forecast engine (migration spec Section 5.5-5.6 + Section 6)
import {
  SEGMENTS,
  HW_DAMPENING_PHI,
  BLEND_SMLY_WEIGHT,
  BLEND_HW_WEIGHT,
  AL_SHARE_MIN,
  AL_SHARE_MAX,
  PTB_SHARE_CAP,
  FORECAST_HORIZON_LENGTH,
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

    // Type 3: Sinusoidal annual cycle (AIS 153)
    // sin(2π × (monthNum − sineZeroMonth) / 12): +1 at peak, −1 at trough
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
// Given last data month label (e.g. "Mar-26"), compute the next 3 months
function computeForecastMonths(lastDataMonth) {
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = lastDataMonth?.match(/^([A-Za-z]{3})-(\d{2})$/)
  if (!m) return []
  let monthIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1])
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

// ── Main forecast engine ─────────────────────────────────────────────
// Returns { forecastMonths, bySegment: { [seg]: [{ month, tiv, al, ptb, ... }] } }
export function runForecast(modelParams, triggerState) {
  if (!modelParams) return null

  const { last_data_month, seasonal_indices, hw_params, smly, yoy_capped, al_share_recent, ptb_share_recent } = modelParams
  const forecastMonths = computeForecastMonths(last_data_month)

  // results[seg][h-1] = { month, month_num, tiv, al, ptb, alShare, ptbShare }
  const bySegment = {}

  for (const seg of SEGMENTS) {
    bySegment[seg] = []
    const si = seasonal_indices[seg] || {}
    const hw = hw_params[seg] || { level: 0, trend: 0 }
    const segSmly = smly[seg] || {}
    const yoy = yoy_capped[seg] || 0
    const alShare = Math.min(AL_SHARE_MAX, Math.max(AL_SHARE_MIN, al_share_recent[seg] || 0.5))
    const ptbShare = Math.min(PTB_SHARE_CAP, ptb_share_recent[seg] || 0.5)

    for (const fm of forecastMonths) {
      const m = fm.month_num
      const h = fm.horizon

      // Method 1: Dampened Holt-Winters
      const siVal = si[m] || 1.0
      const hwForecast = (hw.level + hw.trend * dampedTrendSum(h)) * siVal

      // Method 2: SMLY × (1 + capped YoY)
      const smlyBase = segSmly[m] || 0
      const smlyForecast = smlyBase * (1 + yoy)

      // Blended baseline
      const baseline = BLEND_SMLY_WEIGHT * smlyForecast + BLEND_HW_WEIGHT * hwForecast

      // Apply triggers
      const tivForecast = Math.max(0, Math.round(applyTriggers(baseline, seg, m, triggerState)))

      // Three-layer cascade
      const alForecast  = Math.round(tivForecast * alShare)
      const ptbForecast = Math.round(alForecast  * ptbShare)

      bySegment[seg].push({
        month:     fm.label,
        month_num: m,
        horizon:   h,
        tiv:       tivForecast,
        al:        alForecast,
        ptb:       ptbForecast,
        alShare,
        ptbShare,
        hwForecast:   Math.round(hwForecast),
        smlyForecast: Math.round(smlyForecast),
      })
    }
  }

  // Aggregate totals per forecast month
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
