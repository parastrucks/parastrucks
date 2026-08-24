-- TIV Forecast v3.0 — model_params schema
--
-- Spec: docs/TIV_FORECAST_MIGRATION_SPEC.md §4, handoff docs/WEBSITE_BUILD_HANDOFF.md §3.
--
-- v3.0 retires the v2.1 champion model. `retrainModel.js` now emits:
--     yoy_t12, smly_plain, smly_robust, theta_params, adapt_params, v3_method
-- and no longer emits:
--     hw_params, smly, yoy_capped, yoy_sum, yoy_median,
--     cap_scores, tipper_norm_hw, tipper_norm_si, tipper_norm_smly, champion
--
-- The admin-tiv Edge Function inserts the retrain output as a spread
-- (`insert({...params, entity_id, brand_id})`), so every emitted key must have a
-- column, and every NOT NULL column must still receive a value. Three legacy
-- columns are NOT NULL with no default and would break the v3 insert — this
-- migration relaxes them rather than dropping them.
--
-- ⚠ NOTHING IS DELETED HERE. Per the project rule (memory/feedback_no_schema_deletion),
-- the ten obsolete v2.1 columns keep their data and are left in place. Dropping them
-- is a separate, explicit owner decision — see the commented block at the bottom.

BEGIN;

-- ── 1. New v3.0 columns ──────────────────────────────────────────────
-- Nullable so that historical v2.1 rows remain readable and valid.

-- Trailing-12M vs prior-12M growth, capped ±15%, per segment.
-- ⚠ NEVER FY-to-date vs full FY — see spec §5.4a (that form pinned growth at
-- -15% in 56 of 72 backtest segment-months and invalidated every v2.x selection).
ALTER TABLE public.tiv_forecast_model_params ADD COLUMN IF NOT EXISTS yoy_t12 jsonb;

-- SMLY anchors for the 3-month horizon, keyed by TARGET LABEL then segment:
--   { "Aug-26": { "Bus PVT": 64, ... }, "Sep-26": {...}, "Oct-26": {...} }
-- plain  = same calendar month, prior year
-- robust = median(month-1, month, month+1) of the prior year
ALTER TABLE public.tiv_forecast_model_params ADD COLUMN IF NOT EXISTS smly_plain  jsonb;
ALTER TABLE public.tiv_forecast_model_params ADD COLUMN IF NOT EXISTS smly_robust jsonb;

-- ADAPT level-shift adapter, ICV Trucks only:
--   { "ICV Trucks": { "g": 0.291, "window": 6, "shrink": 0.7, "cap": 0.30 } }
ALTER TABLE public.tiv_forecast_model_params ADD COLUMN IF NOT EXISTS adapt_params jsonb;

-- Per-segment method map: { "Bus PVT":"ROB", ..., "ICV Trucks":"ADAPT" }.
-- A code constant mirrored into the row for audit; do NOT recompute on retrain.
ALTER TABLE public.tiv_forecast_model_params ADD COLUMN IF NOT EXISTS v3_method jsonb;

-- ── 2. Relax legacy NOT NULLs so v3 inserts succeed ──────────────────
-- These three columns are v2.1-only outputs. The columns and all existing data
-- are preserved; only the NOT NULL constraint is lifted.
ALTER TABLE public.tiv_forecast_model_params ALTER COLUMN hw_params  DROP NOT NULL;
ALTER TABLE public.tiv_forecast_model_params ALTER COLUMN smly       DROP NOT NULL;
ALTER TABLE public.tiv_forecast_model_params ALTER COLUMN yoy_capped DROP NOT NULL;

COMMIT;

-- ── Verification (run separately; the SQL editor's "Success. No rows returned"
--    reports rows RETURNED, not rows AFFECTED — always read a result back) ──
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'tiv_forecast_model_params'
--   ORDER BY ordinal_position;
--
-- Expect: yoy_t12, smly_plain, smly_robust, adapt_params, v3_method present and
-- nullable; hw_params / smly / yoy_capped now is_nullable = 'YES'.

-- ── NOT RUN — obsolete v2.1 columns, retained pending explicit owner approval ──
-- Only after confirming no historical row is still needed for audit:
--
--   ALTER TABLE public.tiv_forecast_model_params
--     DROP COLUMN hw_params, DROP COLUMN smly, DROP COLUMN yoy_capped,
--     DROP COLUMN yoy_sum, DROP COLUMN yoy_median, DROP COLUMN cap_scores,
--     DROP COLUMN tipper_norm_hw, DROP COLUMN tipper_norm_si,
--     DROP COLUMN tipper_norm_smly, DROP COLUMN champion;
