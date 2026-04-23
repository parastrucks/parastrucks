// Indian-numbering amount-in-words for INR.
//
//   inrInWords(5757000)   → 'Rupees Fifty-Seven Lakh Fifty-Seven Thousand Only'
//   inrInWords(0)         → 'Rupees Zero Only'
//   inrInWords(1)         → 'Rupees One Only'
//   inrInWords(12345678)  → 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only'
//
// Integer rupees only (grand total is always integer in our flow). Negative numbers
// return 'Rupees Zero Only' (we never expect them; defensive).

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
]

// 0..99
function twoDigits(n) {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10)
  const o = n % 10
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`
}

// 0..999
function threeDigits(n) {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts = []
  if (h > 0) parts.push(`${ONES[h]} Hundred`)
  if (rest > 0) parts.push(twoDigits(rest))
  return parts.join(' ')
}

export function inrInWords(rupees) {
  const n = Math.trunc(Number(rupees) || 0)
  if (n <= 0) return 'Rupees Zero Only'

  // Indian grouping: crore (10^7) | lakh (10^5) | thousand (10^3) | hundreds (10^0)
  const crore    = Math.floor(n / 10000000)
  const lakh     = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const hundred  = n % 1000

  const parts = []
  if (crore > 0)    parts.push(`${twoDigits(crore)} Crore`)   // crore can exceed 99 but unrealistic here
  if (lakh > 0)     parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundred > 0)  parts.push(threeDigits(hundred))

  return `Rupees ${parts.join(' ')} Only`
}
