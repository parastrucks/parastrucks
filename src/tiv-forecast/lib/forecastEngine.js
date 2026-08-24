// TIV Forecast — core forecast engine (spec v3.0: ROB / THETA / ADAPT dispatch)
//
// The forecast is JUDGMENT-FREE. No judgment value enters any computation here.
// Judgment appears in the UI only as a comparison row on the forecast tab and a
// benchmark column in the Accuracy Tracker (spec §5.5, handoff §1).
import {
  SEGMENTS,
  AL_SHARE_MIN,
  AL_SHARE_MAX,
  PTB_SHARE_CAP,
  FORECAST_HORIZON_LENGTH,
  V3_METHOD,
  BLEND_SMLY_WEIGHT,
  BLEND_THETA_WEIGHT,
} from '../constants'
import { TRIGGER_DEFS } from './triggerDefs'
import { currentIstMonth } from './istMonth'

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
// Forecast starts at the later of (lastDataMonth + 1) and (currentMonth).
// When actuals lag (e.g. Apr-26 data still loaded mid-May-26), the first
// column shows the current month — a nowcast for the elapsed-so-far portion
// plus a forecast for the remainder. Product decision (2026-05-14): users
// prefer always seeing the current month in the grid over the strict
// "pure forecast only" rule the original 2026-04-23 hotfix enforced.
// Horizon math is preserved — skipped months still increment horizon so the
// damped-trend equation stays consistent.
function computeForecastMonths(lastDataMonth, now) {
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const m = lastDataMonth?.match(/^([A-Za-z]{3})-(\d{2})$/)
  if (!m) return []

  // Start cursor at lastDataMonth + 1, horizon = 1
  let monthIdx = MONTH_ABBR.indexOf(m[1])
  let year = parseInt(m[2]) + 2000
  monthIdx = (monthIdx + 1) % 12
  if (monthIdx === 0) year++
  let horizon = 1
  let cursor = year * 12 + monthIdx

  // Current real month, in IST — the dealership's calendar, not the viewer's
  // laptop. A machine an hour either side of the boundary otherwise shifts the
  // whole grid and changes the horizon that feeds the Theta term.
  const ist = currentIstMonth(now)
  const currentMonthIdx = ist.month_num - 1
  const currentMonthCursor = ist.year * 12 + currentMonthIdx

  // Skip ahead until we're at or past the current month — preserving true
  // horizon so damped-trend math stays valid for skipped months.
  while (cursor < currentMonthCursor) {
    monthIdx = (monthIdx + 1) % 12
    if (monthIdx === 0) year++
    cursor = year * 12 + monthIdx
    horizon++
  }

  const result = []
  for (let i = 0; i < FORECAST_HORIZON_LENGTH; i++) {
    result.push({
      label:     `${MONTH_ABBR[monthIdx]}-${String(year).slice(2)}`,
      month_num: monthIdx + 1,
      horizon,
    })
    monthIdx = (monthIdx + 1) % 12
    if (monthIdx === 0) year++
    horizon++
  }
  return result
}

// ── v3.0 baseline forecast dispatcher (spec §5.5) ────────────────────
//   ROB   robust-anchor SMLY × (1 + trailing-12M YoY)   Bus PVT, Tractor, Tipper
//   THETA 0.6·plain SMLY·(1+t12) + 0.4·Theta(h)·SI[m]   Haulage, MAV
//   ADAPT plain SMLY × (1 + g)                          ICV Trucks
//
// Anchors are keyed by TARGET LABEL (e.g. "Aug-26"), not month number — the
// robust anchor spans three prior-year months, so a bare month number can no
// longer identify it. `v3_method` is read from the params row when present so a
// stored map and the code constant cannot silently diverge.
function baseForecast(segment, monthNum, horizon, targetLabel, params) {
  const method = (params.v3_method || V3_METHOD)[segment] || 'ROB'

  // Anchors exist only for the three months after last_data_month. Once the
  // calendar rolls past them without a new upload, the forecast window outruns
  // its anchors — and `?? 0` used to turn that into a bold, confident ZERO for
  // ROB segments and a plausible number ~60% low for THETA. Missing anchor is
  // not a value of zero; it is an absence, and it has to stay one all the way
  // to the screen.
  const plainAnchor  = params.smly_plain?.[targetLabel]?.[segment]
  const robustAnchor = params.smly_robust?.[targetLabel]?.[segment]
  if (plainAnchor === undefined && robustAnchor === undefined) return null

  const plain  = plainAnchor  ?? 0
  const robust = robustAnchor ?? 0
  const t12    = params.yoy_t12?.[segment] ?? 0

  if (method === 'ROB') return robust * (1 + t12)

  if (method === 'ADAPT') {
    const g = params.adapt_params?.[segment]?.g ?? 0
    return plain * (1 + g)
  }

  if (method === 'THETA') {
    const smly = plain * (1 + t12)
    const tp   = params.theta_params?.[segment]
    if (!tp) return smly
    const si    = (params.seasonal_indices?.[segment] || {})[monthNum] || 1
    const theta = (tp.intercept + tp.slope * (tp.n + horizon - 1) + tp.ses) / 2 * si
    return BLEND_SMLY_WEIGHT * smly + BLEND_THETA_WEIGHT * theta
  }

  return plain
}

// ── Main forecast engine ─────────────────────────────────────────────
export function runForecast(modelParams, triggerState, now = new Date()) {
  if (!modelParams) return null

  const forecastMonths = computeForecastMonths(modelParams.last_data_month, now)
  const bySegment = {}

  // Months the trained model has no anchor for. Reported so the page can say
  // "the model is stale" instead of quietly showing dashes that look like a
  // data-entry gap.
  const staleMonths = forecastMonths
    .filter(fm => !modelParams.smly_plain?.[fm.label] && !modelParams.smly_robust?.[fm.label])
    .map(fm => fm.label)

  for (const seg of SEGMENTS) {
    bySegment[seg] = []
    const alShare  = Math.min(AL_SHARE_MAX, Math.max(AL_SHARE_MIN, modelParams.al_share_recent[seg] || 0.5))
    const ptbShare = Math.min(PTB_SHARE_CAP, modelParams.ptb_share_recent[seg] || 0.5)

    for (const fm of forecastMonths) {
      const baseline = baseForecast(seg, fm.month_num, fm.horizon, fm.label, modelParams)

      // No anchor -> no forecast. Carry the absence through the whole cascade;
      // Math.round(null * share) would silently resurrect it as 0.
      if (baseline === null) {
        bySegment[seg].push({
          month: fm.label, month_num: fm.month_num, horizon: fm.horizon,
          tiv: null, al: null, ptb: null, alShare, ptbShare, stale: true,
        })
        continue
      }

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
    let tiv = 0, al = 0, ptb = 0, stale = false
    for (const seg of SEGMENTS) {
      const cell = bySegment[seg][idx]
      if (cell.tiv === null) { stale = true; continue }
      tiv += cell.tiv
      al  += cell.al
      ptb += cell.ptb
    }
    // A total built from only some of its segments is worse than no total.
    return stale
      ? { month: fm.label, tiv: null, al: null, ptb: null, stale: true }
      : { month: fm.label, tiv, al, ptb }
  })

  return { forecastMonths, bySegment, totals, staleMonths }
}
