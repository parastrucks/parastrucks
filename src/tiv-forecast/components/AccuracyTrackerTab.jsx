// TIV Forecast — Accuracy Tracker Tab
// Pivot table: rows = months, columns = segments, cells = error% (color coded)
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

function errBg(ae) {
  if (ae === null) return 'transparent'
  if (ae <= AL_TOLERANCE) return 'rgba(34,197,94,0.08)'
  if (ae <= 0.25) return 'rgba(245,158,11,0.10)'
  return 'rgba(239,68,68,0.08)'
}

function fmtPct(val) {
  if (val === null || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

function buildBacktest(tivActuals, judgmentTiv) {
  const rows = []
  if (!judgmentTiv?.length || !tivActuals?.length) return rows

  const actualMap = {}
  for (const r of tivActuals) actualMap[r.month_label] = r

  for (const jRow of judgmentTiv) {
    const aRow = actualMap[jRow.month_label]
    if (!aRow) continue

    for (const seg of SEGMENTS) {
      const col  = SEG_COL[seg]
      const jVal = Number(jRow[col])
      const aVal = Number(aRow[col])
      if (!jVal && !aVal) continue
      rows.push({
        month:    jRow.month_label,
        segment:  seg,
        forecast: jVal,
        actual:   aVal,
        absErr:   absErr(jVal, aVal),
      })
    }
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month))
}

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
  const backtest     = useMemo(() => buildBacktest(tivActuals, judgmentTiv), [tivActuals, judgmentTiv])
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

  const months = [...new Set(backtest.map(r => r.month))]

  // Lookup: "month|segment" → row
  const lookup = {}
  for (const row of backtest) lookup[`${row.month}|${row.segment}`] = row

  return (
    <div>
      {/* MAPE bar chart */}
      {mapeChartData.length > 0 && (
        <div className="card mb-24">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>MAPE by Segment</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 12 }}>
            Mean absolute % error of judgment forecasts vs actuals
          </div>
          <SegmentChart
            type="bar"
            data={mapeChartData}
            xKey="segment"
            series={[{ key: 'MAPE', name: 'MAPE %', color: 'var(--blue)' }]}
            referenceLines={[{ value: 15, color: 'var(--green)', label: '15% AL tolerance' }]}
            height={200}
          />
        </div>
      )}

      {/* Pivot table */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Judgment vs Actual — {months[0]} to {months[months.length - 1]}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>●</span> ≤15% &nbsp;
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>●</span> ≤25% &nbsp;
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>●</span> &gt;25%
          </div>
        </div>

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--gray-200)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap', width: 72 }}>
                  Month
                </th>
                {SEGMENTS.map(seg => (
                  <th key={seg} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, minWidth: 100 }}>
                    {seg}
                  </th>
                ))}
              </tr>
              <tr style={{ borderBottom: '1px solid var(--gray-100)', fontSize: 11, color: 'var(--gray-400)' }}>
                <th></th>
                {SEGMENTS.map(seg => (
                  <th key={seg} style={{ textAlign: 'center', padding: '3px 8px', fontWeight: 400 }}>
                    Jdg · Act · Err%
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map(month => (
                <tr key={month} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                  <td style={{ fontWeight: 600, padding: '8px 10px', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {month}
                  </td>
                  {SEGMENTS.map(seg => {
                    const row = lookup[`${month}|${seg}`]
                    if (!row) {
                      return (
                        <td key={seg} style={{ textAlign: 'center', padding: '8px 8px', color: 'var(--gray-300)' }}>
                          —
                        </td>
                      )
                    }
                    const ae = row.absErr
                    return (
                      <td key={seg} style={{
                        textAlign: 'center',
                        padding: '6px 8px',
                        background: errBg(ae),
                        borderRadius: 4,
                      }}>
                        <div style={{ fontWeight: 700, color: errColor(ae), fontSize: 14 }}>
                          {fmtPct(ae)}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 1 }}>
                          {row.forecast} · {row.actual}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}

              {/* MAPE summary row */}
              <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                <td style={{ fontWeight: 700, padding: '8px 10px', fontSize: 12 }}>MAPE</td>
                {SEGMENTS.map(seg => {
                  const mape = mapeBySegment[seg]
                  const ae   = mape !== null ? mape / 100 : null
                  return (
                    <td key={seg} style={{
                      textAlign: 'center',
                      padding: '8px 8px',
                      fontWeight: 700,
                      color: errColor(ae),
                      fontSize: 14,
                    }}>
                      {mape !== null ? `${mape.toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
