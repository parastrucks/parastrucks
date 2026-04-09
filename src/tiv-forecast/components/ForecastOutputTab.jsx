// TIV Forecast — Forecast Output Tab
import { TRIGGER_DEFS } from '../lib/triggerDefs'
import ForecastTable from './ForecastTable'

function buildJudgmentRows(judgmentData, forecastMonths, valueKey) {
  const rows = {}
  if (!judgmentData?.length) return rows
  for (const fm of forecastMonths) {
    const jRow = judgmentData.find(r => r.month_label === fm.month)
    if (jRow) {
      // Convert to { [segName]: value } using the standard column mapping
      rows[fm.month] = {
        'Bus PVT':   jRow.bus_pvt,
        'Haulage':   jRow.haulage,
        'MAV':       jRow.mav,
        'Tractor':   jRow.tractor,
        'Tipper':    jRow.tipper,
        'ICV Trucks':jRow.icv_trucks,
      }
    }
  }
  return rows
}

export default function ForecastOutputTab({ forecastResult, judgmentTiv, judgmentPtb, triggerState }) {
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

  // Active trigger warnings
  const activeTriggers = TRIGGER_DEFS.filter(d => triggerState?.[d.id]?.on)

  // Build judgment comparison rows
  const jTivRows = buildJudgmentRows(judgmentTiv, forecastMonths, 'tiv_total')
  const jPtbRows = buildJudgmentRows(judgmentPtb, forecastMonths, 'total_sale')

  return (
    <div>
      {/* Active trigger context banner */}
      {activeTriggers.length > 0 && (
        <div style={{
          background: 'var(--amber-light, #FFF8E1)',
          border: '1px solid var(--amber, #F59E0B)',
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 20,
          fontSize: 13,
        }}>
          <strong>Active adjustments:</strong>{' '}
          {activeTriggers.map(t => t.name).join(' · ')}
        </div>
      )}

      <ForecastTable
        title="Layer 1 — TIV Forecast (Total Industry Volume)"
        subtitle="All brands combined in PTB territory"
        forecastMonths={forecastMonths}
        bySegment={bySegment}
        judgmentRows={jTivRows}
      />

      <ForecastTable
        title="Layer 2 — AL Forecast (Ashok Leyland volume)"
        subtitle="AL = PTB + LM · Share = recent 6-month avg of AL/TIV"
        forecastMonths={forecastMonths}
        bySegment={bySegment}
        showShare
        shareKey="alShare"
        judgmentRows={{}}
      />

      <ForecastTable
        title="Layer 3 — PTB Sales Forecast"
        subtitle="PTB share of AL · Hard cap at 75% (LM must survive)"
        forecastMonths={forecastMonths}
        bySegment={bySegment}
        showShare
        shareKey="ptbShare"
        judgmentRows={jPtbRows}
      />
    </div>
  )
}
