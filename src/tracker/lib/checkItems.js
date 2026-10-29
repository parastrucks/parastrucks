// Phase 10 — Yes/No checks for the team (owner, 2026-10-30): where a check stands, how its value reads, and what a
// typed correction becomes. Pure, tested by scripts/phase10/selftest-tracker-cells.mjs.
import { COLUMN_BY_KEY } from './columnMeta.js'
import { showValue } from './showValue.js'
import { parseTypedDate, parseTypedNumber } from './cellValues.js'

// open — nobody has answered (or the owner sent it back) · waiting — a No for the owner to approve ·
// yes — answered Yes (needs no approval) · approved — a No the owner approved
export function stateOf(c) {
  if (!c.answer || c.review === 'sent_back') return 'open'
  if (c.answer === 'yes') return 'yes'
  return c.review === 'approved' ? 'approved' : 'waiting'
}

export function counts(checks) {
  const n = { open: 0, waiting: 0, yes: 0, approved: 0, all: checks.length }
  for (const c of checks) n[stateOf(c)]++
  return n
}

// a value as a person reads it: money with ₹ and lakh commas, dates dd/mm/yy, blank as "(blank)"
export function readValue(key, value) {
  const col = COLUMN_BY_KEY[key]
  const s = showValue(col, value)
  if (s === '') return '(blank)'
  return col?.money ? `₹${s}` : s
}

export const labelOf = (key) => COLUMN_BY_KEY[key]?.label ?? key

// The truck no longer holds the value the check showed (someone changed it in the tracker since).
export function changedSince(c) {
  const a = c.current_value == null ? '' : String(c.current_value)
  const b = c.shown_value == null ? '' : String(c.shown_value)
  if (a === b) return false
  const na = Number(a), nb = Number(b)
  return !(a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb)
}

// What was typed as the correct value → what the server takes, or { error } in words. '' → null (a No without a value).
export function parseCorrection(key, text) {
  const spec = COLUMN_BY_KEY[key]?.spec ?? { type: 'text' }
  const t = (text ?? '').trim()
  if (t === '') return { value: null }
  if (spec.type === 'date') {
    const iso = parseTypedDate(t)
    return iso ? { value: iso } : { error: 'Type the date as dd/mm/yyyy' }
  }
  if (spec.type === 'numeric' || spec.type === 'integer') {
    const n = parseTypedNumber(t.replace(/^₹/, ''))
    return n === null ? { error: 'Type a number (commas are fine)' } : { value: n }
  }
  return { value: t }
}
