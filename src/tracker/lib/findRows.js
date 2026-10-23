// Phase 10 — "find a vehicle": the last digits off a gatepass, a chassis or an engine number, or part of a
// customer's name, and the row comes up. Pure, tested by scripts/phase10/selftest-tracker-cells.mjs.
//
// The grid's own Ctrl+F (Univer's find) searches every cell's text; this box finds TRUCKS: a number that
// ENDS with what was typed ranks first (people read the last digits off the paper), then one that contains
// it, then the other identifying columns. Case and spaces do not matter.

// the columns a person identifies a truck by, in the order a match counts
export const FIND_KEYS = ['chassis_no', 'engine_no', 'oem_gatepass_no', 'odn_no', 'vpart_no',
  'supplier_invoice_no', 'al_invoice_no', 'dealer_invoice_no', 'customer_name', 'sold_to_dealer', 'model']
export const MIN_FIND = 3

const norm = (v) => String(v ?? '').toUpperCase().replace(/\s+/g, '')

// rows: [{ id, …values }] → [{ id, key }] best first (key = the column that matched)
export function findRows(rows, query) {
  const q = norm(query)
  if (q.length < MIN_FIND) return []
  const hits = []
  for (const row of rows) {
    let best = null
    FIND_KEYS.forEach((key, k) => {
      const v = norm(row[key])
      if (!v) return
      // ends with it, on one of the three numbers on the paper → strongest
      const rank = v.endsWith(q) && k < 3 ? k : v.includes(q) ? 10 + k : null
      if (rank !== null && (best === null || rank < best.rank)) best = { rank, key }
    })
    if (best) hits.push({ id: row.id, key: best.key, rank: best.rank })
  }
  // stable: equal ranks keep the book's order
  return hits.map((h, i) => ({ ...h, i })).sort((a, b) => a.rank - b.rank || a.i - b.i).map(({ id, key }) => ({ id, key }))
}
