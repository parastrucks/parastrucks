// TIV Forecast — Forecast Output Tab
// 3 layers shown as sub-tabs to avoid vertical scroll
import { useState } from 'react'
import Icon from '../../components/Icon'
import { useAuth } from '../../context/AuthContext'
import ForecastTable from './ForecastTable'

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

export default function ForecastOutputTab({ forecastResult, judgmentTiv, judgmentPtb }) {
  const { profile } = useAuth()
  const isAdmin = profile?.permission_level === 'admin'
  const [activeLayer, setActiveLayer] = useState('tiv')

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

  const { forecastMonths, bySegment } = forecastResult
  const jTivRows = buildJudgmentRows(judgmentTiv, forecastMonths)
  const jPtbRows = buildJudgmentRows(judgmentPtb, forecastMonths)

  return (
    <div>
      {/* The active-trigger banner moved to page level (TivForecastPage), so it
          travels with every tab instead of labelling only this one. It also
          used to be nowrap+ellipsis with no magnitude, so with several triggers
          on it silently hid the ones bending the numbers most. */}

      {/* Layer sub-tabs */}
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
          />
        </div>
      ))}

      {/* Method map — which estimator produced each row (spec §5.5) */}
      <div className="tiv-note tiv-note-top">
        <div style={{ marginBottom: 4 }}>
          <strong style={{ color: 'var(--gray-600)' }}>Method per segment</strong>
          {' · '}Bus PVT, Tractor, Tipper <strong>ROB</strong> (robust-anchor SMLY × trailing-12M growth)
          {' · '}Haulage, MAV <strong>THETA</strong> (60% SMLY + 40% Theta)
          {' · '}ICV Trucks <strong>ADAPT</strong> (level-shift adapter)
        </div>
        <div>
          All triggers are OFF by default — the base forecast is untouched historical data.
          Judgment is shown for comparison only and never enters the forecast.
        </div>
      </div>
    </div>
  )
}
