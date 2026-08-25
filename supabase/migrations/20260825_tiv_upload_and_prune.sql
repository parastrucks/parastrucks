-- Upload may now REMOVE months the workbook no longer contains -- but only when
-- the uploader has been shown the exact list and ticked the box. Owner's
-- decision, 2026-08-25, taken after 12 ghost judgment rows survived every
-- upload because tiv_upload_all() only ever upserted.
--
-- Deliberately a WRAPPER rather than an edit to tiv_upload_all(). That function
-- is verified working in production and holds six hand-written upserts; adding
-- parameters to it would mean DROP + full recreate (a different argument list
-- makes an overload, not a replacement), which would put 275 lines of working
-- SQL back through a copy. Nothing is gained by risking that.
--
-- Ordering is safe: the prune predicate is "in the database, absent from the
-- payload", and the upserts only ever write payload months. So pruning after
-- the upserts selects exactly the same rows it would have before them -- while
-- the snapshot inside tiv_upload_all() still precedes everything, keeping any
-- unwanted removal recoverable. A function calling a function is one
-- transaction, so the whole thing stays atomic.
--
-- Three safeguards, because deleting on upload is the one operation here that
-- can destroy history in a single click:
--   1. Opt-in         -- p_remove_absent defaults FALSE.
--   2. Never on an    -- a sheet that parsed to zero rows is a broken file, not
--      empty sheet       an instruction to empty a table.
--   3. Count match    -- the client sends the number of month-rows it showed
--                        the user; a different number means the data moved
--                        under them, so refuse rather than delete the unseen.
CREATE OR REPLACE FUNCTION public.tiv_upload_and_prune(
  p_entity_id       uuid,
  p_brand_id        uuid,
  p_tiv             jsonb,
  p_ptb             jsonb,
  p_al              jsonb,
  p_judg_tiv        jsonb,
  p_judg_ptb        jsonb,
  p_raw             jsonb,
  p_params          jsonb,
  p_uploaded_by     uuid,
  p_uploader_name   text,
  p_file_name       text,
  p_months_loaded   integer,
  p_last_data_month text,
  p_remove_absent   boolean DEFAULT false,
  p_remove_expected integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result    jsonb;
  v_tbl       text;
  v_payload   jsonb;
  v_labels    jsonb;
  v_removed   jsonb := '{}'::jsonb;
  v_removed_n integer := 0;
BEGIN
  -- Snapshot + cross-scope guard + six upserts + params + history, unchanged.
  v_result := public.tiv_upload_all(
    p_entity_id, p_brand_id, p_tiv, p_ptb, p_al, p_judg_tiv, p_judg_ptb, p_raw,
    p_params, p_uploaded_by, p_uploader_name, p_file_name, p_months_loaded,
    p_last_data_month);

  IF NOT p_remove_absent THEN
    RETURN v_result || jsonb_build_object('removed_count', 0, 'removed', '{}'::jsonb);
  END IF;

  IF jsonb_array_length(p_tiv) = 0 OR jsonb_array_length(p_ptb) = 0
     OR jsonb_array_length(p_al) = 0 OR jsonb_array_length(p_judg_tiv) = 0
     OR jsonb_array_length(p_judg_ptb) = 0 OR jsonb_array_length(p_raw) = 0 THEN
    RAISE EXCEPTION 'remove_absent_refused: at least one sheet parsed to zero rows. Removing the months absent from an empty sheet would empty that table.'
      USING ERRCODE = '22023';
  END IF;

  -- Name them before deleting, so the total can be checked against what the
  -- uploader was actually shown.
  FOR v_tbl, v_payload IN
    SELECT * FROM (VALUES
      ('tiv_forecast_tiv_actuals',  p_tiv),
      ('tiv_forecast_ptb_actuals',  p_ptb),
      ('tiv_forecast_al_actuals',   p_al),
      ('tiv_forecast_judgment_tiv', p_judg_tiv),
      ('tiv_forecast_judgment_ptb', p_judg_ptb),
      ('tiv_forecast_raw_data',     p_raw)
    ) AS t(tbl, payload)
  LOOP
    -- format %I takes a literal from the VALUES list above, never a client
    -- string; the payload travels as a bound parameter.
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(t.month_label ORDER BY t.month_label), ''[]''::jsonb)
         FROM public.%I t
        WHERE t.entity_id = $1 AND t.brand_id = $2
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($3) e
                          WHERE e ->> ''month_label'' = t.month_label)', v_tbl)
    INTO v_labels USING p_entity_id, p_brand_id, v_payload;

    v_removed   := v_removed || jsonb_build_object(v_tbl, v_labels);
    v_removed_n := v_removed_n + jsonb_array_length(v_labels);
  END LOOP;

  IF p_remove_expected IS NOT NULL AND v_removed_n <> p_remove_expected THEN
    RAISE EXCEPTION 'remove_count_mismatch: you confirmed % month-rows for removal but the database holds %. Nothing was deleted -- reload and review the preview again.', p_remove_expected, v_removed_n
      USING ERRCODE = '22023';
  END IF;

  IF v_removed_n > 0 THEN
    FOR v_tbl, v_payload IN
      SELECT * FROM (VALUES
        ('tiv_forecast_tiv_actuals',  p_tiv),
        ('tiv_forecast_ptb_actuals',  p_ptb),
        ('tiv_forecast_al_actuals',   p_al),
        ('tiv_forecast_judgment_tiv', p_judg_tiv),
        ('tiv_forecast_judgment_ptb', p_judg_ptb),
        ('tiv_forecast_raw_data',     p_raw)
      ) AS t(tbl, payload)
    LOOP
      EXECUTE format(
        'DELETE FROM public.%I t
          WHERE t.entity_id = $1 AND t.brand_id = $2
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($3) e
                            WHERE e ->> ''month_label'' = t.month_label)', v_tbl)
      USING p_entity_id, p_brand_id, v_payload;
    END LOOP;
  END IF;

  RETURN v_result || jsonb_build_object('removed_count', v_removed_n, 'removed', v_removed);
END;
$fn$;

COMMENT ON FUNCTION public.tiv_upload_and_prune IS
  'tiv_upload_all() plus optional removal of months the workbook no longer contains, in ONE transaction. Opt-in; refuses when any sheet parsed empty; refuses when the removal count differs from what the uploader confirmed. Called by the admin-tiv Edge Function with the service role.';

-- Supabase grants EXECUTE to anon on function creation, so revoking from PUBLIC
-- alone is not enough -- it must come off anon AND authenticated.
REVOKE ALL ON FUNCTION public.tiv_upload_and_prune(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, text, integer, text, boolean, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tiv_upload_and_prune(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, text, integer, text, boolean, integer) FROM anon;
REVOKE ALL ON FUNCTION public.tiv_upload_and_prune(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, text, integer, text, boolean, integer) FROM authenticated;
