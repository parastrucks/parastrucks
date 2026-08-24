// The dealership, its data and its fiscal calendar are all in India, so "the
// current month" must be an IST fact — not whatever month the viewer's laptop
// happens to think it is. A machine an hour either side of the month boundary
// (or with a wrong clock) otherwise shifts the entire forecast grid.
//
// Asia/Kolkata is UTC+5:30 year-round with no DST, so a fixed shift is exact
// and needs no timezone database.
const IST_OFFSET_MINUTES = 5 * 60 + 30

// `now` is injectable so tests can stand at a chosen instant.
export function currentIstMonth(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60000)
  return { year: ist.getUTCFullYear(), month_num: ist.getUTCMonth() + 1 }
}

// Months since year 0 — a monotonic cursor safe to compare and subtract,
// unlike a month LABEL, which sorts alphabetically ('May-26' > 'Jul-26').
export function monthCursor(year, monthNum) {
  return year * 12 + (monthNum - 1)
}
