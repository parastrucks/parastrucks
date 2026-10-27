// Phase 10 import, step 3 — the merged result (import.json) → SQL.
//
//   node scripts/phase10/import/sql.cjs <folder holding import.json> <actor uuid>               → import.sql
//   node scripts/phase10/import/sql.cjs <folder holding import.json> <actor uuid> --parts <MB>  → import-01.sql …
//
// import.sql is ONE transaction (the PGlite rehearsal runs it). --parts cuts the same load into files of at most
// <MB> each, for staging/prod: the Supabase query endpoint refuses a request over its size limit ("413 request
// entity too large" at 18 MB, 2026-10-27). Each part is its own transaction and REPLAYABLE — every row carries the
// id this run gave it and is inserted "on conflict do nothing", the rebill links only set what is unset — so a part
// that fails is simply run again, and the parts in order end exactly where import.sql does.
// Writes next to import.json (REAL DATA — outside the repository) and prints counts only.
// Every row is written with recompute = false, so the workbook's own worked-out figures are kept as
// history (R2-25); scripts/phase10/import/recompute-diff.sql then shows where the database's rules would
// give a different figure. The whole load carries one import batch id, so it can be found (and reverted).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const [dir, actor, flag, mb] = process.argv.slice(2)
if (!dir || !/^[0-9a-f-]{36}$/i.test(actor ?? '') || (flag && (flag !== '--parts' || !(Number(mb) > 0)))) {
  console.error('usage: sql.cjs <folder with import.json> <actor uuid> [--parts <MB>]'); process.exit(2)
}
const { units, notes, formats, incentives, links } = JSON.parse(fs.readFileSync(path.join(dir, 'import.json'), 'utf8'))

const batch = crypto.randomUUID()
const now = new Date().toISOString()
const idOf = new Map()
const rows = units.map((u) => {
  const id = crypto.randomUUID()
  idOf.set(u.chassis_no, id)
  return {
    ...u, id, qty: u.qty ?? 1, road_tax_pct: u.road_tax_pct ?? 6, recompute: false, import_batch_id: batch,
    created_at: now, updated_at: now, created_by: actor, updated_by: actor,
  }
})
const withUnit = (list) => list.filter((x) => idOf.has(x.chassis)).map(({ chassis, ...rest }) => ({ unit_id: idOf.get(chassis), ...rest }))
const noteRows = withUnit(notes).map((n) => ({ id: crypto.randomUUID(), ...n, author_id: null }))
const formatRows = withUnit(formats)
const incentiveRows = withUnit(incentives)
const linkRows = links.filter((l) => idOf.has(l.chassis) && idOf.has(l.new_chassis))
  .map((l) => ({ id: idOf.get(l.chassis), by: idOf.get(l.new_chassis) }))

// dollar-quoted JSON: nothing inside needs escaping unless it holds the tag itself
const lit = (v) => { const j = JSON.stringify(v); if (j.includes('$imp$')) throw new Error('data holds the quote tag'); return `$imp$${j}$imp$::jsonb` }
const statements = {
  units: (list) => `insert into public.vehicle_units
select * from jsonb_populate_recordset(null::public.vehicle_units, ${lit(list)})
on conflict (id) do nothing;`,
  incentives: (list) => `insert into public.vehicle_unit_incentives (unit_id, dse_incentive_override, dsm_incentive, gm_incentive, updated_by)
select unit_id, dse_incentive_override, dsm_incentive, gm_incentive, '${actor}'
from jsonb_to_recordset(${lit(list)}) as x(unit_id uuid, dse_incentive_override numeric, dsm_incentive numeric, gm_incentive numeric)
on conflict (unit_id) do nothing;`,
  notes: (list) => `insert into public.unit_cell_notes (id, unit_id, column_key, body, source)
select id, unit_id, column_key, body, source
from jsonb_to_recordset(${lit(list)}) as x(id uuid, unit_id uuid, column_key text, body text, source text)
on conflict (id) do nothing;`,
  formats: (list) => `insert into public.unit_cell_formats (unit_id, column_key, format, updated_by)
select unit_id, column_key, format, '${actor}'
from jsonb_to_recordset(${lit(list)}) as x(unit_id uuid, column_key text, format jsonb)
on conflict (unit_id, column_key) do nothing;`,
  // cancel / rebill: the old truck points to the new one (the old row stays, superseded); only where unset
  links: (list) => `update public.vehicle_units v set superseded_at = now(), superseded_by_id = x.by
from jsonb_to_recordset(${lit(list)}) as x(id uuid, by uuid) where v.id = x.id and v.superseded_by_id is null;`,
}
const head = `select set_config('tracker.actor', '${actor}', true), set_config('tracker.source', 'import', true),
       set_config('tracker.batch', '${batch}', true);`
const batchRow = `insert into public.tracker_import_batches (id, source_file, row_count, actor)
values ('${batch}', 'first load ${now.slice(0, 10)} (${new Set(units.map((u) => u.source_file)).size} source files)', ${rows.length}, '${actor}')
on conflict (id) do nothing;`
const counts = `${rows.length} trucks · ${incentiveRows.length} incentive rows · ${noteRows.length} notes · ${formatRows.length} colours · ${linkRows.length} rebill links (of ${links.length})`

if (!flag) {
  const sql = `-- Phase 10 first load — generated ${now} by scripts/phase10/import/sql.cjs. REAL DATA: never commit.
begin;
${head}
${batchRow}

${statements.units(rows)}

${statements.incentives(incentiveRows)}

${statements.notes(noteRows)}

${statements.formats(formatRows)}

${statements.links(linkRows)}

commit;
`
  fs.writeFileSync(path.join(dir, 'import.sql'), sql)
  console.log(`import.sql: batch ${batch} · ${counts} · ${(sql.length / 1e6).toFixed(1)} MB`)
} else {
  // each table's rows in pieces whose JSON stays under the limit (with room for the SQL around it)
  const limit = Number(mb) * 1e6 - 4000
  const pieces = (kind, list) => {
    const out = []; let cur = [], size = 2
    for (const r of list) {
      const s = Buffer.byteLength(JSON.stringify(r)) + 1 // bytes, not characters (names in other scripts)
      if (cur.length && size + s > limit) { out.push([kind, cur]); cur = []; size = 2 }
      cur.push(r); size += s
    }
    if (cur.length) out.push([kind, cur])
    return out
  }
  const all = [...pieces('units', rows), ...pieces('incentives', incentiveRows), ...pieces('notes', noteRows),
    ...pieces('formats', formatRows), ...pieces('links', linkRows)]
  for (const f of fs.readdirSync(dir).filter((n) => /^import-\d+\.sql$/.test(n))) fs.rmSync(path.join(dir, f)) // a previous run's parts
  all.forEach(([kind, list], i) => {
    const sql = `-- Phase 10 first load, part ${i + 1} of ${all.length} (${kind}, ${list.length} rows) — batch ${batch}, generated ${now}
-- by scripts/phase10/import/sql.cjs --parts. REAL DATA: never commit. Replayable: running it twice changes nothing.
begin;
${head}
${batchRow}
${statements[kind](list)}
commit;
`
    fs.writeFileSync(path.join(dir, `import-${String(i + 1).padStart(2, '0')}.sql`), sql)
  })
  console.log(`import-01 … import-${String(all.length).padStart(2, '0')}.sql: batch ${batch} · ${counts} · ${all.length} parts of at most ${mb} MB (${all.map(([k, l]) => `${k} ${l.length}`).join(', ')})`)
}
