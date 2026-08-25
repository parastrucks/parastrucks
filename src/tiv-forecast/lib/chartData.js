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

export function buildSegmentChartData(tivActuals, ptbActuals, segment, forecastResult, previousResult = null) {
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

  // What the previous vintage said about these same months. Keyed by month so
  // only the OVERLAP is drawn: an older model's window starts earlier, and its
  // months that are now history must not reappear as a forecast line running
  // back through the actuals.
  const prevByMonth = new Map()
  for (const fm of previousResult?.forecastMonths || []) {
    const row = previousResult.bySegment?.[segment]?.find(r => r.month === fm.label)
    // A stale month in the old vintage has no number. Plot nothing rather than
    // a zero, which is the whole reason this chart was rebuilt once already.
    if (row && row.tiv !== null && row.tiv !== undefined) prevByMonth.set(fm.label, row.tiv)
  }

  for (const fm of forecastResult.forecastMonths || []) {
    const segRow = forecastResult.bySegment?.[segment]?.find(r => r.month === fm.label)
    if (!segRow) continue
    const point = {
      month:      fm.label,
      TIV:        null,
      PTB:        null,
      'TIV Fcst': segRow.tiv,
      'PTB Fcst': segRow.ptb,
    }
    if (prevByMonth.has(fm.label)) point['TIV Prev'] = prevByMonth.get(fm.label)
    base.push(point)
  }
  return base
}

// True only when the previous vintage actually says something about a month the
// current forecast covers. Without this the chart would advertise a comparison
// line and then draw nothing.
export function hasVintageOverlap(chartData) {
  return (chartData || []).some(r => r['TIV Prev'] !== null && r['TIV Prev'] !== undefined)
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
