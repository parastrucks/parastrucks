// Dates for Service Payments. Everything the business means by "a day" is
// Asia/Kolkata, and none of these functions consult the machine's timezone —
// the parsers must produce identical output on a laptop in Ahmedabad, a Vercel
// build box in UTC, and a Deno isolate wherever Supabase puts it.

/** India Standard Time. No DST, ever, which is the only reason this is simple. */
export const IST_OFFSET_MINUTES = 330
const IST_SUFFIX = '+05:30'

/**
 * "2026-08-01 11:34:21" (which both UPI exports emit, in local IST, with no
 * zone marker) -> a real instant.
 *
 * Reading these with `new Date(str)` would interpret them in the RUNNER's zone,
 * so the same file would import different instants depending on where it was
 * imported. Appending the offset explicitly is the whole point.
 *
 * @param {string} s
 * @returns {string} ISO 8601 instant, e.g. "2026-08-01T06:04:21.000Z"
 */
export function istLocalToInstant(s) {
  const m = String(s ?? '').trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) throw new Error(`not a recognised date-time: ${JSON.stringify(s)}`)
  const [, y, mo, d, h, mi, sec = '00'] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${sec}${IST_SUFFIX}`
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) throw new Error(`invalid date-time: ${JSON.stringify(s)}`)
  return t.toISOString()
}

/**
 * An Excel date serial -> "YYYY-MM-DD".
 *
 * SAP's Billing Report gives date-only serials (46237 = 2026-08-01). Letting
 * SheetJS build a JS Date instead would produce a midnight LOCAL timestamp,
 * which on any machine west of Greenwich silently becomes the previous day.
 * Arithmetic in UTC and formatting the UTC calendar fields avoids that
 * entirely.
 *
 * Excel's epoch is 1899-12-30 because of its deliberate 1900 leap-year bug.
 *
 * @param {number} serial
 * @returns {string} "YYYY-MM-DD"
 */
export function excelSerialToISODate(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) {
    throw new Error(`not an Excel date serial: ${JSON.stringify(serial)}`)
  }

  // Serials 1..60 are a trap, not merely old. Excel believes 1900 was a leap
  // year (serial 60 displays as 1900-02-29, a day that never existed), so in
  // that range the epoch offset used below disagrees with what the spreadsheet
  // shows by one day. Refuse rather than quietly return a date the user's own
  // file contradicts.
  if (serial < 61) {
    throw new Error(
      `Excel date serial ${serial} falls in the 1900 leap-year-bug range (1-60), ` +
      `where Excel's calendar and the real calendar disagree. Refusing to guess.`
    )
  }

  // Anything before 2000 in a billing report is corrupt, not historic.
  if (serial < 36526) {
    throw new Error(`implausible billing date: Excel serial ${serial} is before 2000-01-01`)
  }
  if (serial > 73415) {
    throw new Error(`implausible billing date: Excel serial ${serial} is after 2100`)
  }
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/**
 * The IST calendar date of an instant — the "which day's money is this"
 * question, asked correctly.
 * @param {string|Date} instant
 * @returns {string} "YYYY-MM-DD"
 */
export function istDateOf(instant) {
  const t = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(t.getTime())) throw new Error(`invalid instant: ${instant}`)
  const shifted = new Date(t.getTime() + IST_OFFSET_MINUTES * 60000)
  const p = (n) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`
}

/**
 * The Indian financial year a date falls in, named by its starting year.
 * 2026-08-01 -> 2026 (FY 2026-27); 2026-03-31 -> 2025.
 * Used for receipt serial numbering.
 */
export function financialYearOf(isoDate) {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})/)
  if (!m) throw new Error(`not a date: ${isoDate}`)
  const year = Number(m[1]), month = Number(m[2])
  return month >= 4 ? year : year - 1
}
