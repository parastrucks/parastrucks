// A small RFC 4180 CSV reader.
//
// `line.split(',')` is wrong for these files: the Google Pay export has a free
// text Notes column that customers type into, and a comma in a note would shift
// every column after it — quietly, and only on some rows.

/**
 * @param {string} text
 * @returns {string[][]} rows of raw cell strings, blank lines dropped
 */
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '')  // strip a UTF-8 BOM
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\r') {
      // swallow; \n does the work (handles CRLF and lone CR-free files alike)
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  if (inQuotes) throw new Error('CSV ended inside a quoted field — the file is truncated or corrupt')

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/**
 * Map rows onto a header, BY NAME.
 *
 * Column ORDER in these exports is not a promise — the SAP layouts are edited
 * from a shared login, and the UPI providers reorder columns between releases.
 * Missing REQUIRED columns are a hard failure, because importing a file whose
 * shape we do not recognise is how wrong money gets in.
 *
 * @param {string[][]} rows      output of parseCSV, header first
 * @param {string[]} required    column names that must be present
 * @returns {{header: string[], records: Array<Record<string,string>>}}
 */
export function toRecords(rows, required = []) {
  if (!rows.length) throw new Error('file is empty')
  const header = rows[0].map((h) => h.trim())
  const missing = required.filter((r) => !header.includes(r))
  if (missing.length) {
    throw new Error(
      `file is missing required column(s): ${missing.join(', ')}. ` +
      `Found: ${header.join(', ')}`
    )
  }
  const records = rows.slice(1).map((r) => {
    const o = {}
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim() })
    return o
  })
  return { header, records }
}
