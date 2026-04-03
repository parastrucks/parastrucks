// Phase 2 Foundation — Multi-brand / multi-location data model
// Usage: node scripts/phase2_foundation.cjs <personal-access-token>
// Get token: https://supabase.com/dashboard/account/tokens

const https = require('https')

const PROJECT_REF = 'mmmxvjaavdtwlpcnjgzy'
const token = process.argv[2]
if (!token) { console.error('Usage: node scripts/phase2_foundation.cjs <token>'); process.exit(1) }

const SQL = `
BEGIN;

-- ── BRANDS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brands (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  short_name    TEXT,
  logo_path     TEXT,
  primary_color TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='brands' AND policyname='auth_read_brands') THEN
    CREATE POLICY "auth_read_brands" ON public.brands FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
INSERT INTO public.brands (code, name, short_name, logo_path, primary_color) VALUES
  ('al',     'Ashok Leyland',   'AL',     '/ashok-leyland-logo.svg',   '#CC0000'),
  ('switch', 'Switch Mobility', 'Switch', '/switch-mobility-logo.svg', '#00A650'),
  ('hdh',    'HD Hyundai CE',   'HDH',    '/hd-hyundai-logo.svg',      '#003087')
ON CONFLICT DO NOTHING;

-- ── ROLES (product verticals — what the user sells) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  name      TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='roles' AND policyname='auth_read_roles') THEN
    CREATE POLICY "auth_read_roles" ON public.roles FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
INSERT INTO public.roles (name, label) VALUES
  ('bus',       'Bus'),
  ('tipper',    'Tipper'),
  ('icv',       'ICV'),
  ('long_haul', 'Long Haul'),
  ('ce',        'Construction Equipment')
ON CONFLICT DO NOTHING;

-- ── LOCATIONS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.locations (
  name      TEXT PRIMARY KEY,
  state     TEXT NOT NULL,
  entity    TEXT NOT NULL,   -- links to entities.code for quotation numbering
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='locations' AND policyname='auth_read_locations') THEN
    CREATE POLICY "auth_read_locations" ON public.locations FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
INSERT INTO public.locations (name, state, entity) VALUES
  ('Ahmedabad',     'Gujarat', 'PTB'),
  ('Anand',         'Gujarat', 'PTB'),
  ('Hisar',         'Haryana', 'PT'),
  ('Rohtak',        'Haryana', 'PT'),
  ('Sirsa',         'Haryana', 'PT'),
  ('Jind',          'Haryana', 'PT'),
  ('Charkhi Dadri', 'Haryana', 'PT'),
  ('Karnal',        'Haryana', 'PT')
ON CONFLICT DO NOTHING;

-- ── DEPARTMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  name      TEXT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='departments' AND policyname='auth_read_departments') THEN
    CREATE POLICY "auth_read_departments" ON public.departments FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
INSERT INTO public.departments (name) VALUES
  ('Sales'),
  ('Service'),
  ('Spare Parts'),
  ('Admin'),
  ('HR'),
  ('Accounts')
ON CONFLICT DO NOTHING;

-- ── OPERATING UNITS ───────────────────────────────────────────────────────────
-- One row per brand × location combination. Stores entity details used in PDFs.
CREATE TABLE IF NOT EXISTS public.operating_units (
  id           SERIAL PRIMARY KEY,
  brand        TEXT NOT NULL,
  location     TEXT NOT NULL,
  entity_code  TEXT,          -- references entities.code for quotation numbering
  full_name    TEXT,
  address      TEXT,
  gstin        TEXT,
  bank_account TEXT,
  bank_name    TEXT,
  bank_ifsc    TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(brand, location)
);
ALTER TABLE public.operating_units ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='operating_units' AND policyname='auth_read_operating_units') THEN
    CREATE POLICY "auth_read_operating_units" ON public.operating_units FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
-- Seed AL-Ahmedabad by copying the existing PTB entity data
INSERT INTO public.operating_units (brand, location, entity_code, full_name, address, gstin, bank_account, bank_name, bank_ifsc)
SELECT 'al', 'Ahmedabad', code, full_name, address, gstin, bank_account, bank_name, bank_ifsc
FROM public.entities WHERE code = 'PTB'
ON CONFLICT DO NOTHING;

-- ── ALTER USERS: add brand column ─────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS brand TEXT;

-- ── RECREATE ACCESS RULES ─────────────────────────────────────────────────────
-- New schema: multi-dimensional rules. All dimension columns are nullable (null = any).
-- permission_level maps to users.role (admin/hr/sales/back_office)
-- role maps to users.vertical (bus/tipper/icv/long_haul/ce)
DROP TABLE IF EXISTS public.access_rules;
CREATE TABLE public.access_rules (
  id               SERIAL PRIMARY KEY,
  route            TEXT NOT NULL,
  permission_level TEXT,   -- 'admin'|'hr'|'sales'|'back_office'  — null = any
  brand            TEXT,   -- 'al'|'switch'|'hdh'|...              — null = any
  location         TEXT,   -- 'Ahmedabad'|'Hisar'|...              — null = any
  department       TEXT,   -- 'Sales'|'Service'|...                — null = any
  role             TEXT    -- 'bus'|'tipper'|'icv'|'long_haul'|... — null = any
);
ALTER TABLE public.access_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_access_rules" ON public.access_rules FOR SELECT TO authenticated USING (true);

-- HR & admin tools (permission-level based — not brand/location specific)
INSERT INTO public.access_rules (route, permission_level) VALUES
  ('/employees',     'hr'),
  ('/employees',     'admin'),
  ('/quotation-log', 'admin'),
  ('/catalog',       'admin'),
  ('/catalog',       'back_office');

-- Back-office & admin: access all quotation tools regardless of brand/location
INSERT INTO public.access_rules (route, permission_level) VALUES
  ('/quotation',      'back_office'),
  ('/my-quotations',  'back_office'),
  ('/quotation',      'admin'),
  ('/my-quotations',  'admin'),
  ('/bus-calculator', 'admin'),
  ('/bus-calculator', 'back_office');

-- AL-Ahmedabad Sales: access quotation tools (all product roles)
INSERT INTO public.access_rules (route, brand, location, department) VALUES
  ('/quotation',     'al', 'Ahmedabad', 'Sales'),
  ('/my-quotations', 'al', 'Ahmedabad', 'Sales');

-- AL Sales + Bus role: access bus calculator (all locations)
INSERT INTO public.access_rules (route, brand, department, role) VALUES
  ('/bus-calculator', 'al', 'Sales', 'bus');

COMMIT;
`

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql })
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data))
        else reject(new Error(`HTTP ${res.statusCode}: ${data}`))
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function main() {
  console.log('Applying Phase 2 foundation migration…')
  try {
    await runQuery(SQL)
    console.log('Done.')
    console.log('  ✓ brands, roles, locations, departments tables created')
    console.log('  ✓ operating_units table created (AL-Ahmedabad seeded from entities.PTB)')
    console.log('  ✓ users.brand column added')
    console.log('  ✓ access_rules recreated with multi-dimensional schema')
  } catch (err) {
    console.error('Failed:', err.message)
    process.exit(1)
  }
}

main()
