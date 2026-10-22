// Phase 10 — turning database values into grid cells and back. Pure (tested offline by
// scripts/phase10/selftest-tracker-cells.mjs).
//
// Save-adapter duty 2 lives here: what Univer hands back is whatever was typed or pasted, and a
// real Excel copy brings money as TEXT with the PC's grouping ("12,34,567"). This converts what it
// safely can and refuses the rest, naming the reason — it never guesses. The server then checks
// the result again with the same rules (checkValue from the Edge Function's columns.ts).
import { checkValue } from '../../../supabase/functions/admin-vehicle-units/columns.ts'

// Excel / Univer date serial: whole days since 1899-12-30.
const EPOCH_MS = Date.UTC(1899, 11, 30)
const DAY_MS = 86400000

export function isoToSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH_MS) / DAY_MS)
}

export function serialToIso(serial) {
  const d = new Date(EPOCH_MS + Math.floor(serial) * DAY_MS)
  return d.toISOString().slice(0, 10)
}

const pad = (n) => String(n).padStart(2, '0')

// A date typed or pasted as text. Day first, always (dd/mm/yy is how the team writes dates).
// yyyy-mm-dd is also accepted because it is unambiguous.
export function parseTypedDate(s) {
  const t = s.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return `${y}-${pad(m[2])}-${pad(m[1])}`
  }
  return null
}

// Money and counts: commas and spaces are grouping (lakh "12,34,567" or Western "1,234,567") and
// are removed. Nothing else is: a rupee sign, "5K", "1310*8" or a formula is refused.
export function parseTypedNumber(s) {
  const t = s.trim().replace(/[\s,]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}

// What a grid cell holds → what the database should store. Returns { ok, value } or { ok, reason }.
export function fromCell(spec, raw) {
  let v = raw
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    return checkValue(spec, null)
  }
  switch (spec.type) {
    case 'numeric':
    case 'integer':
      if (typeof v === 'string') {
        if (v.trim().startsWith('=')) return { ok: false, reason: 'formulas are not allowed in data cells' }
        const n = parseTypedNumber(v)
        if (n === null) return { ok: false, reason: 'not a number' }
        v = n
      }
      break
    case 'date':
      if (typeof v === 'number') v = serialToIso(v)
      else if (typeof v === 'string') {
        if (v.trim().startsWith('=')) return { ok: false, reason: 'formulas are not allowed in data cells' }
        const iso = parseTypedDate(v)
        if (iso === null) return { ok: false, reason: 'not a date (type it as dd/mm/yy)' }
        v = iso
      }
      break
    case 'text':
      if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE'
      break
  }
  return checkValue(spec, v)
}

// What the database holds → what the grid cell shows (dates become serials so the grid sorts and
// filters them as dates; the column's format shows them as dd/mm/yy).
export function toCell(spec, value) {
  if (value === null || value === undefined || value === '') return null
  if (spec.type === 'date') return typeof value === 'string' ? isoToSerial(value.slice(0, 10)) : null
  if (spec.type === 'numeric' || spec.type === 'integer') {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : null
  }
  return String(value)
}

// Same value, as far as the database is concerned? Undo can hand back "1" for 1 (measured), and
// numbers may differ only in trailing zeros ("1310.50" vs 1310.5).
export function sameValue(spec, a, b) {
  const blank = (x) => x === null || x === undefined || x === ''
  if (blank(a) || blank(b)) return blank(a) && blank(b)
  if (spec.type === 'numeric' || spec.type === 'integer') return Number(a) === Number(b)
  return String(a) === String(b)
}

// Save-adapter duty 3: one command can report the same cell several times (Univer's fill blanks
// each target first, then writes). Keep each cell's FIRST before and LAST after, in first-seen
// order, and drop cells that end where they started.
export function collapse(events, specOf) {
  const byKey = new Map()
  for (const e of events) {
    const k = `${e.unit_id}|${e.column}`
    const cur = byKey.get(k)
    if (cur) cur.after = e.after
    else byKey.set(k, { ...e })
  }
  return [...byKey.values()].filter((e) => !sameValue(specOf(e.column), e.before, e.after))
}
