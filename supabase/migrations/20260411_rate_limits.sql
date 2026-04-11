-- Phase 5 U9: Rate limiting for Edge Functions
-- Fixed-window counter keyed by (user_id, bucket). Only the service role
-- writes here (via the shared rateLimit helper in supabase/functions/_shared).
create table if not exists public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, bucket)
);

alter table public.rate_limits enable row level security;
-- No policies — only the shared helper writes via service role.
