-- Phase 9.5 follow-up (2026-06-29) — close an anon-execute gap on create_service_job().
--
-- The original 20260625_phase95_service_jobs.sql revoked EXECUTE on the SECURITY
-- DEFINER RPC create_service_job() from `public` and `authenticated`, but Supabase
-- grants EXECUTE to the `anon` role on function creation and that direct grant
-- survived the `revoke ... from public`. Because the anon key ships in the client
-- bundle, an unauthenticated caller could POST to /rest/v1/rpc/create_service_job
-- with a forged p_created_by / p_entity_id / p_job and insert service_jobs rows
-- (and burn fiscal-year PO numbers) directly — bypassing the service-jobs Edge
-- Function's per-action authority + entity-ownership checks.
--
-- Fix: revoke it from `anon` too. Only service_role (the Edge Function) may call it.
-- Applied to prod (mmmxvjaavdtwlpcnjgzy) and staging (klpnhpnlotcbbovwswmq) as
-- migration `phase95_revoke_anon_create_service_job`.

revoke all on function public.create_service_job(uuid, text, text, uuid, uuid, jsonb) from anon;
