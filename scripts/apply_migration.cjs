// Apply vehicle_catalog schema migration + seed to live Supabase project
// Usage: node scripts/apply_migration.cjs <personal-access-token>
//   Get token from: https://supabase.com/dashboard/account/tokens

const https = require('https')
const fs    = require('fs')
const path  = require('path')

const PROJECT_REF = 'mmmxvjaavdtwlpcnjgzy'
const token = process.argv[2]

if (!token) {
  console.error('Usage: node scripts/apply_migration.cjs <personal-access-token>')
  console.error('Get token from: https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

// ── Migration SQL ─────────────────────────────────────────────────────────────
const MIGRATION = `
-- Drop old price columns that no longer exist in the price list
ALTER TABLE public.vehicle_catalog
  DROP COLUMN IF EXISTS base_price,
  DROP COLUMN IF EXISTS dealer_markup;

-- Update GIN index (recreate to ensure it exists)
DROP INDEX IF EXISTS idx_catalog_description;
CREATE INDEX IF NOT EXISTS idx_catalog_description
  ON public.vehicle_catalog USING gin(to_tsvector('english', description));
`

// ── Seed SQL ──────────────────────────────────────────────────────────────────
const SEED_FILE = path.join(__dirname, '..', 'seed_vehicles.sql')
const SEED = fs.readFileSync(SEED_FILE, 'utf8')

// ── Execute SQL via Management API ────────────────────────────────────────────
function runSQL(label, sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✓ ${label}`)
          resolve(JSON.parse(data))
        } else {
          console.error(`✗ ${label} — HTTP ${res.statusCode}`)
          console.error(data)
          reject(new Error(`HTTP ${res.statusCode}`))
        }
      })
    })

    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  console.log('Applying migration to project:', PROJECT_REF)
  await runSQL('Schema migration (drop old columns)', MIGRATION)
  await runSQL('Seed — TRUNCATE + 815 vehicle rows', SEED)
  console.log('\nDone.')
}

main().catch(err => {
  console.error('Failed:', err.message)
  process.exit(1)
})
