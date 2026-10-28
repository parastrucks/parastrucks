// Phase 10 — the monthly AL Balance Sheet check: what each line of the review means, in the team's words.
// The checks themselves run in the database (tracker_al_review, migration 20261025_phase10_tracker_al_sheet.sql);
// selftest-al-sheet checks every check key the database can return has a line here. Ordered as the panel shows
// them: the sheet's own sums first, then truck lines, then what is missing.
export const AL_CHECKS = [
  ['net_not_tie', 'The Net Balance does not add up', 'Net Balance should be everything paid minus everything owed on that sheet.'],
  ['carry_chain', 'CARRY OVER is not last month’s Net Balance', 'The month starts from a different figure than the last one ended on.'],
  ['ctd_diff', 'CTD on the sheet differs from the tracker', 'One of the two is wrong — or AL changed the price.'],
  ['gst_before', 'CTD at 18% in the tracker, but invoiced before 22 Sep 2025', 'A truck PTB invoiced before the GST change should carry the 28% CTD.'],
  ['credit_not_split', 'Credit is not CTD × 0.999', 'Not the whole truck, 95%, 5% or another usual split.'],
  ['typed_credit', 'Credit typed in, not worked out', 'The other lines are CTD × 0.999; this one is a number.'],
  ['twice', 'The same truck twice in one month', 'Its truck line appears more than once on that sheet.'],
  ['mto_not_yes', 'A 95% line, but MTO Advance is not “Yes”', 'The 5% was paid as a make-to-order advance — mark the truck Yes.'],
  ['still_ibnd', 'The sheet says paid, the tracker still says IBND', 'AL Payment Status in the tracker may need updating.'],
  ['over_100', 'Truck credited more than 100%', 'Its lines over the months add up to more than the truck.'],
  ['under_100', 'Truck not fully credited yet', 'A split that has not been completed — it may come next month.'],
  ['not_on_sheet', 'AL took the truck, but it is on no sheet', 'The tracker says Cash Invoiced / IBND in an uploaded month; no sheet has its line.'],
  ['mto_count', 'More trucks marked MTO than advances paid', 'Trucks of this CBN say MTO Advance “Yes”, but the sheets show fewer advances.'],
  ['not_in_tracker', 'Chassis not in the tracker', 'The sheet has a chassis the tracker does not know (or it is mistyped).'],
  ['no_ctd', 'The tracker has no CTD for the truck', 'Fill the CTD in the tracker.'],
  ['no_chassis', 'A credit line with no chassis', 'And not an MTO advance.'],
  ['no_mode', 'A credit line with no Offtake Mode', 'The line’s kind cannot be told.'],
  ['spelling', 'Offtake Mode spelt differently', 'The same word as another line, written another way.'],
  ['unknown_mode', 'An Offtake Mode the portal does not know', 'Tell the portal team what this kind of line is.'],
].map(([key, title, hint]) => ({ key, title, hint }))
export const AL_CHECK_BY_KEY = Object.fromEntries(AL_CHECKS.map((c) => [c.key, c]))

// One financial year at a time (owner, 2026-10-28: 6,677 issues over 36 months is too many for one list).
// 'YYYY-MM' → the year its April starts (2026-03 → 2025). An issue with no month (MTO per CBN, counted over
// every sheet) belongs to no single year, so it shows in every one.
export const fyOfMonth = (mk) => (mk ? Number(mk.slice(0, 4)) - (Number(mk.slice(5, 7)) < 4 ? 1 : 0) : null)
export const inFy = (mk, fy) => fy === null || mk == null || fyOfMonth(mk) === fy
// the years that have an uploaded month or an issue, newest first
export function reviewYears(review) {
  const ys = new Set()
  for (const m of review?.months ?? []) ys.add(fyOfMonth(m.month))
  for (const i of review?.issues ?? []) if (i.month) ys.add(fyOfMonth(i.month))
  return [...ys].sort((a, b) => b - a)
}

// issues → [{ check, open: [...], settled: [...] }] in the panel's order; an unknown key goes last, by its name
export function groupIssues(issues) {
  const order = new Map(AL_CHECKS.map((c, i) => [c.key, i]))
  const groups = new Map()
  for (const i of issues ?? []) {
    const g = groups.get(i.check) ?? { check: AL_CHECK_BY_KEY[i.check] ?? { key: i.check, title: i.check, hint: '' }, open: [], settled: [] }
    ;(i.settled ? g.settled : g.open).push(i)
    groups.set(i.check, g)
  }
  return [...groups.values()].sort((a, b) => (order.get(a.check.key) ?? 99) - (order.get(b.check.key) ?? 99) || a.check.key.localeCompare(b.check.key))
}
