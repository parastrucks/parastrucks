// Phase 10 — an INVENTORY of a pile of files from the team's PCs (owner, 2026-10-25: "a lot of files, but no
// sorted or organized folders"). Read-only: nothing is moved, renamed or changed.
//
//   node scripts/phase10/import/inventory.cjs <source folder> <output folder outside the repo>
//
// Every file is fingerprinted (SHA-256 → exact duplicates under any name). Every workbook is recognised by
// what is INSIDE it — its sheets' header rows — with the importer's own family rules (read.cjs FAMILIES), plus
// the AL Balance Sheet; its financial year is read from the folder / name AND from the dates inside. Two copies
// of one book (same family, mostly the same chassis) are paired, the fuller / newer named. The output folder
// gets inventory.csv (one line per file) and summary.txt; the console shows COUNTS only — file names and kinds,
// never an amount or a chassis. The output holds file names only, but is refused inside the repository anyway.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const XLSX = require('xlsx')
const { FAMILIES, H } = require('./read.cjs')

const [src, out] = process.argv.slice(2)
if (!src || !out) { console.error('usage: inventory.cjs <source folder> <output folder outside the repo>'); process.exit(2) }
const repo = path.resolve(__dirname, '../../..')
if (path.resolve(out).toLowerCase().startsWith(repo.toLowerCase())) { console.error('refused: put the output outside the repository'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })

const SHEETS = /\.(xlsx|xlsm|xlsb|xls|csv)$/i
const KIND_BY_EXT = [[/\.pdf$/i, 'PDF'], [/\.(jpe?g|png|gif|bmp|tiff?|heic|webp)$/i, 'image'], [/\.(docx?|rtf|odt|txt)$/i, 'document'],
  [/\.(zip|rar|7z)$/i, 'archive'], [/\.(eml|msg)$/i, 'email'], [/\.(pptx?)$/i, 'slides']]
const FAMILY_NAME = {
  IT: 'Invoice tracker (purchase book)', IT_OD: 'Invoice tracker — other dealer', FY: 'Sales book (payment tracker)',
  LIST: 'Sales list (PTB retail)', LIST_OD: 'Sales list — other dealer', DEALERS: 'Dealers sheet', REBILL: 'Rebill list',
  RET_INT: 'Retention — internal', RET_AL: 'Retention — AL / DBM', AL_SHEET: 'AL Balance Sheet',
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const fyOfDate = (d) => (d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1)
const fyLabel = (y) => `${y}-${String(y + 1).slice(2)}`

// the year and month a file's NAME / FOLDER gives (a hint; the dates inside decide when they disagree)
function nameHints(rel) {
  const p = rel.replace(/\\/g, '/').toUpperCase()
  const fy = /(20\d\d)-(\d\d)(?!\d)/.exec(p)
  const mon = MONTHS.find((m) => new RegExp(`(^|[^A-Z])${m}`).test(path.basename(p)))
  const mmyy = /(?<!\d)(0[1-9]|1[0-2])(2\d)(?!\d)/.exec(path.basename(p))
  return { fy: fy ? fy[0].slice(0, 7) : null, month: mon ?? (mmyy ? MONTHS[Number(mmyy[1]) - 1] : null), mmyy: mmyy ? `${mmyy[1]}/${mmyy[2]}` : null }
}

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function recognise(wb) {
  const found = []
  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet]
    if (!ws?.['!ref']) continue
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false })
    if (!rows.length) continue
    // the header is usually row 1; the AL sheet allows it within the first ten rows
    const head = new Set((rows[0] ?? []).map(H))
    let fam = Object.entries(FAMILIES).find(([, spec]) =>
      (!spec.sheet || H(spec.sheet) === H(sheet)) && !(spec.notSheet && spec.notSheet.test(sheet)) && spec.must.every((h) => head.has(h)) &&
      (!spec.notInBookWith || !wb.SheetNames.some((n) => H(n) === H(spec.notInBookWith))))?.[0]
    let family = fam ? (FAMILIES[fam].as ?? fam) : null
    let hr = 0
    if (!family) {
      hr = rows.slice(0, 10).findIndex((r) => { const s = new Set((r ?? []).map(H)); return s.has('DETAILS') && s.has('OFFTAKE MODE') })
      if (hr >= 0) family = 'AL_SHEET'; else hr = 0
    }
    const header = (rows[hr] ?? []).map(H)
    // chassis (for pairing copies — never printed) and the dates inside (for the year)
    const chCol = header.findIndex((h) => /^(CHASSIS NO\.?|CHASSIS NUMBER|VIN NO\.?)$/.test(h))
    const chassis = new Set()
    const years = new Map(), months = new Map()
    for (const r of rows.slice(hr + 1)) {
      if (chCol >= 0) { const c = String(r[chCol] ?? '').replace(/\s+/g, '').toUpperCase(); if (c.length > 10) chassis.add(c) }
      for (const v of r) if (v instanceof Date && v.getUTCFullYear() >= 2015 && v.getUTCFullYear() <= 2035) {
        const y = fyOfDate(v); years.set(y, (years.get(y) ?? 0) + 1)
        const m = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`; months.set(m, (months.get(m) ?? 0) + 1)
      }
    }
    const topYear = [...years].sort((a, b) => b[1] - a[1])[0]
    const topMonth = [...months].sort((a, b) => b[1] - a[1])[0]
    const dated = [...years.values()].reduce((s, n) => s + n, 0)
    found.push({ sheet, family, layout: fam ?? (family === 'AL_SHEET' ? 'AL_SHEET' : null), rows: rows.length - hr - 1, chassis,
      dataFy: topYear && topYear[1] >= dated * 0.5 ? fyLabel(topYear[0]) : null,
      dataMonth: topMonth && topMonth[1] >= dated * 0.5 ? topMonth[0] : null,
      firstHeaders: header.filter(Boolean).slice(0, 8).join(' | ') })
  }
  return found
}

// SHA-256 read in 8 MB pieces (a file of several GB never sits in memory)
function sha256File(p) {
  const h = crypto.createHash('sha256'), buf = Buffer.alloc(8 << 20), fd = fs.openSync(p, 'r')
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)) } finally { fs.closeSync(fd) }
  return h.digest('hex')
}
const MAX_SHEET_BYTES = 60 << 20 // a bigger "spreadsheet" is listed, not opened

// Scale (the owner's pile: ~4.6 lakh files, 129 GB): only files that share a SIZE can be exact duplicates, so
// only those are fingerprinted; only spreadsheets are opened. Everything else is listed by kind, size and date.
const t0 = Date.now()
const files = walk(src)
const stats = files.map((p) => { try { return fs.statSync(p) } catch { return null } })
const sizeCount = new Map()
for (const st of stats) if (st && st.size > 0) sizeCount.set(st.size, (sizeCount.get(st.size) ?? 0) + 1)
const items = []
let n = 0
for (const [k, p] of files.entries()) {
  const rel = path.relative(src, p)
  const st = stats[k]
  const base = path.basename(p)
  const it = { rel, size: st?.size ?? 0, mtime: st ? st.mtime.toISOString().slice(0, 16).replace('T', ' ') : '', sha: '', kind: 'other', family: '', sheets: '',
    rows: 0, chassisCount: 0, fy: '', month: '', note: '' }
  if (++n % 2000 === 0) process.stdout.write(`  … ${n.toLocaleString('en-IN')} of ${files.length.toLocaleString('en-IN')}\r`)
  if (!st) { it.kind = 'could not read'; items.push(it); continue }
  if (base.startsWith('~$')) { it.kind = 'Excel lock file (skip)'; items.push(it); continue }
  if (st.size > 0 && sizeCount.get(st.size) > 1) { try { it.sha = sha256File(p) } catch (e) { it.note = `could not read: ${e.code ?? e.message}` } }
  const hint = nameHints(rel)
  if (SHEETS.test(base) && st.size > MAX_SHEET_BYTES) {
    it.kind = 'spreadsheet — too big to open here'
    it.fy = hint.fy ?? ''
  } else if (SHEETS.test(base)) {
    it.kind = 'spreadsheet'
    // an .xlsx / .xlsm is a zip ("PK"); anything else under that name is damaged (the reader would take it as text)
    const zipped = /.(xlsx|xlsm)$/i.test(base)
    if (zipped) { const fd = fs.openSync(p, 'r'), b = Buffer.alloc(2); fs.readSync(fd, b, 0, 2, 0); fs.closeSync(fd); if (b.toString() !== 'PK') { it.kind = 'spreadsheet — could not open'; it.note = 'not a real Excel file (damaged or renamed)'; it.fy = hint.fy ?? ''; items.push(it); continue } }
    try {
      const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', cellDates: true, cellFormula: false, cellStyles: false, cellNF: false })
      const found = recognise(wb)
      const known = found.filter((f) => f.family)
      it.sheets = found.map((f) => `${f.sheet}${f.family ? ` [${f.family}]` : ''}`).join('; ')
      if (known.length) {
        const main = known.sort((a, b) => b.rows - a.rows)[0]
        it.family = [...new Set(known.map((f) => f.family))].join('+')
        it.rows = known.reduce((s, f) => s + f.rows, 0)
        it.chassis = new Set(known.flatMap((f) => [...f.chassis]))
        it.chassisCount = it.chassis.size
        it.fy = main.dataFy ?? hint.fy ?? ''
        it.month = main.family === 'AL_SHEET' || main.family === 'RET_INT' || main.family === 'RET_AL' ? (main.dataMonth ?? '') : ''
        if (hint.fy && main.dataFy && hint.fy !== main.dataFy) it.note = `folder/name says ${hint.fy}, the dates inside say ${main.dataFy}`
      } else {
        it.kind = 'spreadsheet — not recognised'
        it.fy = found.find((f) => f.dataFy)?.dataFy ?? hint.fy ?? ''
        it.note = found.slice(0, 2).map((f) => `${f.sheet}: ${f.firstHeaders}`).join(' || ').slice(0, 200)
      }
    } catch (e) { it.kind = 'spreadsheet — could not open'; it.note = String(e.message).slice(0, 120) }
  } else {
    it.kind = KIND_BY_EXT.find(([re]) => re.test(base))?.[1] ?? `other (${path.extname(base).toLowerCase() || 'no extension'})`
    it.fy = hint.fy ?? ''
  }
  items.push(it)
}

// exact duplicates: same bytes
const bySha = new Map()
for (const it of items) if (it.sha) (bySha.get(it.sha) ?? bySha.set(it.sha, []).get(it.sha)).push(it)
for (const group of bySha.values()) if (group.length > 1) {
  // keep the copy that looks like the original: not named copy / old / backup / (1), then the shortest path
  const looksCopied = (r) => /copy|old|backup|bkp|(d+)|- d+./i.test(path.basename(r)) ? 1 : 0
  const keep = group.sort((a, b) => looksCopied(a.rel) - looksCopied(b.rel) || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel))[0]
  for (const g of group.slice(1)) g.dupOf = keep.rel
}
// copies of one book: same family, same year, ≥ 50% of the chassis shared — the one with more chassis
// (then the newer) is named; the others are "older/shorter copy of"
const books = items.filter((it) => it.chassisCount >= 20 && !it.dupOf)
const copyGroups = []
const grouped = new Set()
for (const a of books) {
  if (grouped.has(a)) continue
  const group = [a]
  for (const b of books) {
    if (b === a || grouped.has(b) || b.family !== a.family) continue
    let shared = 0
    for (const c of b.chassis) if (a.chassis.has(c)) shared++
    if (shared >= 0.5 * Math.min(a.chassisCount, b.chassisCount)) group.push(b)
  }
  if (group.length > 1) {
    group.forEach((g) => grouped.add(g))
    group.sort((x, y) => y.chassisCount - x.chassisCount || y.mtime.localeCompare(x.mtime))
    group.slice(1).forEach((g) => { g.copyOf = group[0].rel })
    copyGroups.push(group)
  }
}

// inventory.csv
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const cols = ['rel', 'kind', 'family', 'fy', 'month', 'rows', 'chassisCount', 'dupOf', 'copyOf', 'size', 'mtime', 'sheets', 'note', 'sha']
fs.writeFileSync(path.join(out, 'inventory.csv'), '﻿' + [cols.join(','), ...items.map((it) => cols.map((c) => csv(it[c])).join(','))].join('\r\n'))

// summary
const lines = []
const say = (s = '') => { lines.push(s); console.log(s) }
say(`Inventory of ${src} — ${items.length} files, read in ${Math.round((Date.now() - t0) / 1000)} s`)
const kinds = new Map()
for (const it of items) { const k = it.family ? `workbook: ${it.family.split('+').map((f) => FAMILY_NAME[f] ?? f).join(' + ')}` : it.kind; kinds.set(k, (kinds.get(k) ?? 0) + 1) }
say('\nWhat the files are:')
for (const [k, c] of [...kinds].sort((a, b) => b[1] - a[1])) say(`  ${String(c).padStart(5)}  ${k}`)
const dups = items.filter((it) => it.dupOf)
say(`\nExact duplicates (same bytes, another name or place): ${dups.length}`)
say(`Copies of the same book (same kind, mostly the same trucks): ${copyGroups.length} groups, ${copyGroups.reduce((s, g) => s + g.length - 1, 0)} extra copies`)
const fams = items.filter((it) => it.family && !it.dupOf)
say('\nBooks by kind and financial year (distinct files, duplicates left out):')
const grid = new Map()
for (const it of fams) for (const f of it.family.split('+')) { const k = `${FAMILY_NAME[f] ?? f}|${it.fy || '?'}`; grid.set(k, (grid.get(k) ?? 0) + 1) }
for (const k of [...grid.keys()].sort()) { const [f, y] = k.split('|'); say(`  ${y.padEnd(8)} ${f}: ${grid.get(k)}`) }
const unsure = items.filter((it) => it.note && it.family)
say(`\nWorkbooks whose name/folder disagrees with the dates inside: ${unsure.length}`)
say(`Spreadsheets not recognised: ${items.filter((it) => it.kind === 'spreadsheet — not recognised').length} · could not open: ${items.filter((it) => it.kind === 'spreadsheet — could not open').length}`)
say(`\nFull list: ${path.join(out, 'inventory.csv')} (open in Excel; filter by kind / family / fy / dupOf / copyOf)`)
fs.writeFileSync(path.join(out, 'summary.txt'), lines.join('\r\n'))
