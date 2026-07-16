// Deactivates any vehicle_catalog rows whose CBN is not in the Apr 2026 price list
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

// Credentials come from the environment — never hardcode them here. This script
// writes with the service_role key, which bypasses RLS: point it at the wrong
// project and it silently rewrites that project's catalog.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=<key> node scripts/fix_inactive.cjs
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const EXCEL        = process.env.PRICE_LIST_XLSX
  || 'D:/PTB/Website/parastrucks/pricelist/AL_Vehicle_Price_List_Apr2026.xlsx'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in the environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function main() {
  // 1. Build Apr 2026 CBN set
  const wb  = XLSX.readFile(EXCEL)
  const ws  = wb.Sheets['Vehicle Price List']
  const apr2026 = new Set(
    XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1)
      .filter(r => r[2] && r[5])
      .map(r => String(r[2]).trim())
  )
  console.log(`Apr 2026 CBNs: ${apr2026.size}`)

  // 2. Fetch all currently-active CBNs from DB (paginate)
  const PAGE = 1000
  let all = [], from = 0
  while (true) {
    const { data, error } = await supabase
      .from('vehicle_catalog')
      .select('cbn')
      .eq('is_active', true)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Fetch error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    all.push(...data.map(r => r.cbn))
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`Active CBNs in DB: ${all.length}`)

  // 3. Find those NOT in Apr 2026 list
  const toDeactivate = all.filter(c => !apr2026.has(c))
  console.log(`CBNs to deactivate: ${toDeactivate.length}`)
  if (toDeactivate.length === 0) { console.log('Nothing to do.'); return }

  // 4. Deactivate in batches of 50
  for (const batch of chunk(toDeactivate, 50)) {
    const { error } = await supabase
      .from('vehicle_catalog')
      .update({ is_active: false })
      .in('cbn', batch)
    if (error) { console.error('Deactivate error:', error.message); process.exit(1) }
  }
  console.log(`✓ Deactivated ${toDeactivate.length} CBNs`)

  // 5. Final count
  const { count, error: ce } = await supabase
    .from('vehicle_catalog')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
  if (ce) { console.error(ce.message); return }
  console.log(`✓ Final active count: ${count} (expected 797)`)
}

main().catch(e => { console.error(e); process.exit(1) })
