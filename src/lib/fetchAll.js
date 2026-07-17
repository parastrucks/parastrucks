// Paginated reads for tables that have outgrown PostgREST's row cap.
//
// PostgREST caps every response at 1000 rows (Supabase's default max-rows) and
// gives NO signal when it truncates — it just returns 1000. Any `.select()`
// without a `.range()` over a table past that mark silently loses the tail.
//
// vehicle_catalog crossed it: 1006 rows on prod as of 2026-07-17, of which 897
// are active. So the admin catalog (reads all rows) was already truncating, and
// the quotation-path pages (read active rows) are one price circular away from
// it. When they cross, vehicles vanish from quotation search with no error —
// the salesperson simply cannot find the vehicle and has no idea why.
//
// Extracted from Catalog.jsx in Phase 9.7 (R2) so the three quotation-path
// pages can share it.

export const PAGE_SIZE = 1000

/**
 * Run a PostgREST query in pages until a short page proves the end.
 *
 * @param buildQuery - () => PostgrestFilterBuilder. A FACTORY, not a query:
 *   each page needs a fresh builder, because `.range()` mutates and a reused
 *   builder would re-request the same window forever.
 * @param pageSize - override only for testing the paging loop against small
 *   datasets (staging holds 906 rows, so it cannot exercise the real cap).
 * @returns every matching row, in the query's own order.
 * @throws the PostgREST error if ANY page fails. Deliberate: callers must not
 *   receive a silently-partial list. A visible failure beats a half-loaded
 *   catalog that looks complete — that is the exact bug this file exists to
 *   fix, and returning `out` on error would recreate it.
 *
 * IMPORTANT: the caller's query must impose a TOTAL order (append a unique
 * tiebreak such as .order('id')). Offset paging over a non-deterministic order
 * can repeat or skip rows across page boundaries.
 */
export async function fetchAllRows(buildQuery, { pageSize = PAGE_SIZE } = {}) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < pageSize) return out
  }
}
