// TIV Forecast — Supabase CRUD helpers
// Reads go through the regular supabase (anon) client; RLS protects the tables.
// Writes go through the admin-tiv Edge Function so the service role key never
// ships to the browser.
import { supabase } from '../../lib/supabase'
import { callEdge } from '../../lib/api'

// ── Fetch helpers ────────────────────────────────────────────────────

export async function fetchTivActuals() {
  const { data, error } = await supabase
    .from('tiv_forecast_tiv_actuals')
    .select('*')
    .order('month_index')
  if (error) throw error
  return data || []
}

export async function fetchPtbActuals() {
  const { data, error } = await supabase
    .from('tiv_forecast_ptb_actuals')
    .select('*')
    .order('month_index')
  if (error) throw error
  return data || []
}

export async function fetchAlActuals() {
  const { data, error } = await supabase
    .from('tiv_forecast_al_actuals')
    .select('*')
    .order('month_index')
  if (error) throw error
  return data || []
}

export async function fetchJudgmentTiv() {
  const { data, error } = await supabase
    .from('tiv_forecast_judgment_tiv')
    .select('*')
    .order('month_label')
  if (error) throw error
  return data || []
}

export async function fetchJudgmentPtb() {
  const { data, error } = await supabase
    .from('tiv_forecast_judgment_ptb')
    .select('*')
    .order('month_label')
  if (error) throw error
  return data || []
}

export async function fetchLatestModelParams() {
  const { data, error } = await supabase
    .from('tiv_forecast_model_params')
    .select('*')
    .order('trained_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchUploadHistory() {
  const { data, error } = await supabase
    .from('tiv_forecast_upload_history')
    .select('*')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data || []
}

// ── Trigger state ────────────────────────────────────────────────────

export async function fetchTriggerState(userId) {
  const { data, error } = await supabase
    .from('tiv_forecast_trigger_state')
    .select('trigger_id, on_state, severity, direction')
    .eq('user_id', userId)
  if (error) throw error
  // Convert array of rows to { [trigger_id]: { on, severity, direction } }
  const state = {}
  for (const row of data || []) {
    state[row.trigger_id] = {
      on:        row.on_state,
      severity:  row.severity,
      direction: row.direction,
    }
  }
  return state
}

export async function saveTriggerStateRow(userId, triggerId, { on, severity, direction }) {
  const { error } = await supabase
    .from('tiv_forecast_trigger_state')
    .upsert(
      {
        user_id:    userId,
        trigger_id: triggerId,
        on_state:   on,
        severity:   severity,
        direction:  direction ?? 'dampen',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,trigger_id' }
    )
  if (error) throw error
}

// ── Upload helpers (route through admin-tiv Edge Function) ───────────

export async function upsertTivActuals(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_tiv_actuals', rows, entity_id: entityId, brand_id: brandId })
}

export async function upsertPtbActuals(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_ptb_actuals', rows, entity_id: entityId, brand_id: brandId })
}

export async function upsertAlActuals(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_al_actuals', rows, entity_id: entityId, brand_id: brandId })
}

export async function upsertJudgmentTiv(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_judgment_tiv', rows, entity_id: entityId, brand_id: brandId })
}

export async function upsertJudgmentPtb(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_judgment_ptb', rows, entity_id: entityId, brand_id: brandId })
}

export async function upsertRawData(rows, entityId, brandId) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_raw_data', rows, entity_id: entityId, brand_id: brandId })
}

export async function insertModelParams(params, entityId, brandId) {
  await callEdge('admin-tiv', 'insertModelParams', { params, entity_id: entityId, brand_id: brandId })
}

export async function insertUploadHistory({ userId, uploaderName, fileName, monthsLoaded, lastDataMonth }) {
  // userId is ignored — the Edge Function sets uploaded_by from the verified JWT.
  await callEdge('admin-tiv', 'insertUploadHistory', {
    uploader_name:   uploaderName,
    file_name:       fileName,
    months_loaded:   monthsLoaded,
    last_data_month: lastDataMonth,
  })
}

// ── Atomic upload (audit finding A4) ─────────────────────────────────
// Replaces the eight separate calls above with ONE, so a failure part-way can
// no longer leave production half-overwritten -- new actuals sitting under the
// old model -- and a failed history write can no longer report "Upload failed"
// for an upload that actually committed. The Edge Function forwards this to
// the tiv_upload_all() Postgres function, whose body is a single transaction.
// It also snapshots the previous state first, so the upload is revertible.
export async function uploadAllTiv(parsed, params, entityId, brandId, fileName, uploaderName) {
  return callEdge('admin-tiv', 'uploadAll', {
    entity_id:       entityId,
    brand_id:        brandId,
    tiv:             parsed.tivActuals,
    ptb:             parsed.ptbActuals,
    al:              parsed.alActuals,
    judgment_tiv:    parsed.judgmentTiv,
    judgment_ptb:    parsed.judgmentPtb,
    raw:             parsed.rawRows,
    params,
    uploader_name:   uploaderName,
    file_name:       fileName,
    months_loaded:   parsed.summary.monthsLoaded,
    last_data_month: parsed.summary.lastDataMonth,
  })
}

// Every training vintage this entity/brand has produced, newest first --
// the input to a revert, and to showing how a forecast has been revised.
export async function fetchSnapshots(limit = 10) {
  const { data, error } = await supabase
    .from('tiv_forecast_snapshots')
    .select('id, taken_at, taken_by, reason')
    .order('taken_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
