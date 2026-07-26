-- Security follow-up (2026-07-26) — close an anon-execute gap on the two
-- document-numbering RPCs: next_proforma_number() and next_financier_copy_number().
--
-- Both are SECURITY DEFINER functions created in 20260418_phase7b_proforma_invoices.sql
-- and 20260419_phase8_financier_copies.sql WITHOUT any EXECUTE lockdown. In this
-- project a fresh function ends up reachable by `anon` two independent ways:
--   1. the Postgres built-in EXECUTE grant to PUBLIC on function creation, and
--   2. Supabase's default-privileges direct EXECUTE grant to the `anon` role.
-- Because the anon/publishable key ships in the client bundle, an unauthenticated
-- caller could POST to /rest/v1/rpc/next_proforma_number (or …_financier_copy_number)
-- with any p_entity_id and BURN that entity's document sequence — each call does
-- `update entities set pi_serial_counter = pi_serial_counter + 1 …` and returns the
-- next number. No row is inserted, but the counter is a monotonic side effect: an
-- attacker could skip PI/FC numbers arbitrarily, creating gaps a Back-Office user
-- can't explain (and, for FC, corrupting the fiscal-year serial).
--
-- Unlike create_service_job (service_role-only), these two are called by the
-- FRONTEND as an authenticated user — see src/pages/ProformaInvoice.jsx and
-- src/pages/FinancierCopy.jsx (supabase.rpc(...)). So `authenticated` MUST keep
-- EXECUTE; only `anon` (and the redundant PUBLIC path) is removed.
--
-- Fix (defensive form — correct regardless of the exact current ACL):
--   revoke the PUBLIC path AND the direct anon grant, then re-assert the two
--   grants the app legitimately needs. RLS on proforma_invoices / financier_copies
--   is unchanged and remains the real insert guard; this only stops sequence-burning.
--
-- Reversible: `grant execute on function … to anon;` restores the prior state.
-- Apply to prod (mmmxvjaavdtwlpcnjgzy) AND staging (klpnhpnlotcbbovwswmq) as
-- migration `revoke_anon_proforma_financier_number`.

begin;

-- next_proforma_number(uuid)
revoke all    on function public.next_proforma_number(uuid) from public;
revoke all    on function public.next_proforma_number(uuid) from anon;
grant  execute on function public.next_proforma_number(uuid) to authenticated;
grant  execute on function public.next_proforma_number(uuid) to service_role;

-- next_financier_copy_number(uuid)
revoke all    on function public.next_financier_copy_number(uuid) from public;
revoke all    on function public.next_financier_copy_number(uuid) from anon;
grant  execute on function public.next_financier_copy_number(uuid) to authenticated;
grant  execute on function public.next_financier_copy_number(uuid) to service_role;

commit;

-- ── Verify after applying (should show acl WITHOUT `anon` / `=X/…` PUBLIC entry) ──
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        coalesce(array_to_string(p.proacl, E'\n'), '(default: PUBLIC has EXECUTE)') as acl
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('next_proforma_number','next_financier_copy_number');
-- Expected: acl lists `authenticated=X` and `service_role=X` (plus the owner), and
-- NO `anon=X` row and NO bare `=X` (PUBLIC) row.
