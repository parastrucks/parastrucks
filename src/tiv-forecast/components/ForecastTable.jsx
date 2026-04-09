// TIV Forecast — reusable segment × month forecast table
import { SEGMENTS } from '../constants'

// pct: number → "+12.3%" or "—"
function fmtPct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  const p = (val * 100).toFixed(1)
  return val >= 0 ? `+${p}%` : `${p}%`
}

function fmtSharePct(val) {
  if (val === null || val === undefined || isNaN(val)) return '—'
  return `${(val * 100).toFixed(1)}%`
}

// Color based on error magnitude (for accuracy tracker reuse)
export function errorColor(absErr) {
  if (absErr <= 0.15) return 'var(--green)'
  if (absErr <= 0.25) return 'var(--amber)'
  return 'var(--red)'
}

export default function ForecastTable({ title, subtitle, forecastMonths = [], bySegment = {}, showShare, shareKey, judgmentRows = {} }) {
  if (!forecastMonths.length) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: 'var(--gray-400)', marginBottom: 10 }}>{subtitle}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Segment</th>
              {forecastMonths.map(fm => (
                <th key={fm.month} colSpan={judgmentRows[fm.month] ? 2 : 1} style={{ textAlign: 'center' }}>
                  {fm.month}
                  {showShare && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--gray-400)' }}>Fcst · Share</div>}
                </th>
              ))}
            </tr>
            {forecastMonths.some(fm => judgmentRows[fm.month]) && (
              <tr style={{ background: 'var(--gray-50)', fontSize: 11 }}>
                <th></th>
                {forecastMonths.map(fm => (
                  judgmentRows[fm.month]
                    ? <><th key={`${fm.month}-m`} style={{ textAlign: 'center', fontWeight: 500 }}>Model</th>
                       <th key={`${fm.month}-j`} style={{ textAlign: 'center', fontWeight: 500, color: 'var(--amber)' }}>Judg</th></>
                    : <th key={fm.month}></th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {SEGMENTS.map(seg => (
              <tr key={seg}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{seg}</td>
                {forecastMonths.map(fm => {
                  const row = bySegment[seg]?.find(r => r.month === fm.month)
                  const val = row ? row[Object.keys(row).find(k => k !== 'month' && k !== 'month_num' && k !== 'horizon' && k !== 'alShare' && k !== 'ptbShare' && k !== 'hwForecast' && k !== 'smlyForecast' && !['al','ptb'].includes(k) && (title.includes('TIV') ? k === 'tiv' : title.includes('AL') ? k === 'al' : k === 'ptb'))] : null
                  // Determine the right key based on table type
                  let dispVal = null
                  if (row) {
                    if (title.toLowerCase().includes('tiv') || title.includes('Layer 1')) dispVal = row.tiv
                    else if (title.toLowerCase().includes('al') || title.includes('Layer 2')) dispVal = row.al
                    else dispVal = row.ptb
                  }
                  const share = showShare && row ? row[shareKey] : null
                  const jRow = judgmentRows[fm.month]
                  const jVal = jRow ? jRow[seg] : null
                  if (judgmentRows[fm.month]) {
                    return (
                      <>
                        <td key={`${fm.month}-m`} style={{ textAlign: 'right' }}>{dispVal ?? '—'}</td>
                        <td key={`${fm.month}-j`} style={{ textAlign: 'right', color: 'var(--amber)' }}>{jVal ?? '—'}</td>
                      </>
                    )
                  }
                  return (
                    <td key={fm.month} style={{ textAlign: 'right' }}>
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
              <td>Total</td>
              {forecastMonths.map(fm => {
                let total = 0
                for (const seg of SEGMENTS) {
                  const row = bySegment[seg]?.find(r => r.month === fm.month)
                  if (row) {
                    if (title.toLowerCase().includes('tiv') || title.includes('Layer 1')) total += row.tiv || 0
                    else if (title.toLowerCase().includes('al') || title.includes('Layer 2')) total += row.al || 0
                    else total += row.ptb || 0
                  }
                }
                return <td key={fm.month} style={{ textAlign: 'right' }}>{total || '—'}</td>
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
