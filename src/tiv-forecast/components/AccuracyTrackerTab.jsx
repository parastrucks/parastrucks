// TIV Forecast — Accuracy Tracker Tab
// Pivot: rows = months, columns = segment × (MDL err%, JDG err%)
import { useMemo } from 'react'
import { SEGMENTS, SEG_COL, AL_TOLERANCE } from '../constants'
import SegmentChart from './SegmentChart'

function absErr(forecast, actual) {
  if (!actual || actual === 0 || forecast === null || forecast === undefined) return null
  return Math.abs((forecast - actual) / actual)
}

function errColor(ae) {
  if (ae === null) return 'var(--gray-300)'
  if (ae <= AL_TOLERANCE) return 'var(--green)'
  if (ae <= 0.25) return '#F59E0B'
  return 'var(--red)'
}

function fmtPct(val) {
  if (val === null || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

// Build backtest rows for judgment vs actual
function buildJudgmentBacktest(tivActuals, judgmentTiv) {
  if (!judgmentTiv?.length || !tivActuals?.length) return {}
  const actualMap = {}
  for (const r of tivActuals) actualMap[r.month_label] = r
  const lookup = {}
  for (const jRow of judgmentTiv) {
    const aRow = actualMap[jRow.month_label]
    if (!aRow) continue
    lookup[jRow.month_label] = {}
    for (const seg of SEGMENTS) {
      const col = SEG_COL[seg]
      const jVal = Number(jRow[col])
      const aVal = Number(aRow[col])
      lookup[jRow.month_label][seg] = { jVal, aVal, ae: absErr(jVal, aVal) }
    }
  }
  return lookup
}

// Build model backtest lookup from stored model_backtest
function buildModelBacktest(tivActuals, modelBacktest) {
  if (!modelBacktest?.length || !tivActuals?.length) return {}
  const actualMap = {}
  for (const r of tivActuals) actualMap[r.month_label] = r
  const lookup = {}
  for (const mRow of modelBacktest) {
    const aRow = actualMap[mRow.month_label]
    if (!aRow) continue
    lookup[mRow.month_label] = {}
    for (const seg of SEGMENTS) {
      const col = SEG_COL[seg]
      const mVal = Number(mRow[col])
      const aVal = Number(aRow[col])
      lookup[mRow.month_label][seg] = { mVal, aVal, ae: absErr(mVal, aVal) }
    }
  }
  return lookup
}

function computeMAPE(lookup) {
  const mape = {}
  for (const seg of SEGMENTS) {
    const vals = Object.values(lookup)
      .map(m => m[seg]?.ae)
      .filter(v => v !== null && v !== undefined)
    mape[seg] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length * 100 : null
  }
  return mape
}

export default function AccuracyTrackerTab({ tivActuals, judgmentTiv, modelParams }) {
  const modelBacktest = modelParams?.model_backtest || []

  const jLookup  = useMemo(() => buildJudgmentBacktest(tivActuals, judgmentTiv), [tivActuals, judgmentTiv])
  const mdlLookup = useMemo(() => buildModelBacktest(tivActuals, modelBacktest), [tivActuals, modelBacktest])

  const jMape   = useMemo(() => computeMAPE(jLookup),   [jLookup])
  const mdlMape = useMemo(() => computeMAPE(mdlLookup), [mdlLookup])

  const hasJdg = Object.keys(jLookup).length > 0
  const hasMdl = Object.keys(mdlLookup).length > 0

  // All months across both sources, sorted
  const months = useMemo(() => {
    const set = new Set([...Object.keys(jLookup), ...Object.keys(mdlLookup)])
    return [...set].sort()
  }, [jLookup, mdlLookup])

  // MAPE chart data — prefer judgment if available, fallback to model
  const mapeChartData = SEGMENTS
    .map(seg => ({
      segment: seg,
      ...(hasJdg  ? { 'Judgment MAPE': jMape[seg]   !== null ? parseFloat(jMape[seg].toFixed(1))   : null } : {}),
      ...(hasMdl  ? { 'Model MAPE':    mdlMape[seg] !== null ? parseFloat(mdlMape[seg].toFixed(1)) : null } : {}),
    }))
    .filter(d => d['Judgment MAPE'] !== null || d['Model MAPE'] !== null)

  if (!hasJdg && !hasMdl) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🎯</div>
        <div className="empty-title">No accuracy data yet</div>
        <div className="empty-desc">
          Upload data to see model accuracy. Judgment accuracy appears once recorded predictions have matching actuals.
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* MAPE bar chart */}
      {mapeChartData.length > 0 && (
        <div className="card mb-16">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>MAPE by Segment</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 10 }}>
            Mean absolute % error vs actuals
          </div>
          <SegmentChart
            type="bar"
            data={mapeChartData}
            xKey="segment"
            series={[
              ...(hasMdl ? [{ key: 'Model MAPE',    name: 'Model MAPE %',    color: 'var(--blue)' }] : []),
              ...(hasJdg ? [{ key: 'Judgment MAPE', name: 'Judgment MAPE %', color: 'var(--amber)' }] : []),
            ]}
            referenceLines={[{ value: 15, color: 'var(--green)', label: '15% AL tolerance' }]}
            height={200}
          />
        </div>
      )}

      {/* Pivot table */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {months[0]} — {months[months.length - 1]}
          </div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>
            {hasMdl && <span style={{ color: 'var(--blue)', fontWeight: 600 }}>● Model</span>}
            {hasMdl && hasJdg && ' · '}
            {hasJdg && <span style={{ color: '#F59E0B', fontWeight: 600 }}>● Judgment</span>}
            &nbsp;&nbsp;
            <span style={{ color: 'var(--green)', fontWeight: 600 }}>●</span> ≤15%
            {' · '}<span style={{ color: '#F59E0B', fontWeight: 600 }}>●</span> ≤25%
            {' · '}<span style={{ color: 'var(--red)', fontWeight: 600 }}>●</span> &gt;25%
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--gray-200)' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px', width: 60 }}>Month</th>
                {SEGMENTS.map(seg => (
                  <th key={seg} style={{ textAlign: 'center', padding: '5px 4px', minWidth: hasMdl && hasJdg ? 110 : 80 }}>
                    {seg}
                  </th>
                ))}
              </tr>
              {hasMdl && hasJdg && (
                <tr style={{ borderBottom: '1px solid var(--gray-100)', fontSize: 11, color: 'var(--gray-400)' }}>
                  <th></th>
                  {SEGMENTS.map(seg => (
                    <th key={seg} style={{ textAlign: 'center', fontWeight: 400, padding: '2px 4px' }}>
                      <span style={{ color: 'var(--blue)' }}>MDL</span>
                      {' · '}
                      <span style={{ color: '#F59E0B' }}>JDG</span>
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {months.map(month => (
                <tr key={month} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                  <td style={{ fontWeight: 600, padding: '6px 8px', whiteSpace: 'nowrap', fontSize: 11 }}>
                    {month}
                  </td>
                  {SEGMENTS.map(seg => {
                    const mCell = mdlLookup[month]?.[seg]
                    const jCell = jLookup[month]?.[seg]
                    if (!mCell && !jCell) return <td key={seg} style={{ textAlign: 'center', color: 'var(--gray-300)', padding: '6px 4px' }}>—</td>

                    return (
                      <td key={seg} style={{ textAlign: 'center', padding: '4px 4px' }}>
                        {hasMdl && hasJdg ? (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 700, color: errColor(mCell?.ae ?? null), fontSize: 12 }}>
                              {fmtPct(mCell?.ae ?? null)}
                            </span>
                            <span style={{ color: 'var(--gray-200)' }}>·</span>
                            <span style={{ fontWeight: 700, color: errColor(jCell?.ae ?? null), fontSize: 12 }}>
                              {fmtPct(jCell?.ae ?? null)}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontWeight: 700, color: errColor((mCell ?? jCell)?.ae ?? null), fontSize: 12 }}>
                            {fmtPct((mCell ?? jCell)?.ae ?? null)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}

              {/* MAPE row */}
              <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                <td style={{ fontWeight: 700, padding: '6px 8px', fontSize: 11 }}>MAPE</td>
                {SEGMENTS.map(seg => (
                  <td key={seg} style={{ textAlign: 'center', padding: '6px 4px' }}>
                    {hasMdl && hasJdg ? (
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, color: errColor(mdlMape[seg] !== null ? mdlMape[seg] / 100 : null), fontSize: 12 }}>
                          {mdlMape[seg] !== null ? `${mdlMape[seg].toFixed(1)}%` : '—'}
                        </span>
                        <span style={{ color: 'var(--gray-200)' }}>·</span>
                        <span style={{ fontWeight: 700, color: errColor(jMape[seg] !== null ? jMape[seg] / 100 : null), fontSize: 12 }}>
                          {jMape[seg] !== null ? `${jMape[seg].toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontWeight: 700, color: errColor((hasMdl ? mdlMape : jMape)[seg] !== null ? (hasMdl ? mdlMape : jMape)[seg] / 100 : null), fontSize: 12 }}>
                        {(hasMdl ? mdlMape : jMape)[seg] !== null ? `${(hasMdl ? mdlMape : jMape)[seg].toFixed(1)}%` : '—'}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
