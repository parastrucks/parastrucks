// Phase 10 — cell looks: each column's own style (number format, the grey of a worked-out column,
// and the "paid" green rule on AL Payment Status), and what a person adds on top (a yellow "look at this", a red
// "this is wrong", bold…). Pure, tested offline by scripts/phase10/selftest-tracker-cells.mjs.
//
// What is SAVED for a cell (unit_cell_formats.format) is only the person's part: its style minus the
// column's style, and never the number format — that belongs to the column, so a "clear format" or a
// paste from Excel cannot leave a money cell showing 2200000. {} = nothing of the person's.

// Indian grouping (18,67,000), measured in Univer 2026-10-22. Formats allow two conditions only, so
// a figure of a crore or more shows as 150,00,000 — chosen over grouping negatives the Western way,
// since net refunds are routinely negative lakhs.
export const MONEY = '[<=-100000]-##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0'
// Shown and typed day first. Typing 05/07/25 into a cell with this format gives 5 July (measured).
export const DATE = 'dd/mm/yy'

const LOCKED = { rgb: '#F3F4F6' }

export const STYLES = {
  hdr: { bl: 1, bg: { rgb: '#E5E7EB' }, tb: 3 },
  money: { n: { pattern: MONEY } }, moneyL: { n: { pattern: MONEY }, bg: LOCKED },
  date: { n: { pattern: DATE } }, dateL: { n: { pattern: DATE }, bg: LOCKED },
  text: { n: { pattern: '@' } }, textL: { n: { pattern: '@' }, bg: LOCKED },
  num: {}, numL: { bg: LOCKED },
}

export function styleKey(col) {
  const kind = col.spec.type === 'date' ? 'date' : col.money ? 'money' : col.spec.type === 'text' ? 'text' : 'num'
  return col.editable ? kind : `${kind}L`
}
export const baseStyle = (col) => STYLES[styleKey(col)]

// JSON with sorted keys, so two styles compare equal whatever order Univer built them in
export function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  return `{${Object.keys(v).filter((k) => v[k] !== undefined && v[k] !== null).sort()
    .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
}

// The person's part of a cell's style: what differs from the column's, never the number format.
export function formatOf(col, style) {
  const base = baseStyle(col)
  const out = {}
  for (const [k, v] of Object.entries(style ?? {})) {
    if (k === 'n' || v === null || v === undefined) continue
    if (stable(v) === stable(base[k])) continue
    out[k] = v
  }
  return out
}

// The style a cell is drawn with: the column's, then the person's on top. A plain key when there is
// nothing of the person's (Univer shares one style object for the whole column).
export function styleWith(col, format) {
  if (!format || !Object.keys(format).length) return styleKey(col)
  return { ...baseStyle(col), ...format, ...(baseStyle(col).n ? { n: baseStyle(col).n } : {}) }
}

// Has the cell lost its column's number format (a "clear format", a paste)? Then it must be put back.
export function lostNumberFormat(col, style) {
  const want = baseStyle(col).n?.pattern
  return !!want && style?.n?.pattern !== want
}

// What a PASTE keeps of the source's look: only its fill. Excel brings its own font, size and
// borders on every pasted cell; those would be saved as the person's formatting on hundreds of cells.
export function pastedFormat(col, style) {
  const f = formatOf(col, style)
  return f.bg ? { bg: f.bg } : {}
}

export const sameFormat = (a, b) => stable(a ?? {}) === stable(b ?? {})

// ── AL Payment Status: green when the truck is PAID ─────────────────────────────────────────────
// Owner, 2026-10-23: green means paid to Ashok Leyland, i.e. "Cash Invoiced". "IBND" (invoiced but
// not delivered — AL delivers once it is paid) stays plain. A RULE, worked out as the grid draws, so
// it follows the value and is never saved per cell. Case and stray spaces are forgiven (Univer's
// own text "equal" is exact), hence a formula rule.
export const PAID_GREEN = '#C6EFCE' // Excel's "Good" fill, the workbooks' own colour
export const columnLetter = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }

// columns: the grid's columns in order; lastRow: the last sheet row the rule should cover (0-based)
export function paidRule(columns, lastRow) {
  const c = columns.findIndex((col) => col.key === 'al_payment_status')
  if (c < 0) return null
  return {
    cfId: 'al-paid', stopIfTrue: false,
    ranges: [{ startRow: 1, endRow: lastRow, startColumn: c, endColumn: c }],
    rule: {
      type: 'highlightCell', subType: 'formula',
      // relative to the range's first cell (row 2), as Excel writes it
      value: `=LOWER(TRIM(${columnLetter(c)}2))="cash invoiced"`,
      style: { bg: { rgb: PAID_GREEN } },
    },
  }
}
