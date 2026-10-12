// Split a SQL script into statements the way psql does: on ';' outside
// single quotes, double quotes, dollar-quoted bodies, and comments.
// Good enough for pg_dump output and these migrations; a DO $$ ... $$ block
// with nested $fn$ ... $fn$ tags is handled because tags are matched exactly.
export function splitSql(text) {
  const out = []
  let cur = ''
  let i = 0
  const n = text.length
  let dollarTag = null
  while (i < n) {
    const ch = text[i]
    const two = text.slice(i, i + 2)
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) { cur += dollarTag; i += dollarTag.length; dollarTag = null; continue }
      cur += ch; i++; continue
    }
    if (two === '--') { // line comment: keep it (harmless), skip to EOL
      const j = text.indexOf('\n', i); const end = j === -1 ? n : j
      cur += text.slice(i, end); i = end; continue
    }
    if (two === '/*') { const j = text.indexOf('*/', i + 2); const end = j === -1 ? n : j + 2; cur += text.slice(i, end); i = end; continue }
    if (ch === "'") { // single-quoted, '' escapes
      let j = i + 1
      while (j < n) { if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue } break } j++ }
      cur += text.slice(i, j + 1); i = j + 1; continue
    }
    if (ch === '"') { const j = text.indexOf('"', i + 1); const end = j === -1 ? n : j + 1; cur += text.slice(i, end); i = end; continue }
    if (ch === '$') { // dollar quote start?
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i, i + 64))
      if (m) { dollarTag = m[0]; cur += dollarTag; i += dollarTag.length; continue }
    }
    if (ch === '\\' && (cur.trim() === '')) { // psql meta-command line
      const j = text.indexOf('\n', i); const end = j === -1 ? n : j
      out.push(text.slice(i, end)); i = end + 1; cur = ''; continue
    }
    if (ch === ';') { const s = cur.trim(); if (!commentOnly(s)) out.push(s); cur = ''; i++; continue }
    cur += ch; i++
  }
  const last = cur.trim()
  if (!commentOnly(last)) out.push(last)
  return out.filter((s) => !commentOnly(s))
}

// Linear-time "nothing but -- comments and whitespace" test. The earlier
// /^(--[^\n]*\n?\s*)*$/ backtracked exponentially on a long comment header
// (both 20260825_tiv_upload_and_prune.sql and 20260830_payments_a1_schema.sql
// open with one) and looked exactly like a database hang.
function commentOnly(s) {
  return s.replace(/--[^\n]*/g, '').trim() === ''
}
