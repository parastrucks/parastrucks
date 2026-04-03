// Creates the access_rules table and seeds it with current permissions
// Usage: node scripts/create_access_rules.cjs <personal-access-token>
// Get token from: https://supabase.com/dashboard/account/tokens

const https = require('https')

const PROJECT_REF = 'mmmxvjaavdtwlpcnjgzy'
const token = process.argv[2]

if (!token) {
  console.error('Usage: node scripts/create_access_rules.cjs <personal-access-token>')
  process.exit(1)
}

const SQL = `
-- Create access_rules table
CREATE TABLE IF NOT EXISTS public.access_rules (
  route TEXT NOT NULL,
  role  TEXT NOT NULL,
  PRIMARY KEY (route, role)
);

-- Enable RLS
ALTER TABLE public.access_rules ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read rules (needed by AuthContext)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'access_rules' AND policyname = 'auth_read_access_rules'
  ) THEN
    CREATE POLICY "auth_read_access_rules"
      ON public.access_rules FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Seed with current rules (mirrors what was hardcoded in App.jsx)
INSERT INTO public.access_rules (route, role) VALUES
  ('/quotation',      'sales'),
  ('/quotation',      'back_office'),
  ('/quotation',      'admin'),
  ('/my-quotations',  'sales'),
  ('/my-quotations',  'back_office'),
  ('/my-quotations',  'admin'),
  ('/quotation-log',  'admin'),
  ('/employees',      'hr'),
  ('/employees',      'admin'),
  ('/catalog',        'admin'),
  ('/catalog',        'back_office'),
  ('/bus-calculator', 'sales'),
  ('/bus-calculator', 'back_office'),
  ('/bus-calculator', 'admin')
ON CONFLICT DO NOTHING;
`

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data))
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  console.log('Creating access_rules table and seeding...')
  try {
    await runQuery(SQL)
    console.log('Done. access_rules table is ready.')
  } catch (err) {
    console.error('Failed:', err.message)
    process.exit(1)
  }
}

main()
