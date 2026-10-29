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

// createUnits: [{ column: value, ... }] — new rows typed or pasted below the book. Each row is
// judged on its own: one bad row is reported by position and the others still go to the database
// (tracker_create_units gives each its own savepoint). The same checks run again on a retry, so a
// replayed request sends the database the same rows in the same order.
export const MAX_NEW_ROWS = 200
export function validateNewRows(rows: unknown):
  { ok: true; rows: ({ ok: true; clean: Record<string, string | number | null> } | { ok: false; rejected: Rejection[] })[] }
  | { ok: false; error: string } {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "rows must be a non-empty list" }
  if (rows.length > MAX_NEW_ROWS) return { ok: false, error: `too many new rows in one save (${rows.length} > ${MAX_NEW_ROWS})` }
  return { ok: true, rows: rows.map((values) => validateValues(values, { requireChassis: true })) }
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

// alUpload: one month of the AL Balance Sheet as the browser read it (src/tracker/lib/alSheet.js).
// The database stores the lines and runs the checks; this only makes sure what reaches it is plain data.
export const MAX_AL_LINES = 2000
const AL_TEXT = ["details", "cbn", "chassis_no", "engine_no", "offtake_mode"] as const
const AL_MONEY = ["debit", "credit", "ctd"] as const
const AL_FIELDS = new Set<string>(["row_no", "line_date", "credit_is_formula", ...AL_TEXT, ...AL_MONEY])
export type AlLine = Record<string, string | number | boolean | null>
export function validateAlUpload(p: Record<string, unknown>):
  { ok: true; month: string; file_name: string; sha256: string; replace: boolean; lines: AlLine[] } | { ok: false; error: string } {
  const month = p.month
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) return { ok: false, error: "month must be YYYY-MM-01" }
  const file_name = typeof p.file_name === "string" ? p.file_name.trim() : ""
  if (!file_name || file_name.length > 200) return { ok: false, error: "file name required (at most 200 characters)" }
  const sha256 = typeof p.sha256 === "string" ? p.sha256.toLowerCase() : ""
  if (!/^[0-9a-f]{64}$/.test(sha256)) return { ok: false, error: "sha256 required" }
  if (!Array.isArray(p.lines) || p.lines.length === 0) return { ok: false, error: "lines must be a non-empty list" }
  if (p.lines.length > MAX_AL_LINES) return { ok: false, error: `at most ${MAX_AL_LINES} lines in one month` }
  const lines: AlLine[] = []
  const rows = new Set<number>()
  for (const raw of p.lines) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "each line must be an object" }
    const l = raw as Record<string, unknown>
    const extra = Object.keys(l).find((k) => !AL_FIELDS.has(k))
    if (extra) return { ok: false, error: `unknown field: ${extra}` }
    const row_no = l.row_no
    if (!Number.isInteger(row_no) || (row_no as number) < 1 || (row_no as number) > 100000) return { ok: false, error: "row_no must be a sheet row number" }
    if (rows.has(row_no as number)) return { ok: false, error: `row ${row_no} twice` }
    rows.add(row_no as number)
    const out: AlLine = { row_no: row_no as number }
    if (l.line_date != null) {
      if (typeof l.line_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(l.line_date) || Number.isNaN(Date.parse(l.line_date))) return { ok: false, error: `row ${row_no}: bad date` }
      out.line_date = l.line_date
    } else out.line_date = null
    for (const k of AL_TEXT) {
      const v = l[k]
      if (v != null && (typeof v !== "string" || v.length > 300)) return { ok: false, error: `row ${row_no}: ${k} must be text (at most 300 characters)` }
      out[k] = v == null || (v as string).trim() === "" ? null : (v as string).trim()
    }
    for (const k of AL_MONEY) {
      const v = l[k]
      if (v != null && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) >= 1e12)) return { ok: false, error: `row ${row_no}: ${k} must be an amount` }
      out[k] = v == null ? null : Math.round((v as number) * 100) / 100
    }
    if (l.credit_is_formula != null && typeof l.credit_is_formula !== "boolean") return { ok: false, error: `row ${row_no}: credit_is_formula must be true or false` }
    out.credit_is_formula = (l.credit_is_formula as boolean | undefined) ?? null
    lines.push(out)
  }
  return { ok: true, month, file_name, sha256, replace: p.replace === true, lines }
}

// alSettle: "this line is right" — check key and subject as the review gave them, and the person's reason.
export function validateAlSettle(p: Record<string, unknown>):
  { ok: true; check: string; subject: string; reason: string } | { ok: false; error: string } {
  const check = p.check, subject = typeof p.subject === "string" ? p.subject.trim() : ""
  const reason = typeof p.reason === "string" ? p.reason.trim() : ""
  if (typeof check !== "string" || !/^[a-z_0-9]{2,40}$/.test(check)) return { ok: false, error: "check required" }
  if (!subject || subject.length > 200) return { ok: false, error: "subject required" }
  if (!reason) return { ok: false, error: "Say why it is right — a reason is needed" }
  if (reason.length > 500) return { ok: false, error: "reason: at most 500 characters" }
  return { ok: true, check, subject, reason }
}

// checkAnswer: Yes / No on one check (migration 20261030_phase10_tracker_checks.sql). column = the check's own
// column (read from the row, never from the payload); a No may carry the correct value, checked as a typed cell is.
export function validateCheckAnswer(p: Record<string, unknown>, column: string):
  { ok: true; answer: "yes" | "no"; correct: string | number | null; note: string | null } | { ok: false; error: string } {
  const answer = p.answer
  if (answer !== "yes" && answer !== "no") return { ok: false, error: "answer must be yes or no" }
  const note = typeof p.note === "string" && p.note.trim() ? p.note.trim() : null
  if (note && note.length > 500) return { ok: false, error: "note: at most 500 characters" }
  const raw = p.correct
  if (answer === "yes" || raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: true, answer, correct: null, note }
  }
  if (!isEditable(column)) return { ok: false, error: "this column cannot be corrected here" }
  const c = checkValue(COLUMNS[column], raw)
  if (!c.ok) return { ok: false, error: `The correct value ${c.reason}` }
  return { ok: true, answer, correct: c.value as string | number | null, note }
}

// checkReview: the owner approves a No (its value is written into the truck) or sends it back.
export function validateCheckReview(p: Record<string, unknown>):
  { ok: true; id: string; decision: "approve" | "send_back"; note: string | null } | { ok: false; error: string } {
  if (!isUuid(p.id)) return { ok: false, error: "check id required" }
  if (p.decision !== "approve" && p.decision !== "send_back") return { ok: false, error: "decision must be approve or send_back" }
  const note = typeof p.note === "string" && p.note.trim() ? p.note.trim() : null
  if (note && note.length > 500) return { ok: false, error: "note: at most 500 characters" }
  return { ok: true, id: p.id, decision: p.decision, note }
}

// The request id is namespaced by the caller, so one person's id can never replay (or block)
// another person's save.
export function requestKey(callerId: string, clientRequestId: unknown): string | null {
  if (typeof clientRequestId !== "string") return null
  const t = clientRequestId.trim()
  if (t.length < 8 || t.length > 100) return null
  return `${callerId}:${t}`
}
