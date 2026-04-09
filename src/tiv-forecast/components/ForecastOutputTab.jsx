// TIV Forecast — Forecast Output Tab
// 3 layers shown as sub-tabs to avoid vertical scroll
import { useState } from 'react'
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
        <div className="empty-icon">📊</div>
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
      {/* Active trigger context banner */}
      {activeTriggers.length > 0 && (
        <div style={{
          background: 'var(--amber-light, #FFF8E1)',
          border: '1px solid var(--amber, #F59E0B)',
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 13,
        }}>
          <strong>Active adjustments:</strong>{' '}
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
          forecastMonths={forecastMonths}
          bySegment={bySegment}
          judgmentRows={jTivRows}
        />
      )}
      {activeLayer === 'al' && (
        <ForecastTable
          title="Layer 2 — AL Forecast (Ashok Leyland volume)"
          subtitle="AL = PTB + LM · Share = recent 6-month avg of AL/TIV"
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
          forecastMonths={forecastMonths}
          bySegment={bySegment}
          showShare
          shareKey="ptbShare"
          judgmentRows={jPtbRows}
        />
      )}
    </div>
  )
}
