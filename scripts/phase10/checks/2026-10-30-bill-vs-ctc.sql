-- Phase 10 — two Yes/No checks for the team (owner, 2026-10-30), on the rule the owner gave the same day:
-- the Tally Bill is raised higher than PTB CTC for the financier's DO, and a credit note brings it down to PTB CTC.
-- So the bill should never be BELOW PTB CTC, and a truck sold for cash should not need a higher bill.
-- Re-runnable: a question already asked of a truck is not asked again (unique check_set + truck + column).
-- Holds the RULES only; the trucks are picked from the database where it runs (staging).
with u as (
  select v.*, to_jsonb(v) j from public.vehicle_units v where v.superseded_at is null
),
ctx as (
  select u.*, (select jsonb_agg(jsonb_build_object('key', k, 'value', u.j -> k)) from unnest(keys) k) context
  from u, lateral (select array['customer_name','model','ptb_invoice_date','finance_bank','do_amount']::text[] keys) x
)
insert into public.tracker_checks (check_set, question, unit_id, chassis_no, column_key, shown_value, context)
select s.check_set, s.question, c.id, c.chassis_no, s.col, c.j -> s.col,
       (select jsonb_agg(e) from jsonb_array_elements(s.extra || c.context) e)
from ctx c
cross join lateral (values
  -- 1. the bill below PTB CTC: is the bill wrong, or is PTB CTC? (both asked)
  ('Tally Bill lower than PTB CTC', 'tally_bill',
   'Is this Tally Bill right? It is LOWER than PTB CTC — the bill is normally the same or higher.',
   jsonb_build_array(jsonb_build_object('key', 'ctc', 'value', c.j -> 'ctc')),
   c.tally_bill < c.ctc),
  ('Tally Bill lower than PTB CTC', 'ctc',
   'Is this PTB CTC right? It is HIGHER than the Tally Bill.',
   jsonb_build_array(jsonb_build_object('key', 'tally_bill', 'value', c.j -> 'tally_bill')),
   c.tally_bill < c.ctc),
  -- 2. cash / self, yet billed higher than PTB CTC (which normally means a financier's DO)
  ('Cash / self, but billed higher than PTB CTC', 'finance_bank',
   'Is Finance right? It says cash / self, but the Tally Bill is HIGHER than PTB CTC — that usually means a financier''s DO.',
   jsonb_build_array(jsonb_build_object('key', 'tally_bill', 'value', c.j -> 'tally_bill'),
                     jsonb_build_object('key', 'ctc', 'value', c.j -> 'ctc'),
                     jsonb_build_object('key', 'finance_recd', 'value', c.j -> 'finance_recd'),
                     jsonb_build_object('key', 'margin_money', 'value', c.j -> 'margin_money')),
   c.tally_bill > c.ctc and upper(coalesce(c.finance_bank, '')) ~ '(CASH|SELF|OWN)')
) s(check_set, col, question, extra, picked)
where s.picked
on conflict (check_set, unit_id, column_key) do nothing;

select check_set, column_key, count(*) from public.tracker_checks group by 1, 2 order by 1, 2;
