// Phase 10 — which financial year a truck belongs to (Apr–Mar). The grid holds one scope of the book
// (this year + every older truck still open, or one past year); the server's tracker_book uses the same
// date: the PTB invoice date, else the retail date, else the OEM gatepass date. Pure, tested by
// scripts/phase10/selftest-tracker-cells.mjs.

export const FIRST_YEAR = 2022 // the books start in Nov 2022 (owner, 2026-10-24)

export const fyLabel = (y) => `${y}-${String(y + 1).slice(2)}`

// → the April's year of its financial year, or null when the truck has no date yet
export function fyOfTruck(t) {
  const d = t.ptb_invoice_date || t.date_of_retail || t.oem_gatepass_date
  if (!d) return null
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7))
  return m >= 4 ? y : y - 1
}
