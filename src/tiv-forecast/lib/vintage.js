// The PREVIOUS forecast vintage — what the model said before the last retrain.
//
// Useful because it answers a question the current numbers cannot: is this view
// steady, or does it swing every time a month of data arrives? A forecast that
// moves 40 units between retrains is telling you something the point estimate
// alone hides.
//
// Two decisions here are load-bearing:
//
// 1. The previous vintage is the newest row trained on a DIFFERENT last data
//    month — not simply the second row. Re-uploading the same workbook writes a
//    new params row with identical inputs, and comparing a model against itself
//    would draw a ghost line exactly on top of the current one and imply a
//    stability that was never tested.
//
// 2. It is replayed at the horizons it originally had. `runForecast` derives the
//    window from the current date, so replaying an older vintage today would
//    give it horizons 2, 3, 4 instead of the 1, 2, 3 it actually forecast at.
//    Horizon feeds the damped trend in the THETA method, so those are different
//    numbers — not what the model said at the time. Standing at the middle of
//    the month after its last data month reproduces its real output.
import { parseMonthLabel, addMonths } from './dataCadence'

// Mid-month, so shifting into IST cannot land the cursor in a neighbouring
// month and quietly change every horizon by one.
export function vintageAsOf(lastDataMonth) {
  const last = parseMonthLabel(lastDataMonth)
  if (!last) return null
  const next = addMonths(last, 1)
  return new Date(Date.UTC(next.year, next.month_num - 1, 15, 6, 0, 0))
}

// Can the CURRENT engine reproduce what this vintage said? Rows written before
// v3.0 carry no robust/plain anchors, so replaying one yields nothing at all —
// it would advertise a comparison line and then draw a blank.
function isReplayable(p) {
  return !!(Object.keys(p?.smly_robust || {}).length || Object.keys(p?.smly_plain || {}).length)
}

// history is newest-first, as fetchModelParamsHistory returns it.
//
// "Previous" means three things at once, and each was learned from a real row
// sitting in production:
//
//   - trained on a DIFFERENT last data month — a re-upload of the same workbook
//     writes a new params row with identical inputs (prod holds three for
//     Jul-26), and comparing a model against itself implies a stability that
//     was never tested;
//   - trained on an EARLIER one — prod also holds a row stamped 'Mar-27',
//     residue from the 2026-08-21 parser that read pre-typed future months as
//     data. It is newer by trained_at and differs by month, so a naive "first
//     row that differs" picks the corrupt one;
//   - replayable by this engine — anything from before v3.0 has no anchors.
export function previousVintage(history = [], currentParams = null) {
  if (!Array.isArray(history) || history.length === 0) return null
  const current = parseMonthLabel(currentParams?.last_data_month ?? history[0]?.last_data_month)
  if (!current) return null
  const cursorOf = m => m.year * 12 + (m.month_num - 1)
  const currentCursor = cursorOf(current)

  return history.find(p => {
    const m = parseMonthLabel(p?.last_data_month)
    return m && cursorOf(m) < currentCursor && isReplayable(p)
  }) || null
}
