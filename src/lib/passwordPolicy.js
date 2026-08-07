// ============================================================================
// passwordPolicy — the ONE number, client side.
//
// ⚠️ MUST equal the Supabase dashboard's Authentication → minimum password
// length, and the server mirror at supabase/functions/_shared/passwordPolicy.ts.
//
// Not theoretical. Phase 5 set GoTrue to 10 while every app validator used 8:
// the form accepted an 8–9 character password, GoTrue rejected it, and users who
// had been TOLD their password was reset simply could not sign in. That was the
// PCE login lockout, fixed 2026-07-22 by lowering prod and staging to 8. Owner
// re-confirmed 8 on 2026-08-07.
//
// If a longer minimum is ever wanted, raise the dashboard AND both mirrors in
// the same change. Never the dashboard alone.
// ============================================================================
export const MIN_PASSWORD_LENGTH = 8
