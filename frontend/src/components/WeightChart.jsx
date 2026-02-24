import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-value">{parseFloat(payload[0].value).toFixed(1)} kg</div>
    </div>
  )
}

export default function WeightChart({ data }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        No data to display
      </div>
    )
  }

  const weights = data.map(d => parseFloat(d.weight))
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const pad = Math.max((maxW - minW) * 0.15, 0.5)

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => {
            const [, m, d] = v.split('-')
            return `${m}/${d}`
          }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minW - pad, maxW + pad]}
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toFixed(1)}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="weight"
          stroke="#38bdf8"
          strokeWidth={2}
          dot={data.length <= 30 ? { fill: '#38bdf8', r: 3, strokeWidth: 0 } : false}
          activeDot={{ r: 5, fill: '#38bdf8', strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
