// Phase 10 import, step 3 — the merged result (import.json) → ONE transaction of SQL (import.sql).
//
//   node scripts/phase10/import/sql.cjs <folder holding import.json> <actor uuid>
//
// Writes import.sql next to import.json (REAL DATA — outside the repository) and prints counts only.
// Every row is written with recompute = false, so the workbook's own worked-out figures are kept as
// history (R2-25); scripts/phase10/import/recompute-diff.sql then shows where the database's rules would
// give a different figure. The whole load carries one import batch id, so it can be found (and reverted).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const [dir, actor] = process.argv.slice(2)
if (!dir || !/^[0-9a-f-]{36}$/i.test(actor ?? '')) { console.error('usage: sql.cjs <folder with import.json> <actor uuid>'); process.exit(2) }
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
const noteRows = withUnit(notes).map((n) => ({ ...n, author_id: null }))
const formatRows = withUnit(formats)
const incentiveRows = withUnit(incentives)
const linkRows = links.filter((l) => idOf.has(l.chassis) && idOf.has(l.new_chassis))
  .map((l) => ({ id: idOf.get(l.chassis), by: idOf.get(l.new_chassis) }))

// dollar-quoted JSON: nothing inside needs escaping unless it holds the tag itself
const lit = (v) => { const j = JSON.stringify(v); if (j.includes('$imp$')) throw new Error('data holds the quote tag'); return `$imp$${j}$imp$::jsonb` }
const sql = `-- Phase 10 first load — generated ${now} by scripts/phase10/import/sql.cjs. REAL DATA: never commit.
begin;
select set_config('tracker.actor', '${actor}', true), set_config('tracker.source', 'import', true),
       set_config('tracker.batch', '${batch}', true);
insert into public.tracker_import_batches (id, source_file, row_count, actor)
values ('${batch}', 'first load ${now.slice(0, 10)} (${new Set(units.map((u) => u.source_file)).size} source files)', ${rows.length}, '${actor}');

insert into public.vehicle_units
select * from jsonb_populate_recordset(null::public.vehicle_units, ${lit(rows)});

insert into public.vehicle_unit_incentives (unit_id, dse_incentive_override, dsm_incentive, gm_incentive, updated_by)
select unit_id, dse_incentive_override, dsm_incentive, gm_incentive, '${actor}'
from jsonb_to_recordset(${lit(incentiveRows)}) as x(unit_id uuid, dse_incentive_override numeric, dsm_incentive numeric, gm_incentive numeric);

insert into public.unit_cell_notes (unit_id, column_key, body, source)
select unit_id, column_key, body, source
from jsonb_to_recordset(${lit(noteRows)}) as x(unit_id uuid, column_key text, body text, source text);

insert into public.unit_cell_formats (unit_id, column_key, format, updated_by)
select unit_id, column_key, format, '${actor}'
from jsonb_to_recordset(${lit(formatRows)}) as x(unit_id uuid, column_key text, format jsonb);

-- cancel / rebill: the old truck points to the new one (the old row stays, superseded)
update public.vehicle_units v set superseded_at = now(), superseded_by_id = x.by
from jsonb_to_recordset(${lit(linkRows)}) as x(id uuid, by uuid) where v.id = x.id;

commit;
`
fs.writeFileSync(path.join(dir, 'import.sql'), sql)
console.log(`import.sql: batch ${batch} · ${rows.length} trucks · ${incentiveRows.length} incentive rows · ${noteRows.length} notes · ${formatRows.length} colours · ${linkRows.length} rebill links (of ${links.length}) · ${(sql.length / 1e6).toFixed(1)} MB`)
