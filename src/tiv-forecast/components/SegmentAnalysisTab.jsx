// TIV Forecast — Segment Analysis Tab
import { useState, useMemo } from 'react'
import Icon from '../../components/Icon'
import { SEGMENTS, SEG_COLORS, SEG_COL } from '../constants'
import SegmentChart from './SegmentChart'
import { buildSegmentChartData, buildShareSeries } from '../lib/chartData'

export default function SegmentAnalysisTab({ tivActuals, alActuals, ptbActuals, forecastResult }) {
  const [activeSeg, setActiveSeg] = useState(SEGMENTS[0])

  // Series construction lives in ../lib/chartData so it can be tested against
  // the real data instead of being reimplemented inside a test.
  const chartDataWithForecast = useMemo(
    () => buildSegmentChartData(tivActuals, ptbActuals, activeSeg, forecastResult),
    [tivActuals, ptbActuals, activeSeg, forecastResult],
  )

  // AL market share trend
  const shareChartData = useMemo(
    () => buildShareSeries(tivActuals, alActuals, activeSeg),
    [tivActuals, alActuals, activeSeg],
  )

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
            // PTB is deliberately subordinate to TIV, but muted is not the same
            // as invisible: gray-400 drew at 2.5:1 against white and gray-300 at
            // 1.8:1, both under the 3:1 a graphical object needs to be made out
            // at all. gray-500 clears it at 4.5:1 and still reads as the quieter
            // line. Actual vs forecast is carried by the dash, not by fading the
            // forecast until it disappears.
            { key: 'TIV',      name: 'TIV (actual)',    color: SEG_COLORS[activeSeg], bold: true },
            { key: 'PTB',      name: 'PTB (actual)',    color: 'var(--gray-500)' },
            { key: 'TIV Fcst', name: 'TIV (forecast)', color: SEG_COLORS[activeSeg], dashed: true },
            { key: 'PTB Fcst', name: 'PTB (forecast)', color: 'var(--gray-500)', dashed: true },
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
