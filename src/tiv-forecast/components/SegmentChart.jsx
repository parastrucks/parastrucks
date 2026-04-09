// TIV Forecast — Recharts wrapper component
import {
  ResponsiveContainer, LineChart, BarChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts'

export default function SegmentChart({ type = 'line', data = [], xKey = 'month', series = [], height = 300, referenceLines = [] }) {
  if (!data.length || !series.length) {
    return (
      <div className="empty-state" style={{ height }}>
        <div className="empty-icon">📈</div>
        <div className="empty-title">No data</div>
      </div>
    )
  }

  const commonProps = {
    data,
    margin: { top: 8, right: 16, left: 0, bottom: 4 },
  }

  const axisProps = {
    xAxis: <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval="preserveStartEnd" />,
    yAxis: <YAxis tick={{ fontSize: 11 }} width={48} />,
    grid:  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-100)" />,
    tip:   <Tooltip contentStyle={{ fontSize: 12 }} />,
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
              fill={s.color || '#8884d8'}
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
              stroke={s.color || '#8884d8'}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeWidth={s.bold ? 2.5 : 1.5}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  )
}
