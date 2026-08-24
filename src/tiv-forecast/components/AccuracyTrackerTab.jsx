// TIV Forecast — Accuracy Tracker Tab
// Pivot: rows = months, columns = segment × (MDL | JDG) as separate <td> columns
import { useMemo, useState, Fragment } from 'react'
import Icon from '../../components/Icon'
import { SEGMENTS, SEG_COL, AL_TOLERANCE } from '../constants'
import SegmentChart from './SegmentChart'

function absErr(forecast, actual) {
  if (!actual || actual === 0 || forecast === null || forecast === undefined) return null
  return Math.abs((forecast - actual) / actual)
}

function sevClass(ae) {
  if (ae === null || ae === undefined) return 'tiv-sev tiv-sev-none'
  if (ae <= AL_TOLERANCE) return 'tiv-sev tiv-sev-good'
  if (ae <= 0.25) return 'tiv-sev tiv-sev-warn'
  return 'tiv-sev tiv-sev-bad'
}

function fmtPct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

const ALL_COLS = [...SEGMENTS, 'Total']

function buildJudgmentBacktest(tivActuals, judgmentTiv) {
  if (!judgmentTiv?.length || !tivActuals?.length) return {}
  const actualMap = {}
  for (const r of tivActuals) actualMap[r.month_label] = r
  const lookup = {}
  for (const jRow of judgmentTiv) {
    const aRow = actualMap[jRow.month_label]
    if (!aRow) continue
    lookup[jRow.month_label] = {}
    // The parser deliberately preserves a blank judgment cell as null — nobody
    // made a call that month. `Number(null)` is 0, which turned "no judgment"
    // into "judgment said zero": a fake 100% error, shown in red, asserting a
    // prediction nobody made. Every one of those also inflated the judgment
    // MAPE, biasing the model-vs-judgment comparison this tab exists to make.
    let jComplete = true
    for (const seg of SEGMENTS) {
      const col = SEG_COL[seg]
      const raw = jRow[col]
      const jVal = raw === null || raw === undefined || raw === '' ? null : Number(raw)
      if (jVal === null) jComplete = false
      const aVal = Number(aRow[col])
      lookup[jRow.month_label][seg] = { jVal, aVal, ae: jVal === null ? null : absErr(jVal, aVal) }
    }
    // Total TIV — only when every segment was judged; a total summed over the
    // segments that happen to be present is not comparable to the model's.
    const jTot = jComplete ? SEGMENTS.reduce((s, seg) => s + Number(jRow[SEG_COL[seg]]), 0) : null
    const aTot = SEGMENTS.reduce((s, seg) => s + (Number(aRow[SEG_COL[seg]]) || 0), 0)
    lookup[jRow.month_label]['Total'] = { jVal: jTot, aVal: aTot, ae: jTot === null ? null : absErr(jTot, aTot) }
  }
  return lookup
}

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
    // Total TIV
    const mTot = SEGMENTS.reduce((s, seg) => s + (Number(mRow[SEG_COL[seg]]) || 0), 0)
    const aTot = SEGMENTS.reduce((s, seg) => s + (Number(aRow[SEG_COL[seg]]) || 0), 0)
    lookup[mRow.month_label]['Total'] = { mVal: mTot, aVal: aTot, ae: absErr(mTot, aTot) }
  }
  return lookup
}

function computeMAPE(lookup) {
  const mape = {}
  for (const col of ALL_COLS) {
    const vals = Object.values(lookup)
      .map(m => m[col]?.ae)
      .filter(v => v !== null && v !== undefined)
    mape[col] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length * 100 : null
  }
  return mape
}

// Cell styles

function fmtNum(v) {
  return v === null || v === undefined || isNaN(v) ? '—' : Math.round(v)
}

// Error % at rest; forecast/actual on hover. `title` carries the fully labelled
// breakdown including the other estimate, so one hover answers "how far off was
// the model, and did judgment do better?" without reading across the table.
function ErrCell({ ae, forecast, actual, kind, peerLabel, peerForecast, peerAe, style = {} }) {
  const hasVals = forecast !== undefined && actual !== undefined

  let title
  if (hasVals) {
    const lines = [
      `Actual ${fmtNum(actual)}`,
      `${kind} ${fmtNum(forecast)}  (${fmtPct(ae ?? null)} error)`,
    ]
    if (peerForecast !== undefined && peerForecast !== null) {
      lines.push(`${peerLabel} ${fmtNum(peerForecast)}  (${fmtPct(peerAe ?? null)} error)`)
    }
    title = lines.join('\n')
  }

  return (
    <td
      className={[hasVals ? 'tiv-cell' : '', 'tiv-num', sevClass(ae ?? null)].filter(Boolean).join(' ')}
      title={title}
      aria-label={title ? title.split(String.fromCharCode(10)).join(', ') : undefined}
      tabIndex={hasVals ? 0 : undefined}
      style={{ fontWeight: 700, whiteSpace: 'nowrap', ...style }}
    >
      <span className="tiv-cell-err">{fmtPct(ae ?? null)}</span>
      {hasVals && (
        <span className="tiv-cell-val">
          {fmtNum(forecast)}
          <span className="tiv-cell-sep">/</span>
          <span className="tiv-cell-actual">{fmtNum(actual)}</span>
        </span>
      )}
    </td>
  )
}

export default function AccuracyTrackerTab({ tivActuals, judgmentTiv, modelParams }) {
  // Hover alone would put the underlying numbers out of reach for keyboard and
  // touch users, so the same reveal is available as an explicit toggle.
  const [showValues, setShowValues] = useState(false)
  const modelBacktest = modelParams?.model_backtest || []

  const jLookup   = useMemo(() => buildJudgmentBacktest(tivActuals, judgmentTiv), [tivActuals, judgmentTiv])
  const mdlLookup  = useMemo(() => buildModelBacktest(tivActuals, modelBacktest), [tivActuals, modelBacktest])

  const jMape    = useMemo(() => computeMAPE(jLookup),   [jLookup])
  const mdlMape  = useMemo(() => computeMAPE(mdlLookup), [mdlLookup])

  const hasJdg = Object.keys(jLookup).length > 0
  const hasMdl = Object.keys(mdlLookup).length > 0
  const hasBoth = hasJdg && hasMdl

  const months = useMemo(() => {
    const set = new Set([...Object.keys(jLookup), ...Object.keys(mdlLookup)])
    // Sort chronologically using parseMonthLabel's month_index
    return [...set].sort((a, b) => {
      const ai = (()=>{ const m=a.match(/^([A-Za-z]{3})-(\d{2})$/); if(!m) return 0; const mn={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}; return (parseInt(m[2])+2000)*12+mn[m[1]]; })()
      const bi = (()=>{ const m=b.match(/^([A-Za-z]{3})-(\d{2})$/); if(!m) return 0; const mn={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}; return (parseInt(m[2])+2000)*12+mn[m[1]]; })()
      return ai - bi
    })
  }, [jLookup, mdlLookup])

  // MAPE chart data
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
        <div className="empty-icon"><Icon name="chart" size={34} color="var(--text-muted)" /></div>
        <div className="empty-title">No accuracy data yet</div>
        <div className="empty-desc">
          Upload data to see model accuracy. Judgment accuracy appears once recorded predictions have matching actuals.
        </div>
      </div>
    )
  }

  // Column count per segment: 2 if both MDL+JDG, else 1
  const segCols = hasBoth ? 2 : 1

  return (
    <div>
      {/* Methodology caption — what this backtest is, and what it replaced */}
      <div className="card mb-16" style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--gray-500)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 4 }}>
          How to read this
        </div>
        <div>
          Corrected <strong>12-month walk-forward</strong> backtest (Aug-25 to Jul-26): for each month
          the model is refit on data <em>strictly prior</em> to it, then forecasts one step ahead.
          Reference result on the source workbook — <strong>model 26.4%</strong> vs
          {' '}<strong>judgment 28.6%</strong>.
        </div>
        <div style={{ marginTop: 6 }}>
          Judgment is a <strong>benchmark column only</strong>; it never enters the forecast.
          Colour thresholds: ≤15% (the Ashok Leyland tolerance) green, ≤25% amber, above that red.
        </div>
        <div style={{ marginTop: 6, color: 'var(--amber)' }}>
          ⚠ The earlier v2.x backtest is <strong>withdrawn</strong>, not merely superseded. It compared
          fiscal-year-to-date against a <em>full</em> prior fiscal year, which pinned growth at −15% in
          56 of 72 segment-months and invalidated every model selection made on it. All figures here use
          period-matched estimators.
        </div>
      </div>

      {/* MAPE bar chart */}
      {mapeChartData.length > 0 && (
        <div className="card mb-16">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>MAPE by Segment</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 10 }}>
            Mean absolute % error vs actuals
          </div>
          <SegmentChart
            type="bar"
            data={mapeChartData}
            xKey="segment"
            series={[
              ...(hasMdl ? [{ key: 'Model MAPE',    name: 'Model MAPE %',    color: 'var(--blue)' }] : []),
              ...(hasJdg ? [{ key: 'Judgment MAPE', name: 'Judgment MAPE %', color: 'var(--ink)' }] : []),
            ]}
            referenceLines={[{ value: 15, color: 'var(--green)', label: '15% AL tolerance' }]}
            height={200}
          />
        </div>
      )}

      {/* Pivot table */}
      <div className="card">
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {months[0]} — {months[months.length - 1]}
          </div>
          <div style={{ color: 'var(--gray-500)' }}>
            {hasMdl && <span style={{ color: 'var(--blue)', fontWeight: 700 }}>● Model</span>}
            {hasBoth && <span style={{ color: 'var(--gray-500)' }}> · </span>}
            {hasJdg && <span style={{ color: 'var(--ink)', fontWeight: 700 }}>● Judgment</span>}
          </div>
          <div className="tiv-note">
            <span className="tiv-sev tiv-sev-good">within 15%</span>
            {' · '}
            <span className="tiv-sev tiv-sev-warn">to 25%</span>
            {' · '}
            <span className="tiv-sev tiv-sev-bad">over 25%</span>
          </div>
          <button
            type="button"
            className="btn-ghost"
            aria-pressed={showValues}
            onClick={() => setShowValues(v => !v)}
            style={{ fontSize: 12, padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {showValues ? 'Show error %' : 'Show forecast/actual'}
          </button>
        </div>
        <div className="tiv-scroll">
          <table className={'tiv-table tiv-table-dense' + (showValues ? ' tiv-values-shown' : '')} style={{ minWidth: '100%' }}>
            <caption>
              Absolute percentage error per segment per month. Cells show the error;
              hover, focus, or use the toggle above to read forecast/actual instead.
            </caption>
            <thead>
              {/* Row 1: Month + segment group headers */}
              <tr style={{ borderBottom: hasBoth ? '1px solid var(--gray-200)' : '2px solid var(--gray-200)' }}>
                <th scope="col" style={{ textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap', minWidth: 64, borderBottom: hasBoth ? 'none' : undefined }}>
                  Month
                </th>
                {SEGMENTS.map(seg => (
                  <th
                    key={seg}
                    scope="col"
                    colSpan={segCols}
                    style={{
                      textAlign: 'center',
                      padding: '6px 4px',
                      minWidth: hasBoth ? 120 : 80,
                      borderLeft: '1px solid var(--gray-100)',
                      fontWeight: 700,
                    }}
                  >
                    {seg}
                  </th>
                ))}
                {/* Total TIV column header */}
                <th
                  scope="col"
                  colSpan={segCols}
                  style={{
                    textAlign: 'center',
                    padding: '6px 4px',
                    minWidth: hasBoth ? 120 : 80,
                    borderLeft: '2px solid var(--gray-300)',
                    fontWeight: 700,
                  }}
                >
                  Total TIV
                </th>
              </tr>

              {/* Row 2: MDL | JDG sub-headers (only when both sources present) */}
              {hasBoth && (
                <tr style={{ borderBottom: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                  <td  />
                  {SEGMENTS.map(seg => (
                    <Fragment key={seg}>
                      <th
                        scope="col"
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          fontSize: 11,
                          color: 'var(--blue)',
                          padding: '3px 6px',
                          borderLeft: '1px solid var(--gray-100)',
                        }}
                      >
                        MDL
                      </th>
                      <th
                        scope="col"
                        style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          fontSize: 11,
                          color: 'var(--ink)',
                          padding: '3px 6px',
                        }}
                      >
                        JDG
                      </th>
                    </Fragment>
                  ))}
                  {/* Total sub-headers */}
                  <th scope="col" style={{ textAlign: 'center', fontWeight: 700, color: 'var(--blue)', borderLeft: '2px solid var(--gray-300)' }}>MDL</th>
                  <th scope="col" style={{ textAlign: 'center', fontWeight: 700, color: 'var(--ink)' }}>JDG</th>
                </tr>
              )}
            </thead>

            <tbody>
              {months.map(month => (
                <tr key={month}>
                  <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                    {month}
                  </th>
                  {ALL_COLS.map(col => {
                    const isTotal = col === 'Total'
                    const mCell = mdlLookup[month]?.[col]
                    const jCell = jLookup[month]?.[col]
                    const edge  = isTotal
                      ? { borderLeft: '2px solid var(--gray-300)' }
                      : { borderLeft: '1px solid var(--gray-100)' }

                    if (hasBoth) {
                      return (
                        <Fragment key={`${month}-${col}`}>
                          <ErrCell
                            ae={mCell?.ae ?? null}
                            forecast={mCell?.mVal}
                            actual={mCell?.aVal}
                            kind="Model"
                            peerLabel="Judgment"
                            peerForecast={jCell?.jVal}
                            peerAe={jCell?.ae}
                            style={edge}
                          />
                          <ErrCell
                            ae={jCell?.ae ?? null}
                            forecast={jCell?.jVal}
                            actual={jCell?.aVal}
                            kind="Judgment"
                            peerLabel="Model"
                            peerForecast={mCell?.mVal}
                            peerAe={mCell?.ae}
                          />
                        </Fragment>
                      )
                    }
                    const cell = mCell ?? jCell
                    return (
                      <ErrCell
                        key={`${month}-${col}`}
                        ae={cell?.ae ?? null}
                        forecast={mCell ? mCell.mVal : jCell?.jVal}
                        actual={cell?.aVal}
                        kind={mCell ? 'Model' : 'Judgment'}
                        style={edge}
                      />
                    )
                  })}
                </tr>
              ))}

              {/* MAPE summary row */}
              <tr className="tiv-row-mape">
                <th scope="row" >MAPE</th>
                {ALL_COLS.map(col => {
                  const mdlAe = mdlMape[col] !== null ? mdlMape[col] / 100 : null
                  const jdgAe = jMape[col]   !== null ? jMape[col]   / 100 : null
                  const edge  = col === 'Total'
                    ? { borderLeft: '2px solid var(--gray-300)' }
                    : { borderLeft: '1px solid var(--gray-100)' }

                  // Aggregates, not a forecast/actual pair — no hover swap here.
                  if (hasBoth) {
                    return (
                      <Fragment key={`mape-${col}`}>
                        <ErrCell ae={mdlAe} style={edge} />
                        <ErrCell ae={jdgAe} />
                      </Fragment>
                    )
                  }
                  return <ErrCell key={`mape-${col}`} ae={hasMdl ? mdlAe : jdgAe} style={edge} />
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
