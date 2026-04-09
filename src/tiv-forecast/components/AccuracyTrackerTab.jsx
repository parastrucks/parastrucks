// TIV Forecast — Accuracy Tracker Tab
// Backtests model and judgment forecasts against actuals from Aug-25 onwards
import { useMemo } from 'react'
import { SEGMENTS, SEG_COL, AL_TOLERANCE } from '../constants'
import SegmentChart from './SegmentChart'

function absErr(forecast, actual) {
  if (!actual || actual === 0) return null
  return Math.abs((forecast - actual) / actual)
}

function errColor(ae) {
  if (ae === null) return 'inherit'
  if (ae <= AL_TOLERANCE) return 'var(--green)'
  if (ae <= 0.25) return '#F59E0B'
  return 'var(--red)'
}

function fmtPct(val) {
  if (val === null || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

// Build backtest rows: months where judgment predictions exist AND actuals exist
// We compare judgment TIV vs actual TIV per segment
function buildBacktest(tivActuals, judgmentTiv) {
  const rows = []
  if (!judgmentTiv?.length || !tivActuals?.length) return rows

  const actualMap = {}
  for (const r of tivActuals) actualMap[r.month_label] = r

  for (const jRow of judgmentTiv) {
    const aRow = actualMap[jRow.month_label]
    if (!aRow) continue  // Actuals not yet available for future months

    for (const seg of SEGMENTS) {
      const col = SEG_COL[seg]
      const jVal  = Number(jRow[col])
      const aVal  = Number(aRow[col])
      if (!jVal && !aVal) continue
      const ae = absErr(jVal, aVal)
      rows.push({
        month:    jRow.month_label,
        segment:  seg,
        forecast: jVal,
        actual:   aVal,
        absErr:   ae,
      })
    }
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month))
}

// MAPE per segment
function computeMAPE(rows) {
  const mape = {}
  for (const seg of SEGMENTS) {
    const segRows = rows.filter(r => r.segment === seg && r.absErr !== null)
    mape[seg] = segRows.length > 0
      ? segRows.reduce((sum, r) => sum + r.absErr, 0) / segRows.length * 100
      : null
  }
  return mape
}

export default function AccuracyTrackerTab({ tivActuals, judgmentTiv }) {
  const backtest = useMemo(() => buildBacktest(tivActuals, judgmentTiv), [tivActuals, judgmentTiv])
  const mapeBySegment = useMemo(() => computeMAPE(backtest), [backtest])

  const mapeChartData = SEGMENTS
    .filter(seg => mapeBySegment[seg] !== null)
    .map(seg => ({ segment: seg, MAPE: parseFloat(mapeBySegment[seg]?.toFixed(1)) }))

  if (!backtest.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎯</div>
        <div className="empty-title">No backtest data yet</div>
        <div className="empty-desc">
          Accuracy tracking begins once judgment predictions have been recorded and the corresponding month's actuals are available.
        </div>
      </div>
    )
  }

  // Group rows by month for display
  const months = [...new Set(backtest.map(r => r.month))]

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
        Comparing recorded judgment forecasts against actual TIV data.
        Color bands: <span style={{ color: 'var(--green)', fontWeight: 600 }}>green ≤15%</span>{' · '}
        <span style={{ color: '#F59E0B', fontWeight: 600 }}>amber ≤25%</span>{' · '}
        <span style={{ color: 'var(--red)', fontWeight: 600 }}>red &gt;25%</span>{' '}
        (AL tolerance threshold: 15%)
      </div>

      {/* MAPE bar chart */}
      {mapeChartData.length > 0 && (
        <div className="card mb-24">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            MAPE by Segment (judgment vs actual TIV)
          </div>
          <SegmentChart
            type="bar"
            data={mapeChartData}
            xKey="segment"
            series={[{ key: 'MAPE', name: 'MAPE %', color: 'var(--blue)' }]}
            referenceLines={[{ value: 15, color: 'var(--green)', label: '15% AL tolerance' }]}
            height={220}
          />
        </div>
      )}

      {/* Backtest detail table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Segment</th>
              <th style={{ textAlign: 'right' }}>Judgment</th>
              <th style={{ textAlign: 'right' }}>Actual</th>
              <th style={{ textAlign: 'right' }}>Error %</th>
            </tr>
          </thead>
          <tbody>
            {backtest.map((row, i) => (
              <tr key={`${row.month}-${row.segment}`}>
                <td style={{ whiteSpace: 'nowrap' }}>{row.month}</td>
                <td>{row.segment}</td>
                <td style={{ textAlign: 'right' }}>{row.forecast ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{row.actual ?? '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: errColor(row.absErr) }}>
                  {fmtPct(row.absErr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
