// Money for Service Payments. Integer paise, always — never a float.
//
// Why this file exists at all: JavaScript cannot represent 0.1 exactly, so
// `19.30 * 100` is 1929.9999999999998 and `Math.round` on a long chain of those
// eventually lands a rupee off. Every amount in this feature is a bigint of
// paise in the database and an integer here, and the ONLY conversion from a
// human/file representation goes through rupeeStringToPaise below, which reads
// the decimal digits as text and never asks the float unit for an opinion.
//
// The portal's older money (quotations, proforma invoices) is integer RUPEES.
// The two worlds must only ever meet through this module.

/** Largest amount we will accept from a file: ₹10 crore, in paise. */
export const MAX_PAISE = 100_00_00_000 * 100

/**
 * Parse a rupee amount into integer paise WITHOUT going through a float.
 *
 * Accepts: "1930", "1930.0", "1930.00", "9263.87", "1,930.50", " 1930 ",
 *          1930 (number), "₹1,930.00", "-50.25".
 * Rejects: "", null, "abc", "1.234" (more than two decimal places), Infinity.
 *
 * More than two decimals is a REFUSAL rather than a rounding, because a third
 * decimal in a money column means the column is not what we think it is.
 *
 * @param {string|number} input
 * @returns {number} integer paise
 */
export function rupeeStringToPaise(input) {
  if (input === null || input === undefined) throw new Error('amount is empty')

  // A JS number reaches us only from a spreadsheet cell. Route it through its
  // own decimal string so the same text path does the work.
  let s = typeof input === 'number'
    ? (Number.isFinite(input) ? String(input) : (() => { throw new Error(`amount is not finite: ${input}`) })())
    : String(input)

  s = s.trim().replace(/[₹\s]/g, '').replace(/,/g, '')
  if (s === '') throw new Error('amount is empty')

  let sign = 1
  if (s.startsWith('-')) { sign = -1; s = s.slice(1) }
  else if (s.startsWith('+')) { s = s.slice(1) }

  // Scientific notation appears when a spreadsheet stringifies a large number.
  // Refuse rather than guess: it has never appeared in a real export, and
  // silently mis-scaling money is the worst possible failure here.
  if (/e/i.test(s)) throw new Error(`amount is in scientific notation, refusing: ${input}`)
  if (!/^\d*(\.\d*)?$/.test(s) || s === '.' || s === '') {
    throw new Error(`amount is not a number: ${JSON.stringify(input)}`)
  }

  const [whole = '', frac = ''] = s.split('.')
  if (frac.length > 2) {
    throw new Error(`amount has more than 2 decimal places, refusing: ${JSON.stringify(input)}`)
  }

  const paise = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(paise)) throw new Error(`amount is out of range: ${input}`)
  return sign * paise
}

/** Integer paise -> "1930.00". No thousands separators; this is for files. */
export function paiseToRupeeString(paise) {
  assertPaise(paise)
  const neg = paise < 0
  const abs = Math.abs(paise)
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Integer paise -> "₹1,930" or "₹12,345.67", Indian digit grouping, for the
 * screen. Paise are shown only when there are some: ".00" eleven times on one
 * screen is noise, and a bill is said aloud as "nineteen thirty" (red team 4,
 * L5-18). `paise: true` always shows them.
 */
export function formatINR(paise, { symbol = true, paise: always = false } = {}) {
  assertPaise(paise)
  const neg = paise < 0
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')

  // Indian grouping: last three digits, then pairs. 1234567 -> 12,34,567
  const r = String(rupees)
  const head = r.length > 3 ? r.slice(0, -3) : ''
  const tail = r.length > 3 ? r.slice(-3) : r
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail

  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${grouped}${always || frac !== '00' ? `.${frac}` : ''}`
}

/** Throws unless `v` is a safe integer — the guard every RPC boundary uses. */
export function assertPaise(v, label = 'amount') {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new Error(`${label} must be an integer number of paise, got ${JSON.stringify(v)}`)
  }
  return v
}

/** Sum that refuses to silently produce a float. */
export function sumPaise(list) {
  return list.reduce((acc, v) => acc + assertPaise(v), 0)
}
