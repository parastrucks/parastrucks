-- Phase 10 — probe for 20261023_phase10_tracker_rmc_gst.sql (RMC = 18% GST on any date).
-- SELF-ABORTING: a green run ENDS IN AN ERROR that reads "PROBE COMPLETE: N passed, 0 failed".
-- Everything it writes is rolled back with that error.
do $probe$
declare
  pass int := 0; fail int := 0; msgs text := '';
  me uuid := gen_random_uuid();
  u uuid; r record;
begin
  -- 1. an RMC chassis invoiced BEFORE the GST change → 18%, and the figures use 18%
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000001","model":"CE2820/39 R RMC",
         "ptb_invoice_date":"2025-07-15","ctd":100000,"supplier_invoice_amount":95000}'::jsonb);
  select * into r from public.vehicle_units where id = u;
  if r.gst_rate = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |1 rmc early gst=' || r.gst_rate; end if;
  if round(r.diff_base, 2) = 4237.29 and round(r.diff_gst, 2) = 762.71 then pass := pass + 1;
    else fail := fail + 1; msgs := msgs || ' |1b diffs at 18% ' || r.diff_base || '/' || r.diff_gst; end if;

  -- 2. the same date, not RMC → 28% (the rule for everything else is unchanged)
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000002","model":"NJ3525/52 T TIP",
         "ptb_invoice_date":"2025-07-15"}'::jsonb);
  if (select gst_rate from public.vehicle_units where id = u) = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |2 tipper early'; end if;

  -- 3. any case, any spacing around the word
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000003","model":"ue2820/39 r rmc",
         "ptb_invoice_date":"2025-05-01"}'::jsonb);
  if (select gst_rate from public.vehicle_units where id = u) = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |3 lower case'; end if;

  -- 4. "rmc" inside another word is NOT an RMC truck
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000004","model":"FARMCO 1615",
         "ptb_invoice_date":"2025-05-01"}'::jsonb);
  if (select gst_rate from public.vehicle_units where id = u) = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |4 word boundary'; end if;

  -- 5. an override still wins over the RMC rule (the one RMC billed at 28%, row 720 of 2025-26)
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000005","model":"CE2820/39 R RMC",
         "ptb_invoice_date":"2025-08-29","gst_rate_override":28}'::jsonb);
  if (select gst_rate from public.vehicle_units where id = u) = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |5 override'; end if;

  -- 6. RMC unsold, and RMC after the change → 18%
  u := public.tracker_create_unit(me, gen_random_uuid(), '{"chassis_no":"MB1PROBERMC000006","model":"CE2820/39 R RMC"}'::jsonb);
  if (select gst_rate from public.vehicle_units where id = u) = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6a unsold'; end if;
  update public.vehicle_units set ptb_invoice_date = '2025-12-01' where id = u;
  if (select gst_rate from public.vehicle_units where id = u) = 18 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |6b late'; end if;

  -- 7. an edit that takes "RMC" out of the model recomputes the rate
  update public.vehicle_units set ptb_invoice_date = '2025-07-15' where id = u;
  update public.vehicle_units set model = 'CE2820/39 R TIP' where id = u;
  if (select gst_rate from public.vehicle_units where id = u) = 28 then pass := pass + 1; else fail := fail + 1; msgs := msgs || ' |7 model edit'; end if;

  raise exception 'PROBE COMPLETE: % passed, % failed%', pass, fail, case when fail > 0 then ' —' || msgs else '' end;
end;
$probe$;
