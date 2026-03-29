-- ============================================================
-- PARAS PORTAL — Supabase SQL Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
-- Note: Supabase auth.users stores credentials.
-- This table stores the business profile, linked by UUID.

CREATE TABLE public.users (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT UNIQUE NOT NULL,
  full_name    TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin','hr','back_office','sales')),
  location     TEXT,
  department   TEXT,
  vertical     TEXT,
  designation  TEXT,
  entity       TEXT CHECK (entity IN ('PT','PTB')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── ENTITIES ─────────────────────────────────────────────────
CREATE TABLE public.entities (
  code            TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  address         TEXT NOT NULL,
  gstin           TEXT NOT NULL,
  bank_name       TEXT NOT NULL,
  bank_account    TEXT NOT NULL,
  bank_ifsc       TEXT NOT NULL,
  serial_counter  INTEGER NOT NULL DEFAULT 0,
  fy_start        INTEGER NOT NULL DEFAULT 2025  -- tracks which FY the counter belongs to
);

-- PTB seed data
INSERT INTO public.entities (code, full_name, address, gstin, bank_name, bank_account, bank_ifsc, serial_counter) VALUES (
  'PTB',
  'PARAS TRUCKS AND BUSES',
  'Survey No. 271P, SP Ring Road, Near Concept Motors, Sanathal Circle, Sanathal, Ahmedabad - 382210',
  '24ABCFP3133C1ZV',
  'PUNJAB NATIONAL BANK , SRIGANGANAGAR',
  '3959008700003398',
  'PUNB0395900',
  350  -- counter starts at 350 so next quotation is PTB/25-26/0351
);

-- PT seed data (fill in when details are available)
-- INSERT INTO public.entities (code, full_name, address, gstin, bank_name, bank_account, bank_ifsc, serial_counter) VALUES (
--   'PT', 'PARAS TRUCKS', '...', '...', '...', '...', '...', 0
-- );

-- ── VEHICLE CATALOG ──────────────────────────────────────────
CREATE TABLE public.vehicle_catalog (
  id              SERIAL PRIMARY KEY,
  cbn             TEXT UNIQUE NOT NULL,
  description     TEXT NOT NULL,
  segment         TEXT NOT NULL,  -- 'Buses', 'ICV Trucks', 'Long Haul', 'Tippers', 'Tractors'
  tyres           TEXT,
  base_price      INTEGER NOT NULL,  -- AL to Dealer price
  dealer_markup   INTEGER NOT NULL,
  mrp_incl_gst    INTEGER NOT NULL,
  gst_rate        DECIMAL NOT NULL DEFAULT 18,
  price_circular  TEXT,
  effective_date  DATE,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

-- Indexes for fast fuzzy search
CREATE INDEX idx_catalog_cbn         ON public.vehicle_catalog (cbn);
CREATE INDEX idx_catalog_segment     ON public.vehicle_catalog (segment);
CREATE INDEX idx_catalog_description ON public.vehicle_catalog USING gin(to_tsvector('english', description));

-- ── QUOTATIONS ───────────────────────────────────────────────
CREATE TABLE public.quotations (
  id                SERIAL PRIMARY KEY,
  quotation_number  TEXT UNIQUE NOT NULL,
  entity            TEXT NOT NULL REFERENCES public.entities(code),
  created_by        UUID NOT NULL REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until       DATE NOT NULL,
  customer_name     TEXT NOT NULL,
  customer_address  TEXT,
  customer_mobile   TEXT,
  customer_gstin    TEXT,
  hypothecation     TEXT,
  line_items        JSONB NOT NULL,
  -- line_items structure:
  -- [{ cbn, description, tyres, qty, mrp, basic_amt, gst_amt, total_cost }]
  tcs_rate          DECIMAL NOT NULL DEFAULT 1,
  tcs_amount        INTEGER,
  rto_tax           INTEGER,  -- nullable
  insurance         INTEGER,  -- nullable
  grand_total       INTEGER NOT NULL
);

CREATE INDEX idx_quotations_created_by ON public.quotations (created_by);
CREATE INDEX idx_quotations_entity     ON public.quotations (entity);
CREATE INDEX idx_quotations_created_at ON public.quotations (created_at DESC);

-- ── ACCESS RULES ─────────────────────────────────────────────
CREATE TABLE public.access_rules (
  id               SERIAL PRIMARY KEY,
  tool_id          TEXT NOT NULL,
  condition_field  TEXT NOT NULL,   -- 'role', 'department', 'vertical', etc.
  condition_value  TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true
);

-- Default access rules
INSERT INTO public.access_rules (tool_id, condition_field, condition_value) VALUES
  ('truck_quotation',  'role',       'sales'),
  ('truck_quotation',  'role',       'back_office'),
  ('truck_quotation',  'role',       'admin'),
  ('bus_calculator',   'vertical',   'Bus'),
  ('bus_calculator',   'role',       'admin'),
  ('user_management',  'role',       'hr'),
  ('user_management',  'role',       'admin'),
  ('quotation_log',    'role',       'admin'),
  ('vehicle_catalog',  'role',       'admin'),
  ('vehicle_catalog',  'role',       'back_office');

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_rules   ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$;

-- USERS: Everyone can read their own row.
-- HR and Admin can read all rows.
CREATE POLICY "users_select_own"     ON public.users FOR SELECT USING (id = auth.uid());
CREATE POLICY "users_select_hr"      ON public.users FOR SELECT USING (public.current_user_role() IN ('hr','admin'));
CREATE POLICY "users_insert_hr"      ON public.users FOR INSERT WITH CHECK (public.current_user_role() IN ('hr','admin'));
CREATE POLICY "users_update_hr"      ON public.users FOR UPDATE USING (public.current_user_role() IN ('hr','admin'));
CREATE POLICY "users_delete_admin"   ON public.users FOR DELETE USING (public.current_user_role() = 'admin');

-- ENTITIES: All authenticated users can read. Admin only can write.
CREATE POLICY "entities_select_all"  ON public.entities FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "entities_write_admin" ON public.entities FOR ALL USING (public.current_user_role() = 'admin');

-- VEHICLE CATALOG: All authenticated users can read active models.
-- Admin and Back Office can write.
CREATE POLICY "catalog_select_all"   ON public.vehicle_catalog FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "catalog_write"        ON public.vehicle_catalog FOR ALL USING (public.current_user_role() IN ('admin','back_office'));

-- QUOTATIONS: Users see own quotations. Admin sees all.
CREATE POLICY "quotations_select_own"   ON public.quotations FOR SELECT USING (created_by = auth.uid());
CREATE POLICY "quotations_select_admin" ON public.quotations FOR SELECT USING (public.current_user_role() = 'admin');
CREATE POLICY "quotations_insert"       ON public.quotations FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "quotations_update_own"   ON public.quotations FOR UPDATE USING (created_by = auth.uid());

-- ACCESS RULES: All authenticated users can read. Admin only can write.
CREATE POLICY "rules_select_all"  ON public.access_rules FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "rules_write_admin" ON public.access_rules FOR ALL USING (public.current_user_role() = 'admin');

-- ── QUOTATION NUMBER FUNCTION ─────────────────────────────────
-- Atomically increments entity counter and returns the new quotation number.
-- Call this from the app to get the next serial before inserting a quotation.
CREATE OR REPLACE FUNCTION public.next_quotation_number(p_entity TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_counter INTEGER;
  v_fy      TEXT;
  v_year    INTEGER;
  v_month   INTEGER;
BEGIN
  -- Determine current financial year (April–March)
  v_year  := EXTRACT(YEAR FROM now())::INTEGER;
  v_month := EXTRACT(MONTH FROM now())::INTEGER;
  IF v_month < 4 THEN
    v_fy := (v_year - 1)::TEXT || '-' || RIGHT(v_year::TEXT, 2);
  ELSE
    v_fy := v_year::TEXT || '-' || RIGHT((v_year + 1)::TEXT, 2);
  END IF;

  -- Reset counter if new financial year
  UPDATE public.entities
  SET serial_counter = CASE WHEN fy_start != EXTRACT(YEAR FROM now())::INTEGER
                              AND EXTRACT(MONTH FROM now())::INTEGER >= 4
                            THEN 1
                            ELSE serial_counter + 1
                       END,
      fy_start = CASE WHEN EXTRACT(MONTH FROM now())::INTEGER >= 4
                      THEN EXTRACT(YEAR FROM now())::INTEGER
                      ELSE fy_start
                 END
  WHERE code = p_entity
  RETURNING serial_counter INTO v_counter;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entity % not found', p_entity;
  END IF;

  RETURN p_entity || '/' || v_fy || '/' || LPAD(v_counter::TEXT, 4, '0');
END;
$$;
