// TIV Forecast — Segment Analysis Tab
import { useState, useMemo } from 'react'
import Icon from '../../components/Icon'
import { SEGMENTS, SEG_COLORS, SEG_COL } from '../constants'
import SegmentChart from './SegmentChart'

export default function SegmentAnalysisTab({ tivActuals, alActuals, ptbActuals, forecastResult }) {
  const [activeSeg, setActiveSeg] = useState(SEGMENTS[0])

  // A real zero and a missing month are different facts and must plot
  // differently. `|| 0` fabricated a zero for a missing TIV month; `|| null`
  // erased genuine zeros from PTB — and the dealership really did sell nothing
  // in six of the 2022 ramp-up months, so the chart drew a straight
  // interpolated line over the truth.
  const num = v => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // Build historical + forecast line chart data for the selected segment
  const historicalChartData = useMemo(() => {
    if (!tivActuals?.length) return []
    return tivActuals.map(row => ({
      month: row.month_label,
      TIV:   num(row[SEG_COL[activeSeg]]),
      PTB:   num(ptbActuals?.find(p => p.month_label === row.month_label)?.[SEG_COL[activeSeg]]),
    }))
  }, [tivActuals, ptbActuals, activeSeg])

  // Append forecast extension as dashed (null actual values)
  const chartDataWithForecast = useMemo(() => {
    if (!forecastResult) return historicalChartData
    const base = [...historicalChartData]
    for (const fm of forecastResult.forecastMonths) {
      const segRow = forecastResult.bySegment[activeSeg]?.find(r => r.month === fm.label)
      if (segRow) {
        base.push({
          month:    fm.label,
          TIV:      null,
          PTB:      null,
          'TIV Fcst': segRow.tiv,
          'PTB Fcst': segRow.ptb,
        })
      }
    }
    return base
  }, [historicalChartData, forecastResult, activeSeg])

  // AL market share trend
  const shareChartData = useMemo(() => {
    if (!tivActuals?.length || !alActuals?.length) return []
    return tivActuals.map(tRow => {
      const aRow = alActuals.find(a => a.month_label === tRow.month_label)
      const tiv = num(tRow[SEG_COL[activeSeg]])
      // A month with no AL row has no known share. Reading it as 0 plotted a
      // 0% point that looked like "AL sold nothing" rather than "not reported".
      const al  = aRow ? num(aRow[SEG_COL[activeSeg]]) : null
      return {
        month:    tRow.month_label,
        'AL Share': tiv > 0 && al !== null ? parseFloat((al / tiv * 100).toFixed(1)) : null,
      }
    }).filter(r => r['AL Share'] !== null)
  }, [tivActuals, alActuals, activeSeg])

  // Stacked bar for all segments — forecast months only
  const stackedData = useMemo(() => {
    if (!forecastResult) return []
    return forecastResult.forecastMonths.map(fm => {
      const row = { month: fm.label }
      for (const seg of SEGMENTS) {
        const r = forecastResult.bySegment[seg]?.find(s => s.month === fm.label)
        // A stale month has no forecast; `|| 0` drew it as a zero-height slice
        // of a real-looking bar. null makes recharts leave it out.
        row[seg] = r?.tiv ?? null
      }
      return row
    })
  }, [forecastResult])

  const segSeries = SEGMENTS.map(seg => ({
    key: seg, name: seg, color: SEG_COLORS[seg],
  }))

  return (
    <div>
      {/* Segment selector pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {SEGMENTS.map(seg => (
          <button
            key={seg}
            className={`btn btn-sm ${activeSeg === seg ? 'btn-primary' : 'btn-secondary'}`}
            style={{ borderColor: SEG_COLORS[seg] }}
            onClick={() => setActiveSeg(seg)}
          >
            {seg}
          </button>
        ))}
      </div>

      {/* Historical + forecast line chart */}
      <div className="card mb-24">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
          {activeSeg} — Historical TIV + PTB + Forecast
        </div>
        <SegmentChart
          label={`${activeSeg}: monthly industry volume and PTB sales, with the three-month forecast`}
          type="line"
          data={chartDataWithForecast}
          xKey="month"
          series={[
            { key: 'TIV',      name: 'TIV (actual)',    color: SEG_COLORS[activeSeg], bold: true },
            { key: 'PTB',      name: 'PTB (actual)',    color: 'var(--gray-400)' },
            { key: 'TIV Fcst', name: 'TIV (forecast)', color: SEG_COLORS[activeSeg], dashed: true },
            { key: 'PTB Fcst', name: 'PTB (forecast)', color: 'var(--gray-300)', dashed: true },
          ]}
          height={260}
        />
      </div>

      {/* AL market share trend */}
      <div className="card mb-24">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
          {activeSeg} — AL Market Share %
        </div>
        <SegmentChart
          label={`${activeSeg}: Ashok Leyland share of industry volume, month by month`}
          type="line"
          data={shareChartData}
          xKey="month"
          series={[{ key: 'AL Share', name: 'AL Share %', color: 'var(--blue)', bold: true }]}
          height={200}
        />
      </div>

      {/* Stacked TIV by segment — forecast months */}
      {stackedData.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            TIV Forecast by Segment (all segments)
          </div>
          <SegmentChart
            label="Forecast industry volume by segment for the next three months"
            type="stackedBar"
            data={stackedData}
            xKey="month"
            series={segSeries}
            height={240}
          />
        </div>
      )}

      {(!tivActuals?.length) && (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="trending" size={34} color="var(--text-muted)" /></div>
          <div className="empty-title">No historical data</div>
          <div className="empty-desc">Upload a Market Data file to see segment analysis.</div>
        </div>
      )}
    </div>
  )
}
