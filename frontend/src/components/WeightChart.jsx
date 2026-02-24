import {
  ResponsiveContainer,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

const TICK_STYLE = { fill: '#6b7897', fontSize: 11, fontFamily: 'Jost, sans-serif' }

function toTs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const ts = payload[0]?.payload?.ts
  const date = ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{date}</div>
      <div className="chart-tooltip-value">{parseFloat(payload[0].value).toFixed(1)} kg</div>
    </div>
  )
}

// Generate evenly-spaced tick timestamps across the data range
function generateTicks(minTs, maxTs, spanDays) {
  let ticks = []

  if (spanDays <= 60) {
    // Daily ticks for 1W, weekly for up to 2M
    const stepDays = spanDays <= 10 ? 1 : 7
    ticks.push(minTs) // always anchor the start
    const d = new Date(minTs)
    if (stepDays === 7) d.setDate(d.getDate() - d.getDay()) // snap to Sunday
    d.setDate(d.getDate() + stepDays) // start from next interval
    while (d.getTime() <= maxTs) {
      ticks.push(d.getTime())
      d.setDate(d.getDate() + stepDays)
    }
  } else if (spanDays <= 400) {
    // Monthly ticks, thinned to max 6
    const start = new Date(minTs)
    const d = new Date(start.getFullYear(), start.getMonth(), 1)
    while (d.getTime() <= maxTs) {
      ticks.push(d.getTime())
      d.setMonth(d.getMonth() + 1)
    }
    if (ticks.length > 6) {
      const step = Math.ceil(ticks.length / 6)
      ticks = ticks.filter((_, i) => i % step === 0)
    }
  } else {
    // Yearly ticks
    const start = new Date(minTs)
    const d = new Date(start.getFullYear(), 0, 1)
    while (d.getTime() <= maxTs) {
      ticks.push(d.getTime())
      d.setFullYear(d.getFullYear() + 1)
    }
  }

  return ticks
}

function formatTick(ts, spanDays) {
  const d = new Date(ts)
  if (spanDays <= 60) {
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  } else if (spanDays <= 400) {
    return d.toLocaleDateString('en-US', { month: 'short' })
  } else {
    return String(d.getFullYear())
  }
}

function yAxisWidth(maxW) {
  return 12 + String(maxW.toFixed(1)).length * 7
}

export default function WeightChart({ data }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 15, fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
        No data to display
      </div>
    )
  }

  // Convert to timestamp-based data
  const tsData = data.map(d => ({ ...d, ts: toTs(d.date) }))

  const weights = tsData.map(d => parseFloat(d.weight))
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const pad = Math.max((maxW - minW) * 0.2, 0.5)

  const minTs = tsData[0].ts
  const maxTs = tsData[tsData.length - 1].ts
  const spanDays = (maxTs - minTs) / 86400000

  // Filter ticks to domain — ticks outside [minTs, maxTs] cause Recharts to extend the domain leftward
  const ticks = generateTicks(minTs, maxTs, spanDays).filter(t => t >= minTs && t <= maxTs)
  const leftWidth = yAxisWidth(maxW + pad)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={tsData} margin={{ top: 8, right: 4, left: -(40 - leftWidth), bottom: 0 }}>
        <defs>
          <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b5bdb" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#3b5bdb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#dde1e9" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          scale="time"
          domain={[minTs, maxTs]}
          ticks={ticks}
          tickFormatter={(ts) => formatTick(ts, spanDays)}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          padding={{ left: 0, right: 0 }}
        />
        <YAxis
          domain={[minW - pad, maxW + pad]}
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toFixed(1)}
          width={leftWidth}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#dde1e9', strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="weight"
          stroke="#3b5bdb"
          strokeWidth={2}
          fill="url(#weightGrad)"
          dot={data.length <= 30 ? { fill: '#3b5bdb', r: 3, strokeWidth: 0 } : false}
          activeDot={{ r: 5, fill: '#3b5bdb', strokeWidth: 2, stroke: '#f2f4f7' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
