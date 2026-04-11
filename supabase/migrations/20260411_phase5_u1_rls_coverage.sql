-- Phase 5 U1 — RLS coverage audit
-- Ensures every public-schema table has appropriate policies.
-- RLS is already enabled on every public table; this migration adds the
-- missing write policies for reference tables, extends TIV forecast write
-- access from admin-only to admin+back_office, and rounds out quotations
-- with proper update/delete policies.
--
-- Policy model:
--   SELECT : authenticated (reference tables, vehicle_catalog, TIV forecast)
--   Writes : current_user_role() in ('admin','back_office')
--   quotations SELECT: user's own rows OR admin/back_office
--   quotations writes: user INSERT own; admin/back_office UPDATE/DELETE
--
-- current_user_role() is the existing SECURITY DEFINER helper that returns
-- public.users.role (the permission level — not users.vertical).
--
-- access_rules, users, entities, error_log keep their existing policies.

------------------------------------------------------------------------
-- 1. Reference / catalog tables: add admin+back_office write policies
------------------------------------------------------------------------

-- brands
drop policy if exists brands_insert on public.brands;
drop policy if exists brands_update on public.brands;
drop policy if exists brands_delete on public.brands;
create policy brands_insert on public.brands
  for insert to authenticated
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy brands_update on public.brands
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy brands_delete on public.brands
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

-- locations
drop policy if exists locations_insert on public.locations;
drop policy if exists locations_update on public.locations;
drop policy if exists locations_delete on public.locations;
create policy locations_insert on public.locations
  for insert to authenticated
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy locations_update on public.locations
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy locations_delete on public.locations
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

-- departments
drop policy if exists departments_insert on public.departments;
drop policy if exists departments_update on public.departments;
drop policy if exists departments_delete on public.departments;
create policy departments_insert on public.departments
  for insert to authenticated
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy departments_update on public.departments
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy departments_delete on public.departments
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

-- roles
drop policy if exists roles_insert on public.roles;
drop policy if exists roles_update on public.roles;
drop policy if exists roles_delete on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy roles_update on public.roles
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy roles_delete on public.roles
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

-- operating_units
drop policy if exists operating_units_insert on public.operating_units;
drop policy if exists operating_units_update on public.operating_units;
drop policy if exists operating_units_delete on public.operating_units;
create policy operating_units_insert on public.operating_units
  for insert to authenticated
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy operating_units_update on public.operating_units
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));
create policy operating_units_delete on public.operating_units
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

------------------------------------------------------------------------
-- 2. TIV forecast tables: extend writes from admin-only to admin+back_office
------------------------------------------------------------------------
-- Reads remain open to any authenticated user (existing policies).
-- tiv_forecast_trigger_state is per-user (user_id = auth.uid()) and stays
-- unchanged.

drop policy if exists tiv_actuals_write on public.tiv_forecast_tiv_actuals;
create policy tiv_actuals_write on public.tiv_forecast_tiv_actuals
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists ptb_actuals_write on public.tiv_forecast_ptb_actuals;
create policy ptb_actuals_write on public.tiv_forecast_ptb_actuals
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists al_actuals_write on public.tiv_forecast_al_actuals;
create policy al_actuals_write on public.tiv_forecast_al_actuals
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists judgment_tiv_write on public.tiv_forecast_judgment_tiv;
create policy judgment_tiv_write on public.tiv_forecast_judgment_tiv
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists judgment_ptb_write on public.tiv_forecast_judgment_ptb;
create policy judgment_ptb_write on public.tiv_forecast_judgment_ptb
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists raw_data_write on public.tiv_forecast_raw_data;
create policy raw_data_write on public.tiv_forecast_raw_data
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists model_params_write on public.tiv_forecast_model_params;
create policy model_params_write on public.tiv_forecast_model_params
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

drop policy if exists upload_history_write on public.tiv_forecast_upload_history;
create policy upload_history_write on public.tiv_forecast_upload_history
  for all to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

------------------------------------------------------------------------
-- 3. Quotations: round out RLS with proper update/delete + admin select
------------------------------------------------------------------------
-- Preserved as-is:
--   quotations_select_own (created_by = auth.uid())
--   quotations_insert     (with check created_by = auth.uid())

-- SELECT admin+back_office (was admin-only)
drop policy if exists quotations_select_admin on public.quotations;
create policy quotations_select_admin on public.quotations
  for select to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));

-- UPDATE: admin+back_office (replaces quotations_update_own)
drop policy if exists quotations_update_own on public.quotations;
drop policy if exists quotations_update on public.quotations;
create policy quotations_update on public.quotations
  for update to authenticated
  using (public.current_user_role() = any (array['admin','back_office']))
  with check (public.current_user_role() = any (array['admin','back_office']));

-- DELETE: admin+back_office (was missing)
drop policy if exists quotations_delete on public.quotations;
create policy quotations_delete on public.quotations
  for delete to authenticated
  using (public.current_user_role() = any (array['admin','back_office']));
