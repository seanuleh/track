import {
  ResponsiveContainer,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { buildColorMap, getMedKey, formatMedLabel, NO_MED_COLOR } from '../medColors.js'

const TICK_STYLE = { fill: '#6b7897', fontSize: 11, fontFamily: 'Jost, sans-serif' }
const LINE_COLOR = '#3b5bdb'

function toTs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function CustomTooltip({ active, payload, colorMap }) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  const ts = point.ts
  const date = ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  const medKey = point._medKey
  const color = (colorMap && colorMap[medKey]) ?? LINE_COLOR
  const medLabel = medKey ? formatMedLabel(medKey) : null
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{date}</div>
      <div className="chart-tooltip-value">{parseFloat(payload[0].value).toFixed(1)} kg</div>
      {medLabel && <div className="chart-tooltip-med" style={{ color }}>{medLabel}</div>}
    </div>
  )
}

// Build horizontal gradient stops so line colour changes at medication boundaries.
// Uses midpoint between consecutive entries with different meds for a clean hard cut.
function buildLineGradientStops(tsData, colorMap, minTs, maxTs) {
  if (tsData.length < 2 || minTs === maxTs) return null
  const range = maxTs - minTs
  const stops = []

  for (let i = 0; i < tsData.length; i++) {
    const color = colorMap[tsData[i]._medKey] ?? LINE_COLOR
    const prevColor = i > 0 ? (colorMap[tsData[i - 1]._medKey] ?? LINE_COLOR) : null

    if (i === 0) {
      stops.push({ offset: '0%', color })
    } else if (color !== prevColor) {
      // Hard transition at midpoint between last and current entry
      const midTs = (tsData[i - 1].ts + tsData[i].ts) / 2
      const midPct = ((midTs - minTs) / range * 100).toFixed(3) + '%'
      stops.push({ offset: midPct, color: prevColor })
      stops.push({ offset: midPct, color })
    }
  }

  // Ensure we always close at 100%
  const lastColor = colorMap[tsData[tsData.length - 1]._medKey] ?? LINE_COLOR
  stops.push({ offset: '100%', color: lastColor })

  return stops
}

function generateTicks(minTs, maxTs, spanDays) {
  let ticks = []
  if (spanDays <= 60) {
    const stepDays = spanDays <= 10 ? 1 : 7
    ticks.push(minTs)
    const d = new Date(minTs)
    if (stepDays === 7) d.setDate(d.getDate() - d.getDay())
    d.setDate(d.getDate() + stepDays)
    while (d.getTime() <= maxTs) {
      ticks.push(d.getTime())
      d.setDate(d.getDate() + stepDays)
    }
  } else if (spanDays <= 400) {
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
  if (spanDays <= 60) return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  if (spanDays <= 400) return d.toLocaleDateString('en-US', { month: 'short' })
  return String(d.getFullYear())
}

function yAxisWidth(maxW) {
  return 12 + String(maxW.toFixed(1)).length * 7
}

export default function WeightChart({ data, allEntries = [] }) {
  if (data.length === 0) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 15, fontStyle: 'italic', fontFamily: 'var(--font-display)' }}>
        No data to display
      </div>
    )
  }

  const colorMap = buildColorMap(allEntries.length > 0 ? allEntries : data)

  const tsData = data.map(d => ({
    ...d,
    ts: toTs(d.date),
    _medKey: getMedKey(d),
  }))

  const weights = tsData.map(d => parseFloat(d.weight))
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const pad = Math.max((maxW - minW) * 0.2, 0.5)

  const minTs = tsData[0].ts
  const maxTs = tsData[tsData.length - 1].ts
  const spanDays = (maxTs - minTs) / 86400000

  const ticks = generateTicks(minTs, maxTs, spanDays).filter(t => t >= minTs && t <= maxTs)
  const leftWidth = yAxisWidth(maxW + pad)

  const gradientStops = buildLineGradientStops(tsData, colorMap, minTs, maxTs)
  const hasMedData = tsData.some(d => !!d._medKey)
  const strokeColor = gradientStops && hasMedData ? 'url(#lineColorGrad)' : LINE_COLOR

  // Legend: unique medication keys present in this window
  const legendKeys = [...new Set(tsData.map(d => d._medKey))].filter(k => !!k)

  const showDots = data.length <= 30

  function MedDot({ cx, cy, payload }) {
    if (cx == null || cy == null) return null
    const color = colorMap[payload._medKey] ?? LINE_COLOR
    return <circle cx={cx} cy={cy} r={3} fill={color} strokeWidth={0} />
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={tsData} margin={{ top: 8, right: 4, left: -(40 - leftWidth), bottom: 0 }}>
          <defs>
            <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.12} />
              <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
            </linearGradient>
            {gradientStops && hasMedData && (
              <linearGradient id="lineColorGrad" x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map((stop, i) => (
                  <stop key={i} offset={stop.offset} stopColor={stop.color} />
                ))}
              </linearGradient>
            )}
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
          <Tooltip content={<CustomTooltip colorMap={colorMap} />} cursor={{ stroke: '#dde1e9', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="weight"
            stroke={strokeColor}
            strokeWidth={2}
            fill="url(#weightGrad)"
            dot={showDots ? <MedDot /> : false}
            activeDot={(props) => {
              const color = colorMap[props.payload?._medKey] ?? LINE_COLOR
              return <circle cx={props.cx} cy={props.cy} r={5} fill={color} stroke="#f2f4f7" strokeWidth={2} />
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {legendKeys.length > 0 && (
        <div className="chart-legend">
          {legendKeys.map(key => (
            <span key={key} className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: colorMap[key] ?? NO_MED_COLOR }} />
              {formatMedLabel(key)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
