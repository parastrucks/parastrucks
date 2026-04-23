// GSTIN parsing + GST tax split helpers — pure, no React / no DB.
//
// GSTIN format (15 chars): [SS][PPPPPPPPPP][E][Z][C]
//   SS          — 2-digit state code (01–38, see IN_STATE_CODES)
//   PPPPPPPPPP  — embedded PAN of the entity (chars 3–12, 0-indexed 2..12)
//   E           — entity code per PAN (1 char)
//   Z           — literal 'Z' in most cases
//   C           — checksum char

export const IN_STATE_CODES = {
  '01': { code: '01', name: 'Jammu and Kashmir' },
  '02': { code: '02', name: 'Himachal Pradesh' },
  '03': { code: '03', name: 'Punjab' },
  '04': { code: '04', name: 'Chandigarh' },
  '05': { code: '05', name: 'Uttarakhand' },
  '06': { code: '06', name: 'Haryana' },
  '07': { code: '07', name: 'Delhi' },
  '08': { code: '08', name: 'Rajasthan' },
  '09': { code: '09', name: 'Uttar Pradesh' },
  '10': { code: '10', name: 'Bihar' },
  '11': { code: '11', name: 'Sikkim' },
  '12': { code: '12', name: 'Arunachal Pradesh' },
  '13': { code: '13', name: 'Nagaland' },
  '14': { code: '14', name: 'Manipur' },
  '15': { code: '15', name: 'Mizoram' },
  '16': { code: '16', name: 'Tripura' },
  '17': { code: '17', name: 'Meghalaya' },
  '18': { code: '18', name: 'Assam' },
  '19': { code: '19', name: 'West Bengal' },
  '20': { code: '20', name: 'Jharkhand' },
  '21': { code: '21', name: 'Odisha' },
  '22': { code: '22', name: 'Chhattisgarh' },
  '23': { code: '23', name: 'Madhya Pradesh' },
  '24': { code: '24', name: 'Gujarat' },
  '25': { code: '25', name: 'Daman and Diu' },
  '26': { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  '27': { code: '27', name: 'Maharashtra' },
  '28': { code: '28', name: 'Andhra Pradesh (Old)' },
  '29': { code: '29', name: 'Karnataka' },
  '30': { code: '30', name: 'Goa' },
  '31': { code: '31', name: 'Lakshadweep' },
  '32': { code: '32', name: 'Kerala' },
  '33': { code: '33', name: 'Tamil Nadu' },
  '34': { code: '34', name: 'Puducherry' },
  '35': { code: '35', name: 'Andaman and Nicobar Islands' },
  '36': { code: '36', name: 'Telangana' },
  '37': { code: '37', name: 'Andhra Pradesh' },
  '38': { code: '38', name: 'Ladakh' },
}

function clean(gstin) {
  return typeof gstin === 'string' ? gstin.trim().toUpperCase() : ''
}

export function panFromGstin(gstin) {
  const g = clean(gstin)
  return g.length === 15 ? g.slice(2, 12) : null
}

export function stateCodeFromGstin(gstin) {
  const g = clean(gstin)
  if (g.length < 2) return null
  const code = g.slice(0, 2)
  return IN_STATE_CODES[code] ? code : null
}

export function stateNameFromCode(code) {
  if (!code) return null
  return IN_STATE_CODES[code]?.name ?? null
}

/**
 * Decide intra-state (CGST+SGST) vs inter-state (IGST).
 *
 * Rules:
 *   - Both seller & buyer GSTINs present: compare first 2 digits. Match → intra, differ → inter.
 *   - Buyer GSTIN missing/invalid: use `fallback` (we pass 'intra' — assume same-state walk-in).
 *   - Seller GSTIN missing/invalid: fall back too (defensive; shouldn't happen in practice).
 */
export function deriveTaxType({ sellerGstin, buyerGstin, fallback = 'intra' }) {
  const sellerCode = stateCodeFromGstin(sellerGstin)
  const buyerCode  = stateCodeFromGstin(buyerGstin)
  if (!sellerCode || !buyerCode) return fallback
  return sellerCode === buyerCode ? 'intra' : 'inter'
}

/**
 * Split GST amount on a taxable value.
 *
 * Rounding: each component rounded independently with Math.round — matches GSTN practice
 * and avoids off-by-one when taxable is odd (e.g. taxable=4830508 @ 18% → cgst=sgst=434746 each,
 * summing with taxable back to 5700000 exactly).
 *
 * @param {number} taxableAmount  integer rupees (ex-GST value)
 * @param {number} gstRate        combined rate percent (e.g. 18)
 * @param {'intra'|'inter'} taxType
 * @returns {{cgst:number, sgst:number, igst:number}}
 */
export function splitGst(taxableAmount, gstRate, taxType) {
  const t = Number(taxableAmount) || 0
  const r = Number(gstRate) || 0
  if (taxType === 'inter') {
    return { cgst: 0, sgst: 0, igst: Math.round(t * r / 100) }
  }
  // intra — half on each head
  const half = Math.round(t * r / 200)
  return { cgst: half, sgst: half, igst: 0 }
}
