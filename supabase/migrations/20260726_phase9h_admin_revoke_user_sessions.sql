-- Phase 9h (2026-07-26) — DB-level session revoke to fix adminLogoutUser.
--
-- The old adminLogoutUser (supabase/functions/_shared/auditLog.ts) called the
-- GoTrue REST endpoint POST /auth/v1/admin/users/{id}/logout, which returns 404
-- in this project's GoTrue version. So "force-logout on deactivation" (Phase 9e
-- H4) has silently never worked — the fetch 404'd, the failure was swallowed, and
-- the caller still returned ok. The RLS is_active gate (Phase 9d) has been the only
-- thing actually locking a deactivated user out.
--
-- Fix: a SECURITY DEFINER RPC that deletes the user's rows from auth.sessions.
-- Deleting a session cascades to auth.refresh_tokens (FK ON DELETE CASCADE), so the
-- user can no longer obtain a fresh access token. This does NOT invalidate an
-- already-issued access token — an ES256 JWT stays valid until it expires (~1h) —
-- so this remains best-effort; the RLS is_active gate is still the real guard.
--
-- Locked down to service_role only (called by the admin-users Edge Function via its
-- service-role client). anon/authenticated/PUBLIC get nothing — same discipline as
-- create_service_job and the numbering RPCs.
--
-- Rollback: drop function public.admin_revoke_user_sessions(uuid);
-- Apply to staging (klpnhpnlotcbbovwswmq) FIRST, rehearse, then prod (mmmxvjaavdtwlpcnjgzy)
-- as migration `phase9h_admin_revoke_user_sessions`.

begin;

create or replace function public.admin_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;   -- sessions removed (0 if the user had none)
  return v_count;
end;
$$;

revoke all    on function public.admin_revoke_user_sessions(uuid) from public;
revoke all    on function public.admin_revoke_user_sessions(uuid) from anon;
revoke all    on function public.admin_revoke_user_sessions(uuid) from authenticated;
grant  execute on function public.admin_revoke_user_sessions(uuid) to service_role;

commit;

-- ── Verify after applying ──
-- 1) Grants (expect ONLY service_role=X, no anon/authenticated/PUBLIC):
--    select coalesce(array_to_string(proacl, E'\n'),'(default PUBLIC)')
--    from pg_proc where proname='admin_revoke_user_sessions';
-- 2) Live behaviour (returns the count; safe to run for a real user id):
--    select public.admin_revoke_user_sessions('<user-uuid>'::uuid);
