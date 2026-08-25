// TIV Forecast — chart series construction
//
// Extracted from SegmentAnalysisTab so it can be tested against real data
// rather than reimplemented in a test, which is how a reimplementation quietly
// disagrees with the thing it is meant to be checking.
import { SEG_COL } from '../constants'

// A real zero and a missing month are different facts and must plot
// differently. `|| 0` fabricated a zero for a missing TIV month; `|| null`
// erased genuine zeros from PTB -- and the dealership really did sell nothing
// in six of the 2022 ramp-up months, so the chart drew a straight interpolated
// line over the truth.
export const num = v => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function buildHistoricalSeries(tivActuals, ptbActuals, segment) {
  if (!tivActuals?.length) return []
  const col = SEG_COL[segment]
  const ptbByMonth = new Map((ptbActuals || []).map(p => [p.month_label, p]))
  return tivActuals.map(row => ({
    month: row.month_label,
    TIV:   num(row[col]),
    PTB:   num(ptbByMonth.get(row.month_label)?.[col]),
  }))
}

export function buildSegmentChartData(tivActuals, ptbActuals, segment, forecastResult) {
  const historical = buildHistoricalSeries(tivActuals, ptbActuals, segment)
  if (!forecastResult) return historical

  const base = [...historical]

  // The forecast series carried no point at the last actual month, so the two
  // lines never met: solid history, a one-month hole, then a detached dashed
  // stub. Giving the forecast a starting value equal to the last actual makes
  // the handover continuous.
  //
  // Only when the forecast genuinely begins the month AFTER the data
  // (horizon 1). If the model is stale and the window has run ahead, the gap is
  // real, and bridging it would draw a line through months nobody forecast.
  if (base.length && forecastResult.forecastMonths?.[0]?.horizon === 1) {
    const handover = { ...base[base.length - 1] }
    handover['TIV Fcst'] = handover.TIV
    handover['PTB Fcst'] = handover.PTB
    base[base.length - 1] = handover
  }

  for (const fm of forecastResult.forecastMonths || []) {
    const segRow = forecastResult.bySegment?.[segment]?.find(r => r.month === fm.label)
    if (!segRow) continue
    base.push({
      month:      fm.label,
      TIV:        null,
      PTB:        null,
      'TIV Fcst': segRow.tiv,
      'PTB Fcst': segRow.ptb,
    })
  }
  return base
}

// AL share of industry volume, month by month. A month with no AL row has no
// known share -- reading it as 0 plotted a point that said "AL sold nothing"
// rather than "not reported".
export function buildShareSeries(tivActuals, alActuals, segment) {
  if (!tivActuals?.length || !alActuals?.length) return []
  const col = SEG_COL[segment]
  const alByMonth = new Map(alActuals.map(a => [a.month_label, a]))
  return tivActuals
    .map(tRow => {
      const aRow = alByMonth.get(tRow.month_label)
      const tiv = num(tRow[col])
      const al = aRow ? num(aRow[col]) : null
      return {
        month: tRow.month_label,
        'AL Share': tiv > 0 && al !== null ? parseFloat((al / tiv * 100).toFixed(1)) : null,
      }
    })
    .filter(r => r['AL Share'] !== null)
}
