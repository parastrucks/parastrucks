// When the next month's market data is expected, and whether it is late.
//
// The owner receives the previous month's market data on the **5th to 7th of
// the following month** (stated 2026-08-25). The trained model carries anchors
// for exactly three months past its last data month, so on the 1st of every
// month the forecast window outruns those anchors and the furthest column loses
// its basis — then regains it a few days later when the workbook is uploaded.
//
// That gap is the NORMAL RHYTHM, not a fault. Reporting it as "Model out of
// date" would raise a red alarm twelve times a year for something that resolves
// itself on schedule, and an alarm that is usually wrong stops being read at
// all. So the page distinguishes:
//
//   current  — the model covers the whole window, or the data is not due yet
//   due      — inside the expected arrival window; say what is awaited, calmly
//   overdue  — past the grace day and still missing; now it is worth an alarm
//
import { currentIstMonth, monthCursor } from './istMonth'

export const DATA_ARRIVES_FROM = 5   // day of month the data usually appears
export const DATA_ARRIVES_BY   = 7   // ...and by when it usually has
export const OVERDUE_AFTER_DAY = 10  // grace past that before sounding alarmed

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function parseMonthLabel(label) {
  const m = String(label ?? '').match(/^([A-Za-z]{3})-(\d{2})$/)
  if (!m) return null
  const idx = MONTH_ABBR.findIndex(a => a.toLowerCase() === m[1].toLowerCase())
  if (idx < 0) return null
  return { year: 2000 + parseInt(m[2], 10), month_num: idx + 1 }
}

export function formatMonthLabel({ year, month_num }) {
  return `${MONTH_ABBR[month_num - 1]}-${String(year % 100).padStart(2, '0')}`
}

export function addMonths({ year, month_num }, n) {
  const cursor = year * 12 + (month_num - 1) + n
  return { year: Math.floor(cursor / 12), month_num: (cursor % 12) + 1 }
}

// The full picture, from the model's last data month and the current instant.
// `now` is injectable so tests can stand at a chosen day.
export function dataCadence(lastDataMonth, now = new Date()) {
  const last = parseMonthLabel(lastDataMonth)
  if (!last) return null

  const awaited = addMonths(last, 1)          // the month whose actuals come next
  const arrives = addMonths(last, 2)          // ...during this month, on the 5th-7th

  const ist = currentIstMonth(now)
  const nowCursor     = monthCursor(ist.year, ist.month_num)
  const arriveCursor  = monthCursor(arrives.year, arrives.month_num)

  let status
  if (nowCursor < arriveCursor) status = 'current'                       // cannot be here yet
  else if (nowCursor > arriveCursor) status = 'overdue'                  // a whole month has passed
  else if (ist.day < DATA_ARRIVES_FROM) status = 'current'               // early in the arrival month
  else if (ist.day <= OVERDUE_AFTER_DAY) status = 'due'                  // inside the window (+grace)
  else status = 'overdue'

  return {
    status,
    awaitedMonth: formatMonthLabel(awaited),
    arrivesInMonth: formatMonthLabel(arrives),
    dueFrom: DATA_ARRIVES_FROM,
    dueBy: DATA_ARRIVES_BY,
  }
}

// What the trained model can actually forecast, as a plain "Aug-26 → Oct-26".
// Derived from the anchors themselves rather than assumed to be three months,
// so it stays true if the horizon ever changes.
export function coverageWindow(modelParams) {
  const labels = Object.keys(modelParams?.smly_robust ?? modelParams?.smly_plain ?? {})
  const parsed = labels.map(l => ({ l, p: parseMonthLabel(l) })).filter(x => x.p)
  if (!parsed.length) return null
  parsed.sort((a, b) => monthCursor(a.p.year, a.p.month_num) - monthCursor(b.p.year, b.p.month_num))
  const first = parsed[0].l
  const last  = parsed[parsed.length - 1].l
  return { first, last, text: first === last ? first : `${first} → ${last}` }
}
