// Phase 10 — the import's sources: which files hold which trucks, how they overlap, where they disagree.
//
//   node scripts/phase10/e_sources.cjs
//
// READ-ONLY; prints COUNTS only (never a value). Input to the importer's "home file per column" rule:
// the same truck sits in several files, and last-file-wins would corrupt ~1 money cell in 4 (plan §2.6).
const XLSX = require('xlsx')
const fs = require('fs')
const FIN = 'D:/PTB/Finances/2025-26/'
const DL = 'C:/Users/dhruv/Downloads/PAYMENT TRACKER LIST 2025-26/PAYMENT TRACKER LIST 2025-26/'

const H = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
const CH = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')
// a sheet → records keyed by normalised header (header = row 1)
function records(ws) {
  if (!ws || !ws['!ref']) return []
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
  const head = (rows[0] ?? []).map(H)
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 }
    head.forEach((h, c) => { if (h && !(h in o)) o[h] = r[c] })
    return o
  })
}
const sheetOf = (file, name) => { const wb = XLSX.readFile(file); return wb.Sheets[name ?? wb.SheetNames[0]] }
// the sheet whose header row names the given column (a retention file opens on its SUMMARY sheet)
const sheetWith = (file, header) => {
  const wb = XLSX.readFile(file)
  const name = wb.SheetNames.find((n) => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null })[0] ?? []).map(H).includes(header))
  return name ? wb.Sheets[name] : null
}
const files = (dir, re) => fs.readdirSync(dir).filter((f) => re.test(f) && !f.startsWith('~')).map((f) => dir + f)

// ── read every family
const it = [...records(sheetOf(FIN + 'INVOICE TRACKER 2025-26.xlsx', 'INVOICE TRACKER')).map((r) => ({ ...r, _src: 'IT' })),
  ...records(sheetOf(FIN + 'INVOICE TRACKER 2025-26.xlsx', 'OTHER DEALER')).map((r) => ({ ...r, _src: 'IT-OD' }))]
const fy = records(sheetOf(DL + '2025-26.xlsx', 'Sheet1'))
const lists = files(DL, /^INVOICE LIST/i)
const retail = [], dealers = [], rebill = []
for (const f of lists) {
  const wb = XLSX.readFile(f)
  const tag = f.split('/').pop()
  for (const r of records(wb.Sheets['PTB RETAIL'])) retail.push({ ...r, _file: tag })
  for (const r of records(wb.Sheets['DEALERS'])) dealers.push({ ...r, _file: tag })
  for (const r of records(wb.Sheets['canc rebill'])) rebill.push({ ...r, _file: tag })
}
const months = fs.readdirSync(FIN).filter((d) => /^20\d\d-\d\d/.test(d)).map((d) => FIN + d + '/')
const retInt = [], retAl = []
for (const m of months) {
  for (const f of files(m, /RETENTION TRACKER.*INTERNAL/i)) for (const r of records(sheetWith(f, 'CHASSIS NO'))) retInt.push({ ...r, _file: f.split('/').pop() })
  for (const f of files(m, /RETENTION TRACKER.*-AL\.xlsx$/i)) for (const r of records(sheetWith(f, 'CHASSIS NO'))) retAl.push({ ...r, _file: f.split('/').pop() })
}

const chassisOf = (r, ...keys) => { for (const k of keys) { const v = CH(r[k]); if (/^[A-Z0-9]{10,}/.test(v)) return v } return '' }
const fam = {
  IT: it.map((r) => ({ ch: chassisOf(r, 'CHASSIS NO'), r })),
  FY: fy.map((r) => ({ ch: chassisOf(r, 'CHASSIS NUMBER'), r })),
  LIST: retail.map((r) => ({ ch: chassisOf(r, 'CHASSIS NUMBER'), r })),
  RET_INT: retInt.map((r) => ({ ch: chassisOf(r, 'CHASSIS NO'), r })),
  RET_AL: retAl.map((r) => ({ ch: chassisOf(r, 'CHASSIS NO'), r })),
  // R2-5: on DEALERS the chassis sits under "Model"; "Chassis No" holds engine numbers
  DEALERS: dealers.map((r) => ({ ch: chassisOf(r, 'MODEL', 'CHASSIS NO'), r })),
}
console.log(`files: IT 1 (2 sheets) · FY 1 · INVOICE LIST ${lists.length} · RETENTION internal ${new Set(retInt.map((r) => r._file)).size} · AL ${new Set(retAl.map((r) => r._file)).size}`)
const sets = {}
for (const [k, list] of Object.entries(fam)) {
  const withCh = list.filter((x) => x.ch)
  const uniq = new Set(withCh.map((x) => x.ch))
  sets[k] = uniq
  console.log(`${k.padEnd(8)} rows ${String(list.length).padStart(5)} · with a chassis ${String(withCh.length).padStart(5)} · distinct ${String(uniq.size).padStart(5)} · repeated ${withCh.length - uniq.size}`)
}
const inter = (a, b) => [...sets[a]].filter((x) => sets[b].has(x)).length
console.log('\noverlaps (distinct chassis):')
for (const [a, b] of [['IT', 'FY'], ['IT', 'LIST'], ['FY', 'LIST'], ['IT', 'RET_INT'], ['FY', 'RET_INT'], ['RET_INT', 'RET_AL'], ['IT', 'DEALERS'], ['FY', 'DEALERS']])
  console.log(`  ${a} ∩ ${b}: ${inter(a, b)}   (${a} only ${sets[a].size - inter(a, b)}, ${b} only ${sets[b].size - inter(a, b)})`)
const all = new Set(Object.values(sets).flatMap((s) => [...s]))
console.log(`  all families: ${all.size} distinct chassis`)

// ── where two families disagree on the same truck (first row per chassis in each)
const first = (k) => { const m = new Map(); for (const x of fam[k]) if (x.ch && !m.has(x.ch)) m.set(x.ch, x.r); return m }
const F = Object.fromEntries(Object.keys(fam).map((k) => [k, first(k)]))
const num = (v) => (typeof v === 'number' ? v : null)
const txt = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const FIELDS = {
  ctc: { IT: 'CTC', FY: 'CTC', LIST: 'CTC', RET_INT: 'CTC', RET_AL: 'CTC', kind: 'n' },
  ctd: { IT: 'CTD', FY: 'CTD', LIST: 'CTD', RET_INT: 'CTD', RET_AL: 'CTD', DEALERS: 'CTD', kind: 'n' },
  customer: { IT: 'CUSTOMER NAME', FY: 'NAME OF THE CUSTOMER', LIST: 'NAME OF THE CUSTOMER', RET_INT: 'NAME', RET_AL: 'NAME', kind: 't' },
  engine: { IT: 'ENGINE NO', FY: 'ENGINE NO', LIST: 'ENGINE NO', RET_INT: 'ENGINE NO', RET_AL: 'ENGINE NO', kind: 't' },
  vpart: { IT: 'VPART NUMBER', FY: 'V PART NUMBER', LIST: 'V PART NUMBER', RET_INT: 'CBN NO.', RET_AL: 'CBN NO.', kind: 't' },
  model: { IT: 'MODEL', FY: 'MODEL', LIST: 'MODEL', RET_INT: 'MODEL', RET_AL: 'MODEL', kind: 't' },
  ptb_invoice_date: { IT: 'PTB INVOICE DATE', FY: 'PTB INVOICE DATE', LIST: 'PTB INVOICE DATE', kind: 'n' },
  dse: { FY: 'DSE', LIST: 'DSE', RET_INT: 'DSE', kind: 't' },
  segment: { FY: 'SEGMENT', LIST: 'SEGMENT', RET_INT: 'SEGMENT', RET_AL: 'SEGMENT', kind: 't' },
}
console.log('\ndisagreements on the same truck (both filled; numbers to the rupee, text ignoring case/spaces/punctuation):')
for (const [field, spec] of Object.entries(FIELDS)) {
  const fams = Object.keys(spec).filter((k) => k !== 'kind')
  const out = []
  for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) {
    const a = fams[i], b = fams[j]
    let both = 0, diff = 0
    for (const [ch, ra] of F[a]) {
      const rb = F[b].get(ch); if (!rb) continue
      const va = ra[spec[a]], vb = rb[spec[b]]
      if (spec.kind === 'n') { const x = num(va), y = num(vb); if (x == null || y == null || (!x && !y)) continue; both++; if (Math.abs(x - y) >= 1) diff++ }
      else { const x = txt(va), y = txt(vb); if (!x || !y) continue; both++; if (x !== y) diff++ }
    }
    if (both) out.push(`${a}/${b} ${diff}/${both}`)
  }
  console.log(`  ${field.padEnd(17)} ${out.join(' · ')}`)
}
// a truck in more than one monthly list: retail in one month, again later?
const listMonths = new Map(); for (const x of fam.LIST) if (x.ch) listMonths.set(x.ch, (listMonths.get(x.ch) ?? new Set()).add(x.r._file))
console.log(`\ntrucks in more than one monthly INVOICE LIST: ${[...listMonths.values()].filter((s) => s.size > 1).length}`)
const retMonths = new Map(); for (const x of fam.RET_INT) if (x.ch) retMonths.set(x.ch, (retMonths.get(x.ch) ?? new Set()).add(x.r._file))
console.log(`trucks in more than one monthly RETENTION (internal): ${[...retMonths.values()].filter((s) => s.size > 1).length}`)
console.log(`canc rebill rows across the lists: ${rebill.length} (with a NEW CHASSIS NO: ${rebill.filter((r) => CH(r['NEW CHASSIS NO']).length >= 10).length})`)
