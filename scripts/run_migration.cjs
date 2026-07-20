// ─────────────────────────────────────────────────────────────────────────────
// run_migration.cjs
// Applies the Apr 2026 price list to Supabase via the JS client.
// Run: node scripts/run_migration.cjs
// ─────────────────────────────────────────────────────────────────────────────
const XLSX = require('xlsx')
const path = require('path')
const fs   = require('fs')

// Credentials come from the environment — never hardcode them here. This script
// writes with the service_role key, which bypasses RLS: point it at the wrong
// project and it silently rewrites that project's catalog.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=<key> node scripts/run_migration.cjs
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

const EXCEL = process.env.PRICE_LIST_XLSX
  || 'D:/PTB/Website/parastrucks/pricelist/AL_Vehicle_Price_List_Apr2026.xlsx'
const TABLE = 'vehicle_catalog'
const BATCH = 50

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in the environment.')
  process.exit(1)
}

// ── Load Supabase JS client (v2) ──────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
})

// ── Read Excel ────────────────────────────────────────────────────────────────
function priceCircular(seg) {
  return (seg === 'Bus – ICV' || seg === 'Bus – MCV') ? 'PC-155 (Apr 2026)' : 'Apr 2026 Circular'
}

const wb     = XLSX.readFile(EXCEL)
const ws     = wb.Sheets['Vehicle Price List']
const allRows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1)
  .filter(r => r[2] && r[5])
  .map(r => ({
    segment:    String(r[0] || '').trim(),
    sub_cat:    String(r[1] || '').trim(),
    cbn:        String(r[2] || '').trim(),
    desc:       String(r[3] || '').trim(),
    tyres:      String(r[4] || '').trim() || null,
    mrp:        parseInt(String(r[5]).replace(/[^0-9]/g, ''), 10),
  }))
  .filter(r => r.mrp > 0)

console.log(`Read ${allRows.length} rows from Excel`)

// ── Build deactivation list from old seed_vehicles.sql ───────────────────────
const SEED_SQL = path.join(__dirname, '..', 'seed_vehicles.sql')
const oldCBNs  = new Set()
if (fs.existsSync(SEED_SQL)) {
  const txt = fs.readFileSync(SEED_SQL, 'utf8')
  for (const m of txt.matchAll(/'([A-Z0-9_]+)',\s*'[^']+',\s*'[^']+'/g)) {
    oldCBNs.add(m[1])
  }
}
const newCBNSet  = new Set(allRows.map(r => r.cbn))
const deactivate = [...oldCBNs].filter(c => !newCBNSet.has(c))
console.log(`Old CBNs: ${oldCBNs.size} | New: ${allRows.length} | To deactivate: ${deactivate.length}`)

// ── Build upsert rows ─────────────────────────────────────────────────────────
const rows = allRows.map(r => ({
  cbn:            r.cbn,
  description:    r.desc,
  segment:        r.segment,
  sub_category:   r.sub_cat,
  tyres:          (r.tyres && r.tyres !== r.desc) ? r.tyres : null,
  mrp_incl_gst:   r.mrp,
  gst_rate:       18,
  price_circular: priceCircular(r.segment),
  effective_date: '2026-04-01',
  is_active:      true,
}))

// ── Helper: chunk array ───────────────────────────────────────────────────────
function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Upsert all active rows in batches
  const batches = chunk(rows, BATCH)
  let upserted  = 0
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i]
    const { error } = await supabase
      .from(TABLE)
      .upsert(b, { onConflict: 'cbn' })
    if (error) {
      console.error(`Batch ${i + 1} upsert error:`, error.message)
      process.exit(1)
    }
    upserted += b.length
    process.stdout.write(`\r  Upserted ${upserted}/${rows.length}...`)
  }
  console.log(`\n✓ Upserted ${upserted} rows`)

  // 2. Deactivate removed CBNs (in batches to avoid URL length limits)
  if (deactivate.length > 0) {
    const dBatches = chunk(deactivate, 50)
    let deactivated = 0
    for (const db of dBatches) {
      const { error } = await supabase
        .from(TABLE)
        .update({ is_active: false })
        .in('cbn', db)
      if (error) {
        console.error('Deactivate error:', error.message)
        process.exit(1)
      }
      deactivated += db.length
    }
    console.log(`✓ Deactivated ${deactivated} CBNs`)
  } else {
    console.log('✓ No CBNs to deactivate')
  }

  // 3. Verify final count
  const { count, error: ce } = await supabase
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
  if (ce) { console.error('Count check error:', ce.message); return }
  console.log(`✓ Active rows in DB: ${count} (expected 797)`)
}

main().catch(e => { console.error(e); process.exit(1) })
