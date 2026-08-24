// TIV Forecast — Recharts wrapper component
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'
import Icon from '../../components/Icon'

export default function SegmentChart({ type = 'line', data = [], xKey = 'month', series = [], height = 300, referenceLines = [] }) {
  if (!data.length || !series.length) {
    return (
      <div className="empty-state" style={{ height }}>
        <div className="empty-icon"><Icon name="trending" size={34} color="var(--text-muted)" /></div>
        <div className="empty-title">No data</div>
      </div>
    )
  }

  const commonProps = {
    data,
    margin: { top: 8, right: 16, left: 0, bottom: 4 },
  }

  const axisProps = {
    xAxis: <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} stroke="var(--border-default)" interval="preserveStartEnd" />,
    yAxis: <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} stroke="var(--border-default)" width={48} />,
    grid:  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />,
    // Tooltip as a print-report card (hairline, square-ish, subtle lift) instead
    // of the default recharts white box with a heavy border.
    tip:   <Tooltip
      contentStyle={{ fontSize: 12, background: 'var(--white)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 14px rgba(0,0,0,.10)', color: 'var(--ink)' }}
      labelStyle={{ color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 2 }}
      cursor={{ fill: 'var(--accent-wash)', stroke: 'var(--border-default)' }}
    />,
    legend: <Legend wrapperStyle={{ fontSize: 12 }} />,
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === 'bar' || type === 'stackedBar' ? (
        <BarChart {...commonProps}>
          {axisProps.grid}
          {axisProps.xAxis}
          {axisProps.yAxis}
          {axisProps.tip}
          {axisProps.legend}
          {referenceLines.map((rl, i) => (
            <ReferenceLine key={i} y={rl.value} stroke={rl.color || 'var(--red)'} strokeDasharray="4 4" label={{ value: rl.label, fontSize: 11 }} />
          ))}
          {series.map(s => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name || s.key}
              fill={s.color || 'var(--blue)'}
              stackId={type === 'stackedBar' ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      ) : (
        <LineChart {...commonProps}>
          {axisProps.grid}
          {axisProps.xAxis}
          {axisProps.yAxis}
          {axisProps.tip}
          {axisProps.legend}
          {referenceLines.map((rl, i) => (
            <ReferenceLine key={i} y={rl.value} stroke={rl.color || 'var(--red)'} strokeDasharray="4 4" label={{ value: rl.label, fontSize: 11 }} />
          ))}
          {series.map(s => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name || s.key}
              stroke={s.color || 'var(--blue)'}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeWidth={s.bold ? 2.5 : 1.5}
              dot={false}
              /* connectNulls was unconditional, so a month with no data was
                 bridged with a straight line that looked like measurement.
                 Opt in per series; a gap in actuals should read as a gap. */
              connectNulls={s.connectNulls === true}
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
