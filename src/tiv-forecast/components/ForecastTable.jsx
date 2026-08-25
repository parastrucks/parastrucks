// TIV Forecast — reusable segment × month forecast table
// forecastMonths items have { label, month_num, horizon } — use fm.label, NOT fm.month
import { Fragment } from 'react'
import { SEGMENTS } from '../constants'
import { forecastBand } from '../lib/forecastQuality'

// Which layer's number this table renders. Previously inferred by string-matching
// the `title` prop (`title.includes('Layer 1') || title.toLowerCase().includes('tiv')`),
// which meant renaming a heading silently changed the data shown — and "Layer 2 — AL
// Forecast" only matched via the substring 'al '. Now an explicit contract.
const LAYER_KEY = { tiv: 'tiv', al: 'al', ptb: 'ptb' }

function fmtSharePct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

export default function ForecastTable({
  layer = 'tiv',
  title,
  subtitle,
  showTitle = true,
  forecastMonths = [],
  bySegment = {},
  showShare,
  shareKey,
  judgmentRows = {},
  // Uncertainty + explainability. Optional — a table given none of these
  // renders exactly as it did before.
  showBands = false,
  backtest = [],
  actuals = [],
  onExplain = null,
}) {
  if (!forecastMonths.length) return null

  const valueKey = LAYER_KEY[layer] || 'tiv'
  const anyJudgment = forecastMonths.some(fm => judgmentRows[fm.label])

  const readCell = (seg, label) => {
    const row = bySegment[seg]?.find(r => r.month === label)
    return row ? row[valueKey] : null
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {showTitle && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>}
      <div className="tiv-scroll">
        <table className="tiv-table">
          {/* The caption carries the layer's meaning. It used to live in a
              `subtitle` prop that every caller passed but no caller rendered
              (showTitle={false} everywhere), so the share basis and the 75% cap
              were written down and then never shown. */}
          {subtitle && <caption>{subtitle}</caption>}
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left' }}>
                Segment
              </th>
              {forecastMonths.map(fm => (
                <th
                  key={fm.label}
                  scope="col"
                  colSpan={judgmentRows[fm.label] ? 2 : 1}
                >
                  {fm.label}
                  {showShare && <div className="tiv-sub">Fcst · Share</div>}
                </th>
              ))}
            </tr>
            {anyJudgment && (
              <tr style={{ background: 'var(--gray-50)' }}>
                <td />
                {forecastMonths.map(fm =>
                  judgmentRows[fm.label]
                    ? (
                      <Fragment key={fm.label}>
                        <th scope="col" className="tiv-sub">Model</th>
                        <th scope="col" className="tiv-sub tiv-judg">Judg</th>
                      </Fragment>
                    )
                    : <td key={fm.label} />
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {SEGMENTS.map(seg => (
              <tr key={seg}>
                <th scope="row">{seg}</th>
                {forecastMonths.map(fm => {
                  const dispVal = readCell(seg, fm.label)
                  const row     = bySegment[seg]?.find(r => r.month === fm.label)
                  const share   = showShare && row ? row[shareKey] : null
                  const jRow    = judgmentRows[fm.label]

                  const hasVal = dispVal !== null && dispVal !== undefined
                  // A point estimate carrying 13.8–33.5% historic error was
                  // shown bare, while the data to qualify it sat two tabs away
                  // in model_backtest.
                  const band = showBands && hasVal
                    ? forecastBand(seg, dispVal, backtest, actuals)
                    : null
                  const clickable = !!onExplain && hasVal
                  const cellProps = {
                    className: ['tiv-num', clickable ? 'tiv-explainable' : ''].filter(Boolean).join(' '),
                    onClick: clickable
                      ? () => onExplain({ segment: seg, label: fm.label, value: dispVal, band })
                      : undefined,
                    title: clickable ? 'Show how this number was worked out' : undefined,
                  }
                  const body = (
                    <>
                      <span style={{ fontWeight: 700 }}>{dispVal ?? '—'}</span>
                      {showShare && share !== null && (
                        <span className="tiv-sub" style={{ marginLeft: 4 }}>
                          {fmtSharePct(share)}
                        </span>
                      )}
                      {band && <div className="tiv-sub">{band.low}–{band.high}</div>}
                    </>
                  )

                  if (jRow) {
                    return (
                      <Fragment key={fm.label}>
                        <td {...cellProps}>{body}</td>
                        <td className="tiv-num tiv-judg">{jRow[seg] ?? '—'}</td>
                      </Fragment>
                    )
                  }
                  return <td key={fm.label} {...cellProps}>{body}</td>
                })}
              </tr>
            ))}
            {/* Total row.
                A total assembled from only some of its segments is worse than
                no total, so a single missing segment makes the whole cell '—'.
                And `||` was conflating a legitimate zero with missing data —
                a real 0 must read as 0, not as a dash. */}
            <tr className="tiv-row-total">
              <th scope="row">Total</th>
              {forecastMonths.map(fm => {
                const cells  = SEGMENTS.map(seg => readCell(seg, fm.label))
                const total  = cells.some(v => v === null || v === undefined)
                  ? null
                  : cells.reduce((s, v) => s + v, 0)
                const jRow   = judgmentRows[fm.label]
                if (jRow) {
                  // Judgment rows are legitimately partial. Summing the present
                  // segments and showing it beside a complete model total
                  // invited a comparison between different things.
                  const jCells = SEGMENTS.map(seg => jRow[seg])
                  const jTotal = jCells.some(v => v === null || v === undefined)
                    ? null
                    : jCells.reduce((s, v) => s + v, 0)
                  return (
                    <Fragment key={fm.label}>
                      <td className="tiv-num">{total ?? '—'}</td>
                      <td className="tiv-num tiv-judg">{jTotal ?? '—'}</td>
                    </Fragment>
                  )
                }
                return <td key={fm.label} className="tiv-num">{total ?? '—'}</td>
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
