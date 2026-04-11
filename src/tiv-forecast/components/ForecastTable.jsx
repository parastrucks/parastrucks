// TIV Forecast — reusable segment × month forecast table
// forecastMonths items have { label, month_num, horizon } — use fm.label, NOT fm.month
import { SEGMENTS } from '../constants'

function fmtSharePct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

export function errorColor(absErr) {
  if (absErr <= 0.15) return 'var(--green)'
  if (absErr <= 0.25) return 'var(--amber)'
  return 'var(--red)'
}

export default function ForecastTable({ title, subtitle, showTitle = true, forecastMonths = [], bySegment = {}, showShare, shareKey, judgmentRows = {} }) {
  if (!forecastMonths.length) return null

  return (
    <div style={{ marginBottom: 16 }}>
      {showTitle && <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>}
      {showTitle && subtitle && <div style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ width: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--gray-200)', fontSize: 13 }}>Segment</th>
              {forecastMonths.map(fm => (
                <th key={fm.label} colSpan={judgmentRows[fm.label] ? 2 : 1}
                  style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid var(--gray-200)', fontSize: 13 }}>
                  {fm.label}
                  {showShare && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)' }}>Fcst · Share</div>}
                </th>
              ))}
            </tr>
            {forecastMonths.some(fm => judgmentRows[fm.label]) && (
              <tr style={{ background: 'var(--gray-50)', fontSize: 11 }}>
                <th></th>
                {forecastMonths.map(fm =>
                  judgmentRows[fm.label]
                    ? (
                      <>
                        <th key={`${fm.label}-m`} style={{ textAlign: 'center', fontWeight: 500, padding: '4px 8px' }}>Model</th>
                        <th key={`${fm.label}-j`} style={{ textAlign: 'center', fontWeight: 500, color: 'var(--amber)', padding: '4px 8px' }}>Judg</th>
                      </>
                    )
                    : <th key={fm.label}></th>
                )}
              </tr>
            )}
          </thead>
          <tbody>
            {SEGMENTS.map(seg => (
              <tr key={seg} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap', padding: '7px 10px', fontSize: 13 }}>{seg}</td>
                {forecastMonths.map(fm => {
                  const row = bySegment[seg]?.find(r => r.month === fm.label)
                  let dispVal = null
                  if (row) {
                    if (title.includes('Layer 1') || title.toLowerCase().includes('tiv')) dispVal = row.tiv
                    else if (title.includes('Layer 2') || title.toLowerCase().includes('al ')) dispVal = row.al
                    else dispVal = row.ptb
                  }
                  const share = showShare && row ? row[shareKey] : null
                  const jRow  = judgmentRows[fm.label]
                  const jVal  = jRow ? jRow[seg] : null

                  if (jRow) {
                    return (
                      <>
                        <td key={`${fm.label}-m`} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 13 }}>{dispVal ?? '—'}</td>
                        <td key={`${fm.label}-j`} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 13, color: 'var(--amber)' }}>{jVal ?? '—'}</td>
                      </>
                    )
                  }
                  return (
                    <td key={fm.label} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{dispVal ?? '—'}</span>
                      {showShare && share !== null && (
                        <span style={{ fontSize: 11, color: 'var(--gray-400)', marginLeft: 4 }}>
                          {fmtSharePct(share)}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* Total row */}
            <tr style={{ borderTop: '2px solid var(--gray-200)', fontWeight: 700 }}>
              <td style={{ padding: '7px 10px', fontSize: 13 }}>Total</td>
              {forecastMonths.map(fm => {
                let total = 0
                for (const seg of SEGMENTS) {
                  const row = bySegment[seg]?.find(r => r.month === fm.label)
                  if (row) {
                    if (title.includes('Layer 1') || title.toLowerCase().includes('tiv')) total += row.tiv || 0
                    else if (title.includes('Layer 2') || title.toLowerCase().includes('al ')) total += row.al || 0
                    else total += row.ptb || 0
                  }
                }
                return <td key={fm.label} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 13 }}>{total || '—'}</td>
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
