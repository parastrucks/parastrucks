// TIV Forecast — Forecast Output Tab
// 3 layers shown as sub-tabs to avoid vertical scroll
import { useState } from 'react'
import Icon from '../../components/Icon'
import { TRIGGER_DEFS } from '../lib/triggerDefs'
import ForecastTable from './ForecastTable'

const LAYERS = [
  { id: 'tiv', label: 'Layer 1 — TIV' },
  { id: 'al',  label: 'Layer 2 — AL' },
  { id: 'ptb', label: 'Layer 3 — PTB' },
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

export default function ForecastOutputTab({ forecastResult, judgmentTiv, judgmentPtb, triggerState }) {
  const [activeLayer, setActiveLayer] = useState('tiv')

  if (!forecastResult) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Icon name="chart" size={34} color="var(--text-muted)" /></div>
        <div className="empty-title">No forecast data</div>
        <div className="empty-desc">Upload a Market Data file to generate forecasts.</div>
      </div>
    )
  }

  const { forecastMonths, bySegment } = forecastResult
  const activeTriggers = TRIGGER_DEFS.filter(d => triggerState?.[d.id]?.on)
  const jTivRows = buildJudgmentRows(judgmentTiv, forecastMonths)
  const jPtbRows = buildJudgmentRows(judgmentPtb, forecastMonths)

  return (
    <div>
      {/* Active trigger context banner — single line, truncated */}
      {activeTriggers.length > 0 && (
        <div style={{
          background: 'var(--amber-light)',
          border: '1px solid var(--amber)',
          borderRadius: 'var(--radius-sm)',
          padding: '7px 12px',
          marginBottom: 12,
          fontSize: 13,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          <strong>Active:</strong>{' '}
          {activeTriggers.map(t => t.name).join(' · ')}
        </div>
      )}

      {/* Layer sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--gray-100)', paddingBottom: 0 }}>
        {LAYERS.map(layer => (
          <button
            key={layer.id}
            onClick={() => setActiveLayer(layer.id)}
            style={{
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: activeLayer === layer.id ? 700 : 400,
              color: activeLayer === layer.id ? 'var(--blue)' : 'var(--gray-500)',
              background: 'none',
              border: 'none',
              borderBottom: activeLayer === layer.id ? '2px solid var(--blue)' : '2px solid transparent',
              marginBottom: -2,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {layer.label}
          </button>
        ))}
      </div>

      {/* Active layer table */}
      {activeLayer === 'tiv' && (
        <ForecastTable
          title="Layer 1 — TIV Forecast (Total Industry Volume)"
          subtitle="All brands combined in PTB territory"
          showTitle={false}
          forecastMonths={forecastMonths}
          bySegment={bySegment}
          judgmentRows={jTivRows}
        />
      )}
      {activeLayer === 'al' && (
        <ForecastTable
          title="Layer 2 — AL Forecast (Ashok Leyland volume)"
          subtitle="AL = PTB + LM · Share = recent 6-month avg of AL/TIV"
          showTitle={false}
          forecastMonths={forecastMonths}
          bySegment={bySegment}
          showShare
          shareKey="alShare"
          judgmentRows={{}}
        />
      )}
      {activeLayer === 'ptb' && (
        <ForecastTable
          title="Layer 3 — PTB Sales Forecast"
          subtitle="PTB share of AL · Hard cap at 75% (LM must survive)"
          showTitle={false}
          forecastMonths={forecastMonths}
          bySegment={bySegment}
          showShare
          shareKey="ptbShare"
          judgmentRows={jPtbRows}
        />
      )}

      {/* Method map — which estimator produced each row (spec §5.5) */}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--gray-100)',
        fontSize: 12, color: 'var(--gray-500)', lineHeight: 1.7,
      }}>
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
