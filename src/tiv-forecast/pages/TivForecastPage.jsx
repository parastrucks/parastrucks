// TIV Forecast — Main page
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { runForecast } from '../lib/forecastEngine'
import { SEGMENTS, SEG_COL } from '../constants'
import { shouldLeadWithNextMonth } from '../lib/istMonth'
import { formatTrainedAt } from '../lib/formatTrainedAt'
import { dataCadence, coverageWindow } from '../lib/dataCadence'
import { previousVintage, vintageAsOf } from '../lib/vintage'
import { buildDefaultTriggerState, TRIGGER_DEFS } from '../lib/triggerDefs'
import {
  fetchTivActuals, fetchPtbActuals, fetchAlActuals,
  fetchJudgmentTiv, fetchJudgmentPtb,
  fetchLatestModelParams, fetchModelParamsHistory, fetchTriggerState, saveTriggerStateRow,
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

  // Tab lived in useState alone, so the URL never changed: you could not send
  // anyone "look at the Accuracy tab", and an accidental refresh mid-review
  // dropped you back on Forecast.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTab = searchParams.get('tab')
  const activeTab = TABS.some(t => t.id === urlTab) ? urlTab : 'forecast'
  const setActiveTab = (id) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    setSearchParams(next, { replace: true })
  }
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')
  // A forecast that THREW is a fault, not missing data. Kept apart so the page
  // never answers a code bug with "upload a file" — which invites a
  // destructive re-upload to fix something an upload cannot fix.
  const [engineError, setEngineError]   = useState('')

  // Data
  const [tivActuals,   setTivActuals]   = useState([])
  const [ptbActuals,   setPtbActuals]   = useState([])
  const [alActuals,    setAlActuals]    = useState([])
  const [judgmentTiv,  setJudgmentTiv]  = useState([])
  const [judgmentPtb,  setJudgmentPtb]  = useState([])
  const [paramsHistory, setParamsHistory] = useState([])
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
      // Vintages are a nice-to-have on this screen: a failure here must not
      // stop the page loading, so it is fetched separately and swallowed.
      fetchModelParamsHistory().then(setParamsHistory).catch(() => setParamsHistory([]))
      // Merge saved trigger state with defaults
      const defaults = buildDefaultTriggerState()
      setTriggerState({ ...defaults, ...savedTriggers })
      setLoadError('')
    } catch (e) {
      // A toast alone auto-dismissed after six seconds, after which the page
      // rendered exactly like an empty database — with an empty state telling
      // the reader to upload a file. A load failure has to stay on screen, and
      // it has to be retryable without a full page reload.
      setLoadError(e.message || 'Failed to load data')
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
  const rawForecastResult = useMemo(() => {
    if (!modelParams || !triggerState) return null
    try {
      return runForecast(modelParams, triggerState)
    } catch (e) {
      // Swallowed silently before — not even a console line — and the null it
      // returned rendered as "No forecast data · Upload a Market Data file".
      console.error('TIV forecast engine failed:', e)
      return { __error: e.message || 'The forecast engine failed' }
    }
  }, [modelParams, triggerState])

  // Unwrap: tabs should receive a forecast or nothing, never an error object.
  useEffect(() => {
    setEngineError(rawForecastResult?.__error || '')
  }, [rawForecastResult])
  const forecastResult = rawForecastResult?.__error ? null : rawForecastResult

  // ── Trigger change handler with debounced DB save ────────────────
  function handleTriggerChange(triggerId, newState) {
    setTriggerState(prev => ({ ...prev, [triggerId]: newState }))
    // Debounce DB save per trigger
    if (saveTimers.current[triggerId]) clearTimeout(saveTimers.current[triggerId])
    saveTimers.current[triggerId] = setTimeout(() => {
      // Was `.catch(() => {})`: a failed save reverted silently on the next
      // visit, so numbers you had adjusted and shared quietly went back.
      saveTriggerStateRow(profile.id, triggerId, newState).catch(err => {
        toast.error(`Could not save that adjustment: ${err.message}. It will revert when you reload.`)
      })
    }, DEBOUNCE_MS)
  }

  // Triggers persist per user, so without this the only way back to the base
  // forecast was to remember which ones you had switched on.
  function handleResetTriggers() {
    const defaults = buildDefaultTriggerState()
    setTriggerState(defaults)
    for (const [id, state] of Object.entries(defaults)) {
      saveTriggerStateRow(profile.id, id, state).catch(() => {})
    }
  }

  // Which month the summary tiles lead with. Past the 19th the current month is
  // effectively spoken for, so the number worth acting on is next month's
  // (owner's rule, 2026-08-25). Falls back to the first month if the next one
  // has no forecast — a dash would be less useful than a real number.
  // Where the next workbook is in its monthly cycle, and what the trained model
  // can actually reach. Both derived, never assumed.
  const cadence = useMemo(
    () => (modelParams ? dataCadence(modelParams.last_data_month) : null),
    [modelParams])
  const coverage = useMemo(() => coverageWindow(modelParams), [modelParams])

  // What the model said BEFORE the last retrain, replayed at the horizons it
  // originally had rather than at today's. The same trigger state is applied
  // to both, so any difference on screen is the retrain, not the triggers.
  const prevForecast = useMemo(() => {
    const prev = previousVintage(paramsHistory, modelParams)
    const asOf = prev && vintageAsOf(prev.last_data_month)
    if (!prev || !asOf || !triggerState) return null
    try {
      return { result: runForecast(prev, triggerState, asOf), lastDataMonth: prev.last_data_month }
    } catch {
      return null   // an old vintage with a shape the engine no longer reads
    }
  }, [paramsHistory, modelParams, triggerState])

  const kpiIdx = useMemo(() => {
    const totals = forecastResult?.totals
    if (!totals?.length) return 0
    if (!shouldLeadWithNextMonth() || totals.length < 2) return 0
    return totals[1].tiv === null || totals[1].tiv === undefined ? 0 : 1
  }, [forecastResult])

  // Which triggers are bending the numbers right now — surfaced at page level
  // so it travels with every tab, not just the Forecast one.
  const activeTriggers = useMemo(() => {
    if (!triggerState) return []
    return TRIGGER_DEFS
      .filter(d => triggerState[d.id]?.on)
      .map(d => ({
        name: d.name,
        severity: triggerState[d.id]?.severity ?? d.defaultSev,
        direction: d.type === 'both' ? (triggerState[d.id]?.direction || 'dampen') : d.type,
      }))
  }, [triggerState])

  // ── After upload: refresh model params and actuals ───────────────
  // `newParams` is the object retrainModel built in the browser. It is complete
  // enough to forecast from — which is why it is applied immediately — but it
  // carries no `trained_at`: that column is stamped by the database. Showing it
  // unfixed rendered "Model trained: Invalid Date" in the status strip at the
  // exact moment the user is watching hardest. So re-read the stored row and
  // prefer it; the local object stays the fallback if the read fails.
  async function handleUploadComplete(newParams) {
    setModelParams(newParams)
    try {
      const [tiv, ptb, al, jTiv, jPtb, stored] = await Promise.all([
        fetchTivActuals(), fetchPtbActuals(), fetchAlActuals(),
        fetchJudgmentTiv(), fetchJudgmentPtb(),
        fetchLatestModelParams().catch(() => null),
      ])
      setTivActuals(tiv); setPtbActuals(ptb); setAlActuals(al)
      setJudgmentTiv(jTiv); setJudgmentPtb(jPtb)
      if (stored?.last_data_month === newParams.last_data_month) setModelParams(stored)
      fetchModelParamsHistory().then(setParamsHistory).catch(() => {})
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
          <span>Model trained: <strong>{formatTrainedAt(modelParams.trained_at)}</strong></span>
          {/* The single most decision-relevant fact when the month turns: how far
              this model can actually see. Stated always, so running out is never
              a surprise — the banner below only appears once it has. */}
          {coverage && (
            <span title="The trained model carries anchors for these months only. Uploading the next workbook moves the window forward.">
              Covers: <strong>{coverage.text}</strong>
            </span>
          )}
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

      {/* A load failure used to be a six-second toast, after which the page was
          indistinguishable from an empty database — and the empty state told
          the reader to upload a file. Persistent, and retryable in place. */}
      {loadError && (
        <div className="tiv-banner tiv-banner-danger" role="alert">
          <strong>Could not load the forecast data.</strong> {loadError}
          {' '}<button className="btn btn-ghost btn-sm" onClick={loadData} style={{ marginLeft: 6 }}>Retry</button>
        </div>
      )}

      {engineError && (
        <div className="tiv-banner tiv-banner-danger" role="alert">
          <strong>The forecast could not be computed from the stored model.</strong>{' '}
          This is a fault, not missing data — uploading a file will not fix it. ({engineError})
        </div>
      )}

      {/* Adjusted numbers were labelled on the Forecast tab ONLY, while the
          Segments tab charted the same adjusted result with no marking at all
          — under a page banner reading "Judgment-free forecast". A screenshot
          of that tab was indistinguishable from the official baseline. The
          banner now lives at page level, carries magnitude and direction, and
          wraps rather than ellipsing away the triggers you can't see. */}
      {activeTriggers.length > 0 && (
        <div className="tiv-banner" role="status">
          <strong>Your what-if adjustments are on</strong> — every figure below is adjusted, not the
          base forecast:{' '}
          {activeTriggers.map((t, i) => (
            <span key={t.name}>
              {i > 0 && ' · '}
              {t.name} {t.direction === 'boost' ? '+' : '−'}{t.severity}%
            </span>
          ))}
          {'. '}
          <button className="btn btn-ghost btn-sm" onClick={handleResetTriggers}>Reset to base</button>
        </div>
      )}

      {/* The one number this page exists to produce used to be the bottom-left
          cell of a table, below an admin panel, a meta strip and two tab bars,
          at the same size as everything else. */}
      {forecastResult?.totals?.length > 0 && (
        <div className="tiv-kpis">
          {[
            { key: 'tiv', label: 'Industry (TIV)', hint: 'Total market' },
            { key: 'al',  label: 'Ashok Leyland',  hint: 'AL share of market' },
            { key: 'ptb', label: 'Our sales',      hint: 'PTB share of AL' },
          ].map(({ key, label, hint }) => {
            const first = forecastResult.totals[kpiIdx]
            const jRow = judgmentTiv?.find(j => j.month_label === first.month)
            const jTotal = key === 'tiv' && jRow
              ? SEGMENTS.reduce((s, seg) => {
                  const v = jRow[SEG_COL[seg]]
                  return v === null || v === undefined ? s : s + Number(v)
                }, 0)
              : null
            return (
              <div className="tiv-kpi" key={key}>
                <div className="tiv-kpi-label">{label}</div>
                <div className="tiv-kpi-value">{first[key] ?? '—'}</div>
                <div className="tiv-kpi-sub">
                  {first.month}
                  {jTotal ? <> · judgment {jTotal}</> : <> · {hint}</>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Stale-model banner.
          The trained model carries anchors for exactly three months after its
          last data month. Once the calendar rolls past them without a new
          upload, those columns have no basis at all — which used to render as
          a confident zero. This says so out loud, to everyone, not just to the
          admin who can fix it. */}
      {forecastResult?.staleMonths?.length > 0 && (() => {
        // The anchors run out on the 1st of every month; the market data that
        // replaces them arrives on the 5th-7th. So this gap opens on schedule
        // twelve times a year and closes itself a few days later. Shouting
        // "Model out of date" at it would make the one banner that matters —
        // data genuinely late — indistinguishable from the routine wait.
        const overdue = cadence?.status === 'overdue'
        const all = forecastResult.staleMonths.length === forecastResult.forecastMonths.length
        const which = all
          ? 'none of the months shown can be forecast'
          : `${forecastResult.staleMonths.join(', ')} cannot be forecast`
        return (
          <div
            className={overdue ? 'tiv-banner tiv-banner-danger' : 'tiv-banner'}
            role={overdue ? 'alert' : 'status'}
          >
            {cadence ? (
              <>
                <strong>
                  {overdue
                    ? `${cadence.awaitedMonth} market data is overdue.`
                    : `Waiting for ${cadence.awaitedMonth} market data.`}
                </strong>{' '}
                It usually arrives on the {cadence.dueFrom}th–{cadence.dueBy}th of{' '}
                {cadence.arrivesInMonth}. Until it is uploaded, {which} — those columns
                show “—”, never zero.
              </>
            ) : (
              <>
                <strong>Model out of date.</strong> {which} — the model was trained on data
                through <strong>{modelParams?.last_data_month}</strong>, and its forecast
                window reaches only three months past that. Those columns show “—”, never zero.
              </>
            )}
            {isAdmin
              ? ' Upload the Market Data workbook to extend the forecast.'
              : ' An administrator uploads the workbook each month.'}
          </div>
        )
      })()}

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
          modelParams={modelParams}
          tivActuals={tivActuals}
        />
      )}
      {activeTab === 'triggers' && triggerState && (
        <TriggerControlsTab
          triggerState={triggerState}
          onTriggerChange={handleTriggerChange}
          onResetTriggers={handleResetTriggers}
        />
      )}
      {activeTab === 'segments' && (
        <SegmentAnalysisTab
          tivActuals={tivActuals}
          alActuals={alActuals}
          ptbActuals={ptbActuals}
          forecastResult={forecastResult}
          previousForecast={prevForecast}
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
