// supabase/functions/admin-vehicle-units/validate.ts
// Phase 10 — payload checks for the tracker's Edge Function. Pure (no Deno APIs), tested offline
// by scripts/phase10/selftest-vehicle-units.mjs.
//
// The database is the last line (tracker_apply_changes re-checks the column allowlist and every
// before-value, and its types abort a bad batch). These checks exist so a bad paste is refused
// CELL BY CELL with a reason the screen can show, instead of one bare Postgres error for all 500.

import {
  COLUMNS, INCENTIVE_COLUMNS, SCREEN_COLUMNS, ALWAYS_READ,
  checkValue, isEditable, isIncentive, isScreenColumn, isStoredColumn,
} from "./columns.ts"

export const MAX_CHANGES = 500
export const EDIT_SOURCES = ["typed", "paste", "fill", "undo", "redo", "delete", "revert"] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v)

export type Rejection = { unit_id: unknown; column: unknown; reason: string }
export type CleanChange = { unit_id: string; column: string; before: unknown; after: string | number | null }

// applyChanges: [{ unit_id, column, before, after }]
export function validateChanges(changes: unknown):
  { ok: true; clean: CleanChange[] } | { ok: false; error: string } | { ok: false; rejected: Rejection[] } {
  if (!Array.isArray(changes) || changes.length === 0) return { ok: false, error: "changes must be a non-empty list" }
  if (changes.length > MAX_CHANGES) return { ok: false, error: `too many changes in one save (${changes.length} > ${MAX_CHANGES})` }

  const rejected: Rejection[] = []
  const clean: CleanChange[] = []
  const seen = new Set<string>()
  for (const ch of changes) {
    if (!ch || typeof ch !== "object") { rejected.push({ unit_id: null, column: null, reason: "not a change" }); continue }
    const { unit_id, column, before, after } = ch as Record<string, unknown>
    if (!isUuid(unit_id)) { rejected.push({ unit_id, column, reason: "bad row id" }); continue }
    if (typeof column !== "string" || !isEditable(column)) {
      rejected.push({ unit_id, column, reason: isIncentive(String(column)) ? "incentives are not edited here" : "not an editable column" })
      continue
    }
    // Two changes to one cell in one save: the database checks every before-value BEFORE it
    // writes, so both would pass and the later one would silently win. The save adapter
    // collapses a command to before-vs-final (duty 3); this makes any slip a refusal.
    const key = `${unit_id.toLowerCase()}|${column}`
    if (seen.has(key)) { rejected.push({ unit_id, column, reason: "the same cell twice in one save" }); continue }
    seen.add(key)
    if (!("after" in (ch as object))) { rejected.push({ unit_id, column, reason: "no new value" }); continue }
    const c = checkValue(COLUMNS[column], after)
    if (!c.ok) { rejected.push({ unit_id, column, reason: c.reason }); continue }
    clean.push({ unit_id, column, before: before ?? null, after: c.value })
  }
  return rejected.length ? { ok: false, rejected } : { ok: true, clean }
}

// createUnit / supersedeUnit: { column: value, ... } — editable columns only.
export function validateValues(values: unknown, opts: { requireChassis: boolean }):
  { ok: true; clean: Record<string, string | number | null> } | { ok: false; rejected: Rejection[] } {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return { ok: false, rejected: [{ unit_id: null, column: null, reason: "values must be an object" }] }
  }
  const rejected: Rejection[] = []
  const clean: Record<string, string | number | null> = {}
  for (const [column, raw] of Object.entries(values as Record<string, unknown>)) {
    if (!isEditable(column)) { rejected.push({ unit_id: null, column, reason: "not an editable column" }); continue }
    // a blank in quick entry means "leave the default" — the table's defaults (qty 1, AL, 6%) apply
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) continue
    const c = checkValue(COLUMNS[column], raw)
    if (!c.ok) { rejected.push({ unit_id: null, column, reason: c.reason }); continue }
    clean[column] = c.value as string | number
  }
  if (opts.requireChassis && !clean.chassis_no && !rejected.some((r) => r.column === "chassis_no")) {
    rejected.push({ unit_id: null, column: "chassis_no", reason: "cannot be blank" })
  }
  return rejected.length ? { ok: false, rejected } : { ok: true, clean }
}

// list: which stored columns to read. Unknown names are an error (a typo in a layout must not
// silently show an empty column); screen-only names are fine and simply not read.
export function planRead(columns: unknown, seeIncentives: boolean):
  { ok: true; unitCols: string[]; incentiveCols: string[]; hidden: string[] } | { ok: false; error: string } {
  if (!Array.isArray(columns) || columns.length === 0) return { ok: false, error: "columns must be a non-empty list" }
  if (columns.length > 200) return { ok: false, error: "too many columns" }
  const unit = new Set<string>(ALWAYS_READ)
  const inc: string[] = []
  const hidden: string[] = []
  for (const k of columns) {
    if (typeof k !== "string") return { ok: false, error: "column names must be text" }
    if (isStoredColumn(k)) unit.add(k)
    else if (isIncentive(k)) (seeIncentives ? inc : hidden).push(k)
    else if (isScreenColumn(k)) { /* worked out on screen */ }
    else return { ok: false, error: `unknown column: ${k}` }
  }
  return { ok: true, unitCols: [...unit], incentiveCols: [...new Set(inc)], hidden: [...new Set(hidden)] }
}

// Saved layouts may name any column the screen knows, incentives included (they are simply
// hidden from those who may not see them).
export function validateLayoutColumns(columns: unknown): string | null {
  if (!Array.isArray(columns) || columns.length === 0) return "columns must be a non-empty list"
  if (columns.length > 200) return "too many columns"
  for (const k of columns) {
    if (typeof k !== "string") return "column names must be text"
    if (!isStoredColumn(k) && !isIncentive(k) && !isScreenColumn(k)) return `unknown column: ${k}`
  }
  return null
}

export const ALL_KNOWN_COLUMNS = [...Object.keys(COLUMNS), ...INCENTIVE_COLUMNS, ...SCREEN_COLUMNS]
export const isKnownColumn = (k: unknown) => typeof k === "string" && ALL_KNOWN_COLUMNS.includes(k)

export const MAX_FORMATS = 2000
export const MAX_FORMAT_BYTES = 2048

// setFormats: [{ unit_id, column_key, format }] — format is Univer's style object; {} clears it.
export function validateFormats(formats: unknown):
  { ok: true; clean: { unit_id: string; column_key: string; format: Record<string, unknown> }[] } | { ok: false; error: string } {
  if (!Array.isArray(formats) || formats.length === 0) return { ok: false, error: "formats must be a non-empty list" }
  if (formats.length > MAX_FORMATS) return { ok: false, error: `too many formats in one save (${formats.length} > ${MAX_FORMATS})` }
  const out: { unit_id: string; column_key: string; format: Record<string, unknown> }[] = []
  const seen = new Set<string>()
  for (const f of formats) {
    const { unit_id, column_key, format } = (f ?? {}) as Record<string, unknown>
    if (!isUuid(unit_id)) return { ok: false, error: "bad row id" }
    if (!isKnownColumn(column_key)) return { ok: false, error: `unknown column: ${String(column_key)}` }
    if (!format || typeof format !== "object" || Array.isArray(format)) return { ok: false, error: "format must be an object" }
    if (JSON.stringify(format).length > MAX_FORMAT_BYTES) return { ok: false, error: "format too large" }
    const key = `${unit_id.toLowerCase()}|${column_key}`
    if (seen.has(key)) return { ok: false, error: "the same cell twice in one save" }
    seen.add(key)
    out.push({ unit_id, column_key: column_key as string, format: format as Record<string, unknown> })
  }
  return { ok: true, clean: out }
}

// The request id is namespaced by the caller, so one person's id can never replay (or block)
// another person's save.
export function requestKey(callerId: string, clientRequestId: unknown): string | null {
  if (typeof clientRequestId !== "string") return null
  const t = clientRequestId.trim()
  if (t.length < 8 || t.length > 100) return null
  return `${callerId}:${t}`
}
