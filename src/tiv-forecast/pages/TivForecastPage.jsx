// TIV Forecast — Main page
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
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
  { id: 'forecast',  label: 'Forecast Output' },
  { id: 'triggers',  label: 'Trigger Controls' },
  { id: 'segments',  label: 'Segment Analysis' },
  { id: 'accuracy',  label: 'Accuracy Tracker' },
]

const DEBOUNCE_MS = 400

export default function TivForecastPage() {
  const { profile } = useAuth()
  const [activeTab, setActiveTab]       = useState('forecast')
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')

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
    setError('')
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
      setError(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => { loadData() }, [loadData])

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
      <div className="page-header">
        <h1>TIV Forecast</h1>
        <p>Industry volume forecasting and AL submission preparation · Ahmedabad territory</p>
      </div>

      {error && (
        <div className="alert alert-error mb-24">
          <span>⚠</span><span>{error}</span>
        </div>
      )}

      {/* Upload panel — admin only */}
      <UploadPanel onUploadComplete={handleUploadComplete} />

      {/* Model info banner */}
      {modelParams && (
        <div style={{
          fontSize: 13, color: 'var(--gray-500)',
          marginBottom: 16,
          display: 'flex', gap: 16, flexWrap: 'wrap',
        }}>
          <span>Last data: <strong>{modelParams.last_data_month}</strong></span>
          <span>Total months: <strong>{modelParams.total_months}</strong></span>
          <span>Model trained: <strong>{new Date(modelParams.trained_at).toLocaleDateString('en-IN')}</strong></span>
        </div>
      )}

      {/* Tab bar — reuse .vc-tabs pattern */}
      <div className="vc-tabs mb-16">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`vc-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
        />
      )}
    </div>
  )
}
