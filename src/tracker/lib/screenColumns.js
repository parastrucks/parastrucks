// Phase 10 — the three columns worked out on screen, never stored (they depend on today's date or
// on other rows). Formulas are the workbooks' own (docs/backlog/phase10-column-map.md). Pure.

const DAY_MS = 86400000
const days = (isoA, isoB) => Math.round((Date.parse(isoA) - Date.parse(isoB)) / DAY_MS)

// IT `AGEING`: IF(no al_payment_date, 0, IF(no ptb_invoice_date, TODAY − al_payment_date,
// ptb_invoice_date − al_payment_date))
export function ageingDays(row, todayIso) {
  if (!row.al_payment_date) return 0
  return days(row.ptb_invoice_date || todayIso, row.al_payment_date)
}

// IT `Interest`: ageing × total payment to AL × 10% / 365, and 0 when negative.
export function interestOnAgeing(row, todayIso) {
  const v = ageingDays(row, todayIso) * Number(row.total_payment_to_al || 0) * 0.10 / 365
  return v > 0 ? Math.round(v * 100) / 100 : 0
}

// RET-INT `DSE INCENTIVE`: a slab on how many trucks that DSE retailed in the month of
// date_of_retail — under 5 → 0, under 9 → 1,200, under 13 → 1,500, else 1,800.
export function slab(count) {
  if (count < 5) return 0
  if (count < 9) return 1200
  if (count < 13) return 1500
  return 1800
}

const dseKey = (row) => {
  const dse = (row.dse || '').trim().toUpperCase()
  const month = (row.date_of_retail || '').slice(0, 7)
  return dse && month ? `${dse}|${month}` : null
}

// Adds the screen columns to every row (rebilled rows are counted out of the incentive month).
export function withScreenColumns(rows, todayIso) {
  const counts = new Map()
  for (const r of rows) {
    if (r.superseded_at) continue
    const k = dseKey(r)
    if (k) counts.set(k, (counts.get(k) || 0) + 1)
  }
  return rows.map((r) => {
    const k = dseKey(r)
    return {
      ...r,
      ageing_days: ageingDays(r, todayIso),
      interest_on_ageing: interestOnAgeing(r, todayIso),
      dse_incentive: k && !r.superseded_at ? slab(counts.get(k)) : null,
    }
  })
}

// Today in India, as yyyy-mm-dd (the workbooks' TODAY() on a PC set to IST).
export function todayIst(now = new Date()) {
  return new Date(now.getTime() + 5.5 * 3600000).toISOString().slice(0, 10)
}
