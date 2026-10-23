// Phase 10 — a value as a person reads it, outside the grid: in Copy for mail and in a row's history.
// The grid shows money in lakhs and dates as dd/mm/yy (its own number formats); the same words have to
// appear when the table leaves the grid. Pure, tested by scripts/phase10/selftest-tracker-cells.mjs.
import { serialToIso } from './cellValues.js'

const lakh = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, useGrouping: false })

// '2025-07-05' → '05/07/25'
export const isoToDmy = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`

// col: a column of the grid (columnMeta); value: as the grid holds it (a date is a serial number) or as the
// database / the history holds it (a date is '2025-07-05', a number may be the text '1310.50').
export function showValue(col, value) {
  if (value === null || value === undefined || value === '') return ''
  const type = col?.spec?.type
  if (type === 'date') {
    if (typeof value === 'number') return isoToDmy(serialToIso(value))
    if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return isoToDmy(String(value))
    return String(value)
  }
  if (type === 'numeric' || type === 'integer') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
    if (!Number.isFinite(n)) return String(value)
    // lakh grouping as on screen (a crore shows properly here: 1,50,00,000)
    return col.money ? lakh.format(n) : plain.format(n)
  }
  return String(value)
}
