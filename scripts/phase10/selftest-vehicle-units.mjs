// Phase 10 Stage 1 step 3 — offline self-test for the admin-vehicle-units Edge Function.
//
//   node scripts/phase10/selftest-vehicle-units.mjs
//
// Imports the function's OWN modules (Node 24 strips the TypeScript types), so what is tested is
// what is deployed. Four parts:
//   1. drift — the column catalogue against the migration's CREATE TABLE, its editable allowlist,
//      its audit trigger's computed list and its CHECK constraints;
//   2. authority — every person × every action, expectations written out by hand from the plan
//      (owner, 2026-08-11), never derived from the code;
//   3. value checks, cell by cell;
//   4. the read plan (incentives hidden from all but admin + HR).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fn = join(root, 'supabase', 'functions', 'admin-vehicle-units')
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/')
const cols = await import(fileUrl(join(fn, 'columns.ts')))
const auth = await import(fileUrl(process.env.AUTHORITY_FILE ?? join(fn, 'authority.ts')))
const val = await import(fileUrl(join(fn, 'validate.ts')))

let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL', label) } }
const eqSet = (a, b) => a.length === b.length && [...a].every((x) => b.includes(x))

// ── 1. Drift against the migration ────────────────────────────────────────────────────────────
const sql = readFileSync(join(root, 'supabase', 'migrations', '20261021_phase10_tracker_foundation.sql'), 'utf8').replace(/\r\n/g, '\n')
const table = sql.slice(sql.indexOf('create table public.vehicle_units ('), sql.indexOf('create unique index vehicle_units_chassis_active'))
const sqlCols = {}
for (const line of table.split('\n')) {
  const m = /^\s{2}([a-z_0-9]+)\s+(text|numeric|integer|date|uuid|timestamptz|boolean)\b(.*)$/.exec(line)
  if (m) sqlCols[m[1]] = { type: m[2], rest: m[3] }
}
ok(Object.keys(sqlCols).length === 102, `vehicle_units has 102 columns in the migration (found ${Object.keys(sqlCols).length})`)
// Later tracker migrations: columns they add, and the newest tracker_apply_changes allowlist
const later = readdirSync(join(root, 'supabase', 'migrations')).filter((f) => /_phase10_tracker_/.test(f)).sort()
  .map((f) => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8').replace(/\r\n/g, '\n'))
let added = 0
for (const text of later) for (const m of text.matchAll(/^alter table public\.vehicle_units add column ([a-z_0-9]+) (text|numeric|integer|date|uuid|timestamptz|boolean)\b(.*)$/gm)) {
  sqlCols[m[1]] = { type: m[2], rest: m[3] }; added++
}
ok(added === 4, `later migrations add 4 columns (endhan_date, mto_advance, al_retail_date, al_ctc) — found ${added}`)
ok(sqlCols.mto_advance?.rest.includes("in ('Yes', 'No')") && eqSet(cols.COLUMNS.mto_advance?.oneOf ?? [], ['Yes', 'No']), 'mto_advance values: Yes / No in the table and the catalogue')
const applySql = later.filter((t) => t.includes('editable constant text[] := array[')).at(-1)
ok(eqSet(Object.keys(sqlCols), Object.keys(cols.COLUMNS)), 'catalogue lists exactly the table\'s columns')
for (const [k, s] of Object.entries(sqlCols)) {
  ok(cols.COLUMNS[k]?.type === s.type, `type of ${k}: sql ${s.type} vs catalogue ${cols.COLUMNS[k]?.type}`)
  ok(/not null/.test(s.rest) === (cols.COLUMNS[k]?.notNull === true) || ['id','recompute','created_at','updated_at'].includes(k),
     `not-null of ${k}`)
}

const editableSql = (() => {
  const a = applySql.indexOf('editable constant text[] := array[')
  const b = applySql.indexOf('];', a)
  return [...applySql.slice(a, b).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])
})()
ok(editableSql.length === cols.EDITABLE.length && eqSet(editableSql, cols.EDITABLE),
   `editable list = tracker_apply_changes allowlist (${cols.EDITABLE.length} vs ${editableSql.length})`)

const skipSql = (() => {
  const a = sql.indexOf("continue when k in (")
  const b = sql.indexOf(');', a)
  return [...sql.slice(a, b).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])
})()
const system = ['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'recompute']
const computedCat = Object.keys(cols.COLUMNS).filter((k) => cols.COLUMNS[k].computed)
ok(eqSet(skipSql.filter((k) => !system.includes(k)), computedCat), 'computed columns = the audit trigger\'s computed list')
ok(computedCat.every((k) => !cols.COLUMNS[k].editable), 'no computed column is editable')
ok(sqlCols.gst_rate_override.rest.includes('in (5, 12, 18, 28)') && eqSet(cols.COLUMNS.gst_rate_override.oneOf, [5, 12, 18, 28]), 'gst override values')
ok(sqlCols.road_tax_pct.rest.includes('>= 0 and road_tax_pct <= 20') && cols.COLUMNS.road_tax_pct.min === 0 && cols.COLUMNS.road_tax_pct.max === 20, 'road tax range')
ok(sqlCols.qty.rest.includes('qty >= 0') && cols.COLUMNS.qty.min === 0, 'qty minimum')
ok(sqlCols.purchase_source.rest.includes("in ('al','other_dealer')"), 'purchase source values')
ok(sqlCols.ctc_basis.rest.includes("in ('inclusive','exclusive')"), 'ctc basis values')
const incSql = sql.slice(sql.indexOf('create table public.vehicle_unit_incentives ('), sql.indexOf('-- ── Cell notes'))
ok(cols.INCENTIVE_COLUMNS.every((k) => incSql.includes(`  ${k} `)), 'incentive columns exist in vehicle_unit_incentives')
ok(cols.INCENTIVE_COLUMNS.every((k) => !(k in cols.COLUMNS)), 'no incentive column is in vehicle_units')

// ── 2. Authority: every person × every action, by hand ───────────────────────────────────────
const P = (o) => ({ id: o.id ?? crypto.randomUUID(), permission_level: o.perm, department_code: o.dept ?? null,
  is_active: o.active ?? true, tracker_access: o.access ?? false, tracker_export: o.export ?? false })
const people = {
  admin:               P({ perm: 'admin' }),                                        // no flag needed
  admin_inactive:      P({ perm: 'admin', active: false }),
  bo_exec_on:          P({ perm: 'executive', dept: 'back_office', access: true }),
  bo_exec_off:         P({ perm: 'executive', dept: 'back_office' }),
  bo_gm_off:           P({ perm: 'gm', dept: 'back_office' }),                      // rank does not grant it
  bo_exec_export:      P({ perm: 'executive', dept: 'back_office', access: true, export: true }),
  export_without_access: P({ perm: 'executive', dept: 'back_office', export: true }), // export alone opens nothing
  hr_mgr_on:           P({ perm: 'manager', dept: 'hr', access: true }),
  hr_mgr_off:          P({ perm: 'manager', dept: 'hr' }),                          // HR sees incentives only once let in
  sales_gm_off:        P({ perm: 'gm', dept: 'sales' }),
  accounts_mgr_on:     P({ perm: 'manager', dept: 'accounts', access: true }),
  inactive_with_flag:  P({ perm: 'executive', dept: 'back_office', access: true, active: false }),
  no_dept_on:          P({ perm: 'executive', access: true }),
}
const opens = ['admin', 'bo_exec_on', 'bo_exec_export', 'hr_mgr_on', 'accounts_mgr_on', 'no_dept_on']
for (const [name, c] of Object.entries(people)) {
  for (const a of auth.ACTIONS) {
    const want = opens.includes(name)
    const got = auth.gate(a, c).ok
    ok(got === want, `${name} → ${a}: expected ${want ? 'allowed' : 'refused'}`)
  }
  ok(auth.gate('dropTable', c).ok === false && auth.gate('dropTable', c).status === 400, `${name} → unknown action refused`)
}
ok(eqSet([...auth.ACTIONS], ['list','history','listNotes','listFormats','listViews','applyChanges','createUnit','createUnits',
  'supersedeUnit','addNote','setFormats','saveView','deleteView','logExport']), 'the action list is the planned one')

// hasTrackerAccess on its own (gate() checks is_active first; this keeps the second line honest)
for (const [name, c] of Object.entries(people)) ok(auth.hasTrackerAccess(c) === opens.includes(name), `${name} hasTrackerAccess`)

const seesInc = ['admin', 'admin_inactive', 'hr_mgr_on', 'hr_mgr_off']
for (const [name, c] of Object.entries(people)) {
  ok(auth.canSeeIncentives(c) === seesInc.includes(name), `${name} incentives`)
  ok(auth.canExport(c) === ['admin', 'admin_inactive', 'bo_exec_export', 'export_without_access'].includes(name), `${name} export flag`)
  ok(auth.canManageSharedViews(c) === name.startsWith('admin'), `${name} shared layouts`)
}
const me = people.bo_exec_on, other = people.accounts_mgr_on
ok(auth.canEditView(me, { owner_id: me.id }) === true, 'own layout: editable')
ok(auth.canEditView(me, { owner_id: other.id }) === false, 'someone else\'s layout: not editable')
ok(auth.canEditView(people.admin, { owner_id: other.id }) === false, 'admin cannot edit a personal layout either')
ok(auth.canEditView(me, { owner_id: null }) === false, 'shared layout: not for a user')
ok(auth.canEditView(people.admin, { owner_id: null }) === true, 'shared layout: admin')

// ── 3. Value checks ───────────────────────────────────────────────────────────────────────────
const C = cols.COLUMNS
const chk = (col, v) => cols.checkValue(C[col], v)
const acc = (col, v, want, label) => { const r = chk(col, v); ok(r.ok && r.value === want, `${label}: ${JSON.stringify(v)} → ${JSON.stringify(want)} (got ${JSON.stringify(r)})`) }
const rej = (col, v, label) => { const r = chk(col, v); ok(!r.ok, `${label}: ${JSON.stringify(v)} refused (got ${JSON.stringify(r)})`) }
acc('ctc', 2800000, 2800000, 'money number')
acc('ctc', '2800000', 2800000, 'money digits as text')
acc('ctc', ' 2800000 ', 2800000, 'paste trailing space')
acc('ctc', '-1500.50', -1500.5, 'negative with paise')
acc('ctc', '', null, 'blank clears')
acc('ctc', null, null, 'null clears')
rej('ctc', '12,34,567', 'Excel lakh commas (adapter converts; server never guesses)')
rej('ctc', '₹2800000', 'rupee sign')
rej('ctc', '=SUM(A1:A2)', 'formula')
rej('ctc', 'abc', 'text in money')
rej('ctc', Infinity, 'infinity')
rej('ctc', NaN, 'NaN')
rej('ctc', true, 'boolean')
acc('qty', 2, 2, 'qty')
rej('qty', 1.5, 'fractional qty')
rej('qty', -1, 'negative qty')
rej('qty', '', 'blank qty (not null)')
rej('qty', 3000000000, 'qty beyond Postgres integer (would abort the batch with no cell named)')
acc('al_claim_age', 2147483647, 2147483647, 'largest integer')
acc('road_tax_pct', 0, 0, 'road tax 0 (staff bus)')
acc('road_tax_pct', '8', 8, 'road tax 8')
rej('road_tax_pct', 21, 'road tax above 20')
rej('road_tax_pct', null, 'road tax blank (not null)')
acc('gst_rate_override', 18, 18, 'gst 18')
acc('gst_rate_override', '28', 28, 'gst 28 as text')
rej('gst_rate_override', 15, 'gst 15')
acc('gst_rate_override', null, null, 'gst override cleared')
acc('ptb_invoice_date', '2025-09-22', '2025-09-22', 'iso date')
rej('ptb_invoice_date', '2025-02-30', 'no such day')
rej('ptb_invoice_date', '22/09/2025', 'dd/mm/yyyy')
rej('ptb_invoice_date', 45922, 'Excel date serial (adapter converts)')
rej('ptb_invoice_date', '1899-12-31', 'year out of range')
acc('customer_name', '  ACME LOGISTICS ', 'ACME LOGISTICS', 'text trimmed')
acc('engine_no', 123456, '123456', 'number into a text column')
rej('customer_name', '=HYPERLINK("x")', 'formula in text')
rej('customer_name', 'x'.repeat(2001), 'over 2000 characters')
acc('purchase_source', 'other_dealer', 'other_dealer', 'enum')
rej('purchase_source', 'AL', 'enum is exact')
rej('chassis_no', '   ', 'blank chassis')
acc('parts_pkg', '5K-DSA', '5K-DSA', 'text money stays text')

// ── validateChanges ──
const u1 = '11111111-1111-4111-8111-111111111111', u2 = '22222222-2222-4222-8222-222222222222'
let r = val.validateChanges([{ unit_id: u1, column: 'ctc', before: '1', after: ' 2 ' }])
ok(r.ok && r.clean[0].after === 2 && r.clean[0].before === '1', 'one clean change')
r = val.validateChanges([{ unit_id: u1, column: 'ctc', before: null, after: 1 }, { unit_id: u1.toUpperCase(), column: 'ctc', before: null, after: 2 }])
ok(!r.ok && r.rejected?.length === 1 && /twice/.test(r.rejected[0].reason), 'same cell twice refused (even with different case ids)')
r = val.validateChanges([{ unit_id: u1, column: 'ctc', after: 1 }, { unit_id: u2, column: 'ctc', after: 2 }])
ok(r.ok && r.clean.length === 2 && r.clean[0].before === null, 'two rows, missing before = blank')
r = val.validateChanges([{ unit_id: u1, column: 'tcs', after: 1 }])
ok(!r.ok && r.rejected[0].reason === 'not an editable column', 'computed column refused')
r = val.validateChanges([{ unit_id: u1, column: 'dsm_incentive', after: 1 }])
ok(!r.ok && /incentive/.test(r.rejected[0].reason), 'incentive column refused here')
r = val.validateChanges([{ unit_id: u1, column: 'superseded_at', after: null }])
ok(!r.ok, 'system column refused')
r = val.validateChanges([{ unit_id: 'x', column: 'ctc', after: 1 }])
ok(!r.ok && r.rejected[0].reason === 'bad row id', 'bad uuid refused')
r = val.validateChanges([{ unit_id: u1, column: 'ctc' }])
ok(!r.ok && r.rejected[0].reason === 'no new value', 'missing after refused')
r = val.validateChanges([{ unit_id: u1, column: 'ctc', after: '12,34,567' }, { unit_id: u2, column: 'ctc', after: 5 }])
ok(!r.ok && r.rejected.length === 1 && r.rejected[0].unit_id === u1, 'one bad cell names that cell, and stops the save')
ok(!val.validateChanges([]).ok && !val.validateChanges(null).ok, 'empty / missing list refused')
ok(val.validateChanges(Array.from({ length: 500 }, (_, i) => ({ unit_id: u1, column: cols.EDITABLE[i % cols.EDITABLE.length] === 'chassis_no' ? 'notes' : 'notes', after: 'x' }))).ok === false, '500 of one cell: refused as duplicates')
ok(val.validateChanges(Array.from({ length: 501 }, () => ({}))).error?.includes('501 > 500'), '501 changes refused by count')
const many = Array.from({ length: 500 }, (_, i) => ({ unit_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, column: 'notes', after: 'x' }))
ok(val.validateChanges(many).ok === true, '500 different cells accepted')

// ── validateValues ──
let v = val.validateValues({ chassis_no: ' MB1X ', qty: '', road_tax_pct: null, ctc: '100' }, { requireChassis: true })
ok(v.ok && v.clean.chassis_no === 'MB1X' && !('qty' in v.clean) && !('road_tax_pct' in v.clean) && v.clean.ctc === 100, 'quick entry: blanks leave the defaults')
v = val.validateValues({ ctc: 1 }, { requireChassis: true })
ok(!v.ok && v.rejected[0].column === 'chassis_no', 'quick entry needs a chassis')
v = val.validateValues({ chassis_no: 'X', tcs: 5 }, { requireChassis: true })
ok(!v.ok && v.rejected[0].column === 'tcs', 'quick entry cannot set a computed column')
v = val.validateValues({ chassis_no: 'X', created_by: 'someone' }, { requireChassis: true })
ok(!v.ok, 'quick entry cannot set a system column')
v = val.validateValues({}, { requireChassis: false })
ok(v.ok && Object.keys(v.clean).length === 0, 'rebill with nothing new (chassis kept)')
ok(!val.validateValues([1], { requireChassis: false }).ok && !val.validateValues('x', { requireChassis: false }).ok, 'values must be an object')

// ── validateNewRows (createUnits) ──
let nr = val.validateNewRows([{ chassis_no: 'MB1A' }, { model: 'no chassis' }, { chassis_no: 'MB1B', ctc: '12,34,567' }, { chassis_no: 'MB1C', tcs: 1 }])
ok(nr.ok && nr.rows.length === 4, 'new rows: one result per row, in order')
ok(nr.ok && nr.rows[0].ok && nr.rows[0].clean.chassis_no === 'MB1A', 'new rows: a good row passes')
ok(nr.ok && !nr.rows[1].ok && nr.rows[1].rejected[0].column === 'chassis_no', 'new rows: no chassis is refused for that row only')
ok(nr.ok && !nr.rows[2].ok && nr.rows[2].rejected[0].column === 'ctc', 'new rows: lakh text refused (the adapter converts first)')
ok(nr.ok && !nr.rows[3].ok && nr.rows[3].rejected[0].column === 'tcs', 'new rows: a worked-out column is refused')
ok(!val.validateNewRows([]).ok && !val.validateNewRows('x').ok && !val.validateNewRows(null).ok, 'new rows: empty or not a list refused')
ok(val.validateNewRows(Array.from({ length: 200 }, (_, i) => ({ chassis_no: 'C' + i }))).ok, 'new rows: 200 allowed')
ok(!val.validateNewRows(Array.from({ length: 201 }, (_, i) => ({ chassis_no: 'C' + i }))).ok, 'new rows: 201 refused (database cap is 200)')
ok(val.MAX_NEW_ROWS === 200, 'new-row cap matches tracker_create_units')

// ── 4. Read plan ──
let p = val.planRead(['chassis_no', 'ctc', 'dsm_incentive', 'ageing_days'], false)
ok(p.ok && p.unitCols.includes('chassis_no') && p.unitCols.includes('id') && p.unitCols.includes('updated_at')
   && p.incentiveCols.length === 0 && eqSet(p.hidden, ['dsm_incentive']) && !p.unitCols.includes('ageing_days'),
   'non-HR: incentive hidden, screen column not read, identity always read')
p = val.planRead(['chassis_no', 'dsm_incentive', 'gm_incentive'], true)
ok(p.ok && eqSet(p.incentiveCols, ['dsm_incentive', 'gm_incentive']) && p.hidden.length === 0, 'HR/admin: incentives read')
ok(!val.planRead(['chasis_no'], true).ok, 'typo in a column name is an error, not an empty column')
ok(!val.planRead([], true).ok && !val.planRead('ctc', true).ok, 'columns must be a list')
ok(val.validateLayoutColumns(['ctc', 'dse_incentive', 'gm_incentive']) === null, 'layout may name screen + incentive columns')
ok(val.validateLayoutColumns(['ctc', 'nope']) !== null, 'layout with an unknown column refused')

// ── formats + request ids ──
ok(val.validateFormats([{ unit_id: u1, column_key: 'ctc', format: { bg: { rgb: '#FFFF00' } } }]).ok, 'a format')
ok(val.validateFormats([{ unit_id: u1, column_key: 'ctc', format: {} }]).ok, 'an empty format = cleared')
ok(!val.validateFormats([{ unit_id: u1, column_key: 'ctc', format: [] }]).ok, 'format must be an object')
ok(!val.validateFormats([{ unit_id: u1, column_key: 'ctc', format: { x: 'y'.repeat(3000) } }]).ok, 'oversized format refused')
ok(!val.validateFormats([{ unit_id: u1, column_key: 'ctc', format: {} }, { unit_id: u1, column_key: 'ctc', format: {} }]).ok, 'same cell twice refused')
ok(val.requestKey('A', 'req-12345') === 'A:req-12345' && val.requestKey('B', 'req-12345') === 'B:req-12345', 'request ids namespaced per person')
ok(val.requestKey('A', 'short') === null && val.requestKey('A', 7) === null && val.requestKey('A', 'x'.repeat(101)) === null, 'bad request ids refused')

console.log(`selftest-vehicle-units: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
