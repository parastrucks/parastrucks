// TIV Forecast — Forecast Output Tab
// 3 layers shown as sub-tabs to avoid vertical scroll
import { useState } from 'react'
import Icon from '../../components/Icon'
import { useAuth } from '../../context/AuthContext'
import ForecastTable from './ForecastTable'
import { SEGMENTS } from '../constants'
import { explainForecast, toleranceOdds } from '../lib/forecastQuality'

// Each layer owns its own title and caption. The captions used to be passed to
// ForecastTable and then never rendered, so the share basis and the 75% cap
// were documented in code but invisible on screen.
const LAYERS = [
  {
    id: 'tiv',
    label: 'Layer 1 — TIV',
    title: 'Layer 1 — TIV Forecast (Total Industry Volume)',
    subtitle: 'All brands combined in PTB territory.',
  },
  {
    id: 'al',
    label: 'Layer 2 — AL',
    title: 'Layer 2 — AL Forecast (Ashok Leyland volume)',
    subtitle: 'AL = PTB + LM · Share is the recent 6-month average of AL ÷ TIV, not a trend.',
  },
  {
    id: 'ptb',
    label: 'Layer 3 — PTB',
    title: 'Layer 3 — PTB Sales Forecast',
    subtitle: 'PTB share of AL, hard capped at 75% — LM is a legacy dealer that never exits.',
  },
]

function buildJudgmentRows(judgmentData, forecastMonths) {
  const rows = {}
  if (!judgmentData?.length) return rows
  for (const fm of forecastMonths) {
    const jRow = judgmentData.find(r => r.month_label === fm.label)
    if (jRow) {
      rows[fm.label] = {
        'Bus PVT':    jRow.bus_pvt,
        'Haulage':    jRow.haulage,
        'MAV':        jRow.mav,
        'Tractor':    jRow.tractor,
        'Tipper':     jRow.tipper,
        'ICV Trucks': jRow.icv_trucks,
      }
    }
  }
  return rows
}

export default function ForecastOutputTab({ forecastResult, judgmentTiv, judgmentPtb, modelParams, tivActuals = [] }) {
  const { profile } = useAuth()
  const isAdmin = profile?.permission_level === 'admin'
  const [activeLayer, setActiveLayer] = useState('tiv')
  const [explain, setExplain] = useState(null)
  const [copied, setCopied]   = useState('')

  if (!forecastResult) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Icon name="chart" size={34} color="var(--text-muted)" /></div>
        <div className="empty-title">No forecast data</div>
        {/* This told EVERY reader to upload a file — including the people for
            whom the upload panel does not render at all, and whose real problem
            is usually that row-level security returned them nothing. */}
        <div className="empty-desc">
          {isAdmin
            ? 'Upload a Market Data file to generate forecasts.'
            : 'No data has been loaded for your entity and brand. Ask an administrator to upload the latest Market Data workbook.'}
        </div>
      </div>
    )
  }

  const { forecastMonths, bySegment, totals } = forecastResult

  async function writeClipboard(text, note) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(note)
      setTimeout(() => setCopied(''), 2500)
    } catch {
      setCopied('Could not copy — your browser blocked clipboard access.')
      setTimeout(() => setCopied(''), 4000)
    }
  }

  function copyTable(layerId) {
    const key = layerId === 'al' ? 'al' : layerId === 'ptb' ? 'ptb' : 'tiv'
    const header = ['Segment', ...forecastMonths.map(fm => fm.label)].join('\t')
    const rows = SEGMENTS.map(seg => {
      const cells = forecastMonths.map(fm => {
        const r = bySegment[seg]?.find(x => x.month === fm.label)
        const v = r ? r[key] : null
        return v ?? ''
      })
      return [seg, ...cells].join('\t')
    })
    const totalRow = ['Total', ...totals.map(t => t[key] ?? '')].join('\t')
    writeClipboard([header, ...rows, totalRow].join('\n'), 'Table copied — paste into Excel.')
  }

  function copySummary() {
    const parts = totals.map(t => `${t.month} ${t.tiv ?? '—'}`).join(' · ')
    const trained = modelParams?.last_data_month ? `, data to ${modelParams.last_data_month}` : ''
    writeClipboard(`TIV forecast — ${parts} (model v3.0${trained})`, 'Summary copied.')
  }
  const jTivRows = buildJudgmentRows(judgmentTiv, forecastMonths)
  const jPtbRows = buildJudgmentRows(judgmentPtb, forecastMonths)

  return (
    <div>
      {/* The active-trigger banner moved to page level (TivForecastPage), so it
          travels with every tab instead of labelling only this one. It also
          used to be nowrap+ellipsis with no magnitude, so with several triggers
          on it silently hid the ones bending the numbers most. */}

      {/* The page's own subtitle says "AL submission preparation", but every
          number left this screen by being retyped — the highest-stakes
          transcription step was the one the tool didn't touch. TSV pastes
          straight into Excel; the one-liner is for WhatsApp. */}
      {/* Layer tabs and the copy actions share one row — two full-width
          buttons above the tabs were louder than the tabs themselves. */}
      <div className="tiv-toolbar">
        <div className="tiv-tabs tiv-tabs-sm" role="tablist" aria-label="Forecast layer">
          {LAYERS.map(layer => (
            <button
              key={layer.id}
              id={'tiv-layertab-' + layer.id}
              className="tiv-tab"
              role="tab"
              type="button"
              aria-selected={activeLayer === layer.id}
              aria-controls={'tiv-layerpanel-' + layer.id}
              onClick={() => setActiveLayer(layer.id)}
            >
              {layer.label}
            </button>
          ))}
        </div>
        <div className="tiv-toolbar-actions">
          {copied && <span className="tiv-sub" role="status">{copied}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => copyTable(activeLayer)}>Copy table</button>
          <button className="btn btn-ghost btn-sm" onClick={copySummary}>Copy summary</button>
        </div>
      </div>

      {/* Active layer table */}
      {LAYERS.filter(l => l.id === activeLayer).map(l => (
        <div
          key={l.id}
          id={'tiv-layerpanel-' + l.id}
          role="tabpanel"
          aria-labelledby={'tiv-layertab-' + l.id}
        >
          <ForecastTable
            layer={l.id}
            title={l.title}
            subtitle={l.subtitle}
            showTitle={false}
            forecastMonths={forecastMonths}
            bySegment={bySegment}
            showShare={l.id !== 'tiv'}
            shareKey={l.id === 'al' ? 'alShare' : 'ptbShare'}
            judgmentRows={l.id === 'tiv' ? jTivRows : l.id === 'ptb' ? jPtbRows : {}}
            showBands={l.id === 'tiv'}
            backtest={modelParams?.model_backtest || []}
            actuals={tivActuals}
            onExplain={l.id === 'tiv' ? setExplain : null}
          />
        </div>
      ))}

      {/* "Where does 736 come from" — every input is already in model_params,
          so this is a formatter, not a second model. It turns the method-map
          footnote from trivia into something checkable. */}
      {explain && (
        <div className="tiv-receipt">
          <button className="tiv-receipt-close" onClick={() => setExplain(null)} aria-label="Close">×</button>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {explain.segment} · {explain.label} = {explain.value}
          </div>
          {(() => {
            const r = explainForecast(explain.segment, explain.label, modelParams)
            if (!r) return <div>No derivation is available for this month.</div>
            const odds = toleranceOdds(explain.segment, modelParams?.model_backtest || [], tivActuals)
            return (
              <>
                <div className="tiv-sub" style={{ marginBottom: 6 }}>Method: {r.methodName}</div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {r.steps.map((s, i) => <li key={i} style={{ marginBottom: 2 }}>{s}</li>)}
                </ol>
                {explain.band && (
                  <div style={{ marginTop: 8 }}>
                    Likely range <strong>{explain.band.low}–{explain.band.high}</strong> — in the{' '}
                    {explain.band.months}-month backtest, all but the best and worst month landed
                    within ±{(explain.band.spread * 100).toFixed(0)}% of the forecast.
                    {odds && <> This segment was inside Ashok Leyland&rsquo;s 15% tolerance in{' '}
                      <strong>{odds.within} of {odds.total}</strong> of those months.</>}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Two permanent footnotes of methodology sat under every visit. Folded:
          a GM opening this monthly wants the number, and the detail is one
          click away rather than deleted. */}
      <details className="tiv-fold">
        <summary>How these numbers are worked out</summary>
        <div style={{ marginTop: 6 }}>
          <div style={{ marginBottom: 4 }}>
            Each segment uses the estimator that backtested best for it:{' '}
            <strong>Bus PVT, Tractor, Tipper</strong> — last year&rsquo;s same month (smoothed) grown by
            the last twelve months&rsquo; trend · <strong>Haulage, MAV</strong> — 60% that figure,
            40% a longer-run trend · <strong>ICV Trucks</strong> — a level-shift adapter, because
            demand moved further than the usual ±15% limit can express.
          </div>
          <div>
            Click any forecast to see exactly how it was worked out. Judgment is shown for comparison
            only and never enters the forecast; all what-if adjustments are off unless the banner
            above says otherwise.
          </div>
        </div>
      </details>
    </div>
  )
}
