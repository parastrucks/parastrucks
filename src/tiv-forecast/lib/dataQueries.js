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

export async function upsertTivActuals(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_tiv_actuals', rows })
}

export async function upsertPtbActuals(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_ptb_actuals', rows })
}

export async function upsertAlActuals(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_al_actuals', rows })
}

export async function upsertJudgmentTiv(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_judgment_tiv', rows })
}

export async function upsertJudgmentPtb(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_judgment_ptb', rows })
}

export async function upsertRawData(rows) {
  if (!rows.length) return
  await callEdge('admin-tiv', 'upsertRows', { table: 'tiv_forecast_raw_data', rows })
}

export async function insertModelParams(params) {
  await callEdge('admin-tiv', 'insertModelParams', { params })
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
