// TIV Forecast — Main page
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { runForecast } from '../lib/forecastEngine'
import { buildDefaultTriggerState } from '../lib/triggerDefs'
import {
  fetchTivActuals, fetchPtbActuals, fetchAlActuals,
  fetchJudgmentTiv, fetchJudgmentPtb,
  fetchLatestModelParams, fetchTriggerState, saveTriggerStateRow,
} from '../lib/dataQueries'
import UploadPanel from '../components/UploadPanel'
import ForecastOutputTab from '../components/ForecastOutputTab'
import TriggerControlsTab from '../components/TriggerControlsTab'
import SegmentAnalysisTab from '../components/SegmentAnalysisTab'
import AccuracyTrackerTab from '../components/AccuracyTrackerTab'

const TABS = [
  { id: 'forecast',  label: 'Forecast' },
  { id: 'triggers',  label: 'Triggers' },
  { id: 'segments',  label: 'Segments' },
  { id: 'accuracy',  label: 'Accuracy' },
]

const DEBOUNCE_MS = 400

export default function TivForecastPage() {
  const { profile } = useAuth()
  // Mirrors UploadPanel's gate — used only to address the reader correctly
  // ("upload it" vs "ask an administrator"), never to grant anything.
  const isAdmin = profile?.permission_level === 'admin'
  const toast = useToast()   // load failures
  const [activeTab, setActiveTab]       = useState('forecast')
  const [loading, setLoading]           = useState(true)

  // Data
  const [tivActuals,   setTivActuals]   = useState([])
  const [ptbActuals,   setPtbActuals]   = useState([])
  const [alActuals,    setAlActuals]    = useState([])
  const [judgmentTiv,  setJudgmentTiv]  = useState([])
  const [judgmentPtb,  setJudgmentPtb]  = useState([])
  const [modelParams,  setModelParams]  = useState(null)
  const [triggerState, setTriggerState] = useState(null)

  // Debounce ref for trigger saves
  const saveTimers = useRef({})

  // ── Load all data on mount ───────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    try {
      const [tiv, ptb, al, jTiv, jPtb, params, savedTriggers] = await Promise.all([
        fetchTivActuals(),
        fetchPtbActuals(),
        fetchAlActuals(),
        fetchJudgmentTiv(),
        fetchJudgmentPtb(),
        fetchLatestModelParams(),
        fetchTriggerState(profile.id),
      ])
      setTivActuals(tiv)
      setPtbActuals(ptb)
      setAlActuals(al)
      setJudgmentTiv(jTiv)
      setJudgmentPtb(jPtb)
      setModelParams(params)
      // Merge saved trigger state with defaults
      const defaults = buildDefaultTriggerState()
      setTriggerState({ ...defaults, ...savedTriggers })
    } catch (e) {
      toast.error(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [profile, toast])

  useEffect(() => { loadData() }, [loadData])

  // Latest month for which the AL/LM split exists. The upload file carries AL
  // only through Mar-26 at time of writing, so the AL and PTB share layers are
  // frozen there while Layer 1 (TIV) keeps advancing. Surfaced in the banner so
  // a stale cascade can never be mistaken for a current one (handoff §7.1).
  const lastAlMonth = useMemo(() => {
    if (!alActuals?.length) return null
    return alActuals.reduce((a, b) => (a.month_index > b.month_index ? a : b)).month_label
  }, [alActuals])

  // ── Run forecast whenever params or triggers change ──────────────
  const forecastResult = useMemo(() => {
    if (!modelParams || !triggerState) return null
    try {
      return runForecast(modelParams, triggerState)
    } catch { return null }
  }, [modelParams, triggerState])

  // ── Trigger change handler with debounced DB save ────────────────
  function handleTriggerChange(triggerId, newState) {
    setTriggerState(prev => ({ ...prev, [triggerId]: newState }))
    // Debounce DB save per trigger
    if (saveTimers.current[triggerId]) clearTimeout(saveTimers.current[triggerId])
    saveTimers.current[triggerId] = setTimeout(() => {
      saveTriggerStateRow(profile.id, triggerId, newState).catch(() => {})
    }, DEBOUNCE_MS)
  }

  // ── After upload: refresh model params and actuals ───────────────
  async function handleUploadComplete(newParams) {
    setModelParams(newParams)
    try {
      const [tiv, ptb, al, jTiv, jPtb] = await Promise.all([
        fetchTivActuals(), fetchPtbActuals(), fetchAlActuals(),
        fetchJudgmentTiv(), fetchJudgmentPtb(),
      ])
      setTivActuals(tiv); setPtbActuals(ptb); setAlActuals(al)
      setJudgmentTiv(jTiv); setJudgmentPtb(jPtb)
    } catch { /* non-critical */ }
  }

  // ── Render ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="full-center" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-head-crumb">Back Office Tools</div>
          <h1 className="page-head-title">TIV Forecast<span className="period-accent">.</span></h1>
          <div className="page-head-sub">Industry volume forecasting and AL submission preparation · Ahmedabad territory</div>
        </div>
      </div>

      {/* Load failures surface as a global toast (no banner). */}

      {/* Upload panel — admin only */}
      <UploadPanel
        onUploadComplete={handleUploadComplete}
        current={{ tivActuals, modelParams }}
      />

      {/* Model info banner */}
      {modelParams && (
        <div className="tiv-meta">
          <span className="tiv-chip">Engine v3.0</span>
          <span>Last data: <strong>{modelParams.last_data_month}</strong></span>
          <span>Total months: <strong>{modelParams.total_months}</strong></span>
          <span>Model trained: <strong>{new Date(modelParams.trained_at).toLocaleDateString('en-IN')}</strong></span>
          <span title="No judgment value enters any forecast computation. Judgment appears only as a comparison column.">
            Judgment-free forecast
          </span>
          {lastAlMonth && lastAlMonth !== modelParams.last_data_month && (
            <span className="tiv-warn"
              title={`The AL/LM split is only present in the upload file through ${lastAlMonth}, so the AL and PTB share layers are frozen at that month. Layer 1 (TIV) is unaffected.`}>
              ⚠ AL/PTB share layer as of {lastAlMonth}
            </span>
          )}
        </div>
      )}

      {/* Stale-model banner.
          The trained model carries anchors for exactly three months after its
          last data month. Once the calendar rolls past them without a new
          upload, those columns have no basis at all — which used to render as
          a confident zero. This says so out loud, to everyone, not just to the
          admin who can fix it. */}
      {forecastResult?.staleMonths?.length > 0 && (
        <div className="tiv-banner tiv-banner-danger" role="alert">
          <strong>Model out of date.</strong>{' '}
          {forecastResult.staleMonths.length === forecastResult.forecastMonths.length
            ? 'No forecast can be produced for any of the months shown'
            : `No forecast can be produced for ${forecastResult.staleMonths.join(', ')}`}
          {' '}— the model was trained on data through{' '}
          <strong>{modelParams?.last_data_month}</strong>, and its forecast window only
          reaches three months past that. Those columns show “—”, not zero.
          {isAdmin
            ? ' Upload the latest Market Data workbook to refresh it.'
            : ' Ask an administrator to upload the latest Market Data workbook.'}
        </div>
      )}

      {/* Tab bar */}
      <div className="tiv-tabs" role="tablist" aria-label="TIV forecast sections">
        {TABS.map(tab => (
          <button
            key={tab.id}
            id={'tiv-tab-' + tab.id}
            className="tiv-tab"
            role="tab"
            type="button"
            aria-selected={activeTab === tab.id}
            aria-controls="tiv-tabpanel"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="tiv-tabpanel" role="tabpanel" aria-labelledby={'tiv-tab-' + activeTab}>
      {/* Tab content */}
      {activeTab === 'forecast' && (
        <ForecastOutputTab
          forecastResult={forecastResult}
          judgmentTiv={judgmentTiv}
          judgmentPtb={judgmentPtb}
          triggerState={triggerState || {}}
        />
      )}
      {activeTab === 'triggers' && triggerState && (
        <TriggerControlsTab
          triggerState={triggerState}
          onTriggerChange={handleTriggerChange}
        />
      )}
      {activeTab === 'segments' && (
        <SegmentAnalysisTab
          tivActuals={tivActuals}
          alActuals={alActuals}
          ptbActuals={ptbActuals}
          forecastResult={forecastResult}
        />
      )}
      {activeTab === 'accuracy' && (
        <AccuracyTrackerTab
          tivActuals={tivActuals}
          judgmentTiv={judgmentTiv}
          modelParams={modelParams}
        />
      )}
      </div>
    </div>
  )
}
