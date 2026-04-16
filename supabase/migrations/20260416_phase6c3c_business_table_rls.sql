-- Phase 6c.3 — business-table RLS (plan 6b.1.2)
-- ============================================================
-- Replaces the flat "admin/back_office" write gates with scoped policies
-- keyed on the 4-axis columns + user_brands / user_sales_verticals.
-- Admin bypass is preserved via current_user_role() = 'admin'.
--
-- Helper functions:
--   is_hr_same_entity(uuid)    : caller is HR and shares the target entity
--   has_user_brand(uuid)       : caller has this brand in user_brands
--   has_user_sales_vertical(uuid): caller has this vertical in user_sales_verticals
--
-- Covered tables:
--   quotations          : scoped SELECT (admin OR own OR entity+brand),
--                         own-row INSERT, admin-only UPDATE/DELETE
--   vehicle_catalog     : scoped SELECT (admin OR user_brands ∩
--                         (back_office OR vertical IS NULL OR user_sales_verticals)),
--                         INSERT/UPDATE (admin OR back_office+brand)
--   tiv_forecast_* × 7  : scoped SELECT (admin OR own-entity+brand),
--                         admin-only writes
--   users               : scoped SELECT (admin OR self OR HR-same-entity),
--                         INSERT/UPDATE (admin OR HR-same-entity + self-update),
--                         admin-only DELETE
--
-- user_profiles already uses current_user_role() directly from Stage 1;
-- no changes needed here.

create or replace function public.is_hr_same_entity(target_entity uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.users u
    left join public.departments d on d.id = u.department_id
    where u.id = auth.uid()
      and u.is_active = true
      and d.code = 'hr'
      and u.entity_id is not null
      and u.entity_id = target_entity
  )
$$;

create or replace function public.has_user_brand(p_brand uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_brands
    where user_id = auth.uid() and brand_id = p_brand
  )
$$;

create or replace function public.has_user_sales_vertical(p_vert uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_sales_verticals
    where user_id = auth.uid() and vertical_id = p_vert
  )
$$;

-- quotations
drop policy if exists quotations_select_admin on public.quotations;
drop policy if exists quotations_select_own   on public.quotations;
drop policy if exists quotations_update       on public.quotations;
drop policy if exists quotations_delete       on public.quotations;
drop policy if exists quotations_insert       on public.quotations;

create policy quotations_select on public.quotations
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or created_by = auth.uid()
    or (
      quotations.entity_id = (select entity_id from public.users where id = auth.uid())
      and public.has_user_brand(quotations.brand_id)
    )
  );

create policy quotations_insert on public.quotations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy quotations_update on public.quotations
  for update to authenticated
  using      (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy quotations_delete on public.quotations
  for delete to authenticated
  using (public.current_user_role() = 'admin');

-- vehicle_catalog
drop policy if exists catalog_select_all on public.vehicle_catalog;
drop policy if exists catalog_write       on public.vehicle_catalog;

create policy vehicle_catalog_select on public.vehicle_catalog
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or (
      public.has_user_brand(vehicle_catalog.brand_id)
      and (
        public.current_user_role() = 'back_office'
        or vehicle_catalog.sales_vertical_id is null
        or public.has_user_sales_vertical(vehicle_catalog.sales_vertical_id)
      )
    )
  );

create policy vehicle_catalog_insert on public.vehicle_catalog
  for insert to authenticated
  with check (
    public.current_user_role() = 'admin'
    or (public.current_user_role() = 'back_office' and public.has_user_brand(vehicle_catalog.brand_id))
  );

create policy vehicle_catalog_update on public.vehicle_catalog
  for update to authenticated
  using (
    public.current_user_role() = 'admin'
    or (public.current_user_role() = 'back_office' and public.has_user_brand(vehicle_catalog.brand_id))
  )
  with check (
    public.current_user_role() = 'admin'
    or (public.current_user_role() = 'back_office' and public.has_user_brand(vehicle_catalog.brand_id))
  );

-- DELETE on vehicle_catalog deliberately not exposed — is_active toggle is the
-- soft-delete path.

-- tiv_forecast_* — 7 tables
do $$
declare
  t     text;
  short text;
begin
  foreach t in array array[
    'tiv_forecast_tiv_actuals',
    'tiv_forecast_ptb_actuals',
    'tiv_forecast_al_actuals',
    'tiv_forecast_judgment_tiv',
    'tiv_forecast_judgment_ptb',
    'tiv_forecast_raw_data',
    'tiv_forecast_model_params'
  ] loop
    short := replace(t, 'tiv_forecast_', '');
    execute format('drop policy if exists %I on public.%I', short || '_read',  t);
    execute format('drop policy if exists %I on public.%I', short || '_write', t);
    execute format('drop policy if exists %I on public.%I', t    || '_select', t);
    execute format('drop policy if exists %I on public.%I', t    || '_write',  t);

    execute format($q$
      create policy %I on public.%I
        for select to authenticated
        using (
          public.current_user_role() = 'admin'
          or (
            entity_id = (select entity_id from public.users where id = auth.uid())
            and public.has_user_brand(brand_id)
          )
        )
    $q$, t || '_select', t);

    execute format($q$
      create policy %I on public.%I
        for all to authenticated
        using      (public.current_user_role() = 'admin')
        with check (public.current_user_role() = 'admin')
    $q$, t || '_write', t);
  end loop;
end $$;

-- users
drop policy if exists users_select_hr    on public.users;
drop policy if exists users_select_own   on public.users;
drop policy if exists users_insert_hr    on public.users;
drop policy if exists users_update_hr    on public.users;
drop policy if exists users_delete_admin on public.users;

create policy users_select on public.users
  for select to authenticated
  using (
    public.current_user_role() = 'admin'
    or id = auth.uid()
    or public.is_hr_same_entity(entity_id)
  );

create policy users_insert on public.users
  for insert to authenticated
  with check (
    public.current_user_role() = 'admin'
    or public.is_hr_same_entity(entity_id)
  );

create policy users_update on public.users
  for update to authenticated
  using (
    public.current_user_role() = 'admin'
    or public.is_hr_same_entity(entity_id)
    or id = auth.uid()
  )
  with check (
    public.current_user_role() = 'admin'
    or public.is_hr_same_entity(entity_id)
    or id = auth.uid()
  );

create policy users_delete on public.users
  for delete to authenticated
  using (public.current_user_role() = 'admin');
