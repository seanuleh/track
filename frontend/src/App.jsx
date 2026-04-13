import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getEntries, deleteEntry } from './api.js'
import WeightChart, { getLegendKeys } from './components/WeightChart.jsx'
import EntryList from './components/EntryList.jsx'
import AddEditModal from './components/AddEditModal.jsx'
import FAB from './components/FAB.jsx'
import { buildColorMap, formatMedLabel, NO_MED_COLOR } from './medColors.js'

const WINDOWS = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: '2Y', days: 730 },
  { label: '3Y', days: 1095 },
  { label: 'All', days: null },
]

function filterByWindow(entries, days) {
  if (!days) return entries
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const inRange = entries.filter(e => e.date >= cutoffStr)
  const before = entries.filter(e => e.date < cutoffStr)
  // Pin the anchor point to the cutoff date so the line starts exactly at the left edge
  if (before.length > 0 && inRange.length > 0 && inRange[inRange.length - 1].date > cutoffStr) {
    return [{ ...before[0], date: cutoffStr, _anchor: true }, ...inRange]
  }
  return inRange
}


function chartHeightForData(data) {
  if (data.length < 2) return 180
  const minTs = new Date(data[0].date).getTime()
  const maxTs = new Date(data[data.length - 1].date).getTime()
  const spanDays = (maxTs - minTs) / 86400000
  if (spanDays <= 14) return 180
  if (spanDays <= 90) return 220
  if (spanDays <= 365) return 260
  return 300
}

function ChartCrossfade({ chartData, entries }) {
  const [current, setCurrent] = useState({ key: 0, data: chartData, allEntries: entries })
  const [prev, setPrev] = useState(null)
  const timerRef = useRef(null)
  const initRef = useRef(true)

  useEffect(() => {
    if (initRef.current) { initRef.current = false; return }
    clearTimeout(timerRef.current)
    setPrev({ ...current, fading: true })
    const nextKey = current.key + 1
    setCurrent({ key: nextKey, data: chartData, allEntries: entries })
    timerRef.current = setTimeout(() => setPrev(null), 450)
    return () => clearTimeout(timerRef.current)
  }, [chartData]) // eslint-disable-line react-hooks/exhaustive-deps

  const targetHeight = chartHeightForData(chartData)
  const prevHeight = prev ? chartHeightForData(prev.data) : targetHeight
  const containerHeight = Math.max(targetHeight, prevHeight)

  const { keys: legendKeys, colorMap: legendColorMap } = getLegendKeys(current.data, current.allEntries)

  return (
    <div>
      <div style={{ position: 'relative', height: containerHeight, transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden' }}>
        {prev && (
          <div style={{ position: 'absolute', inset: 0, opacity: 0, transition: 'opacity 0.25s ease', pointerEvents: 'none' }}>
            <WeightChart key={prev.key} data={prev.data} allEntries={prev.allEntries} />
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, opacity: 1, transition: 'opacity 0.25s ease 0.1s' }}>
          <WeightChart key={current.key} data={current.data} allEntries={current.allEntries} />
        </div>
      </div>
      {legendKeys.length > 0 && (
        <div className="chart-legend">
          {legendKeys.map(key => (
            <span key={key} className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: legendColorMap[key] ?? NO_MED_COLOR }} />
              {formatMedLabel(key)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [window_, setWindow_] = useState(() => localStorage.getItem('weightWindow') || '3M')
  const [modalOpen, setModalOpen] = useState(false)
  const [editEntry, setEditEntry] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await getEntries()
      setEntries(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    async function init() {
      try {
        await load()
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [load])

  const colorMap = useMemo(() => buildColorMap(entries), [entries])

  const pillsRef = useRef(null)
  const pillRefs = useRef({})
  const [indicator, setIndicator] = useState(null)

  useEffect(() => {
    const container = pillsRef.current
    const activeEl = pillRefs.current[window_]
    if (!container || !activeEl) return
    const cRect = container.getBoundingClientRect()
    const aRect = activeEl.getBoundingClientRect()
    setIndicator({ left: aRect.left - cRect.left, width: aRect.width })
  }, [window_, loading])

  const selectedWindow = WINDOWS.find(w => w.label === window_)
  const filtered = filterByWindow(entries, selectedWindow?.days)

  const chartData = [...filtered].sort((a, b) => a.date.localeCompare(b.date))

  const currentWeight = entries.length > 0 ? parseFloat(entries[0].weight) : null
  const windowStart = filtered.length > 0 ? parseFloat(filtered[filtered.length - 1].weight) : null

  let delta = null
  let deltaLabel = null
  if (currentWeight !== null && windowStart !== null && filtered.length > 1) {
    delta = currentWeight - windowStart
    const sign = delta > 0 ? '+' : ''
    deltaLabel = `${sign}${delta.toFixed(1)} kg`
  }

  function handleEdit(entry) {
    setEditEntry(entry)
    setModalOpen(true)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return
    try {
      await deleteEntry(id)
      await load()
    } catch (err) {
      alert('Failed to delete: ' + err.message)
    }
  }

  async function handleSave() {
    setModalOpen(false)
    setEditEntry(null)
    await load()
  }

  if (loading) return <div className="loading">Loading…</div>
  if (error) return <div className="error">Error: {error}</div>

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div className="header-title">Current Weight</div>
          {currentWeight !== null ? (
            <div className="header-weight">
              {currentWeight.toFixed(1)}<span>kg</span>
            </div>
          ) : (
            <div className="header-weight" style={{ fontStyle: 'italic', color: 'var(--text-faint)', fontSize: 48, letterSpacing: 0 }}>
              No entries yet
            </div>
          )}
          {deltaLabel && (
            <div className="header-bottom">
              <span className={`header-delta ${delta > 0 ? 'delta-positive' : delta < 0 ? 'delta-negative' : 'delta-neutral'}`}>
                {delta > 0 ? '↑' : '↓'} {deltaLabel}
              </span>
              <span className="header-delta-window">vs {window_}</span>
            </div>
          )}
        </div>
      </div>

      <div className="window-pills" ref={pillsRef}>
        <div className="pill-indicator" style={indicator ? { left: indicator.left, width: indicator.width } : { transition: 'none', left: 0, width: 0 }} />
        {WINDOWS.map(w => (
          <button
            key={w.label}
            ref={el => { pillRefs.current[w.label] = el }}
            className={`pill${window_ === w.label ? ' active' : ''}`}
            onClick={() => { setWindow_(w.label); localStorage.setItem('weightWindow', w.label) }}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="chart-card">
        <ChartCrossfade chartData={chartData} entries={entries} />
      </div>

      <div>
        <div className="section-title">History</div>
        <EntryList
          entries={filtered.filter(e => !e._anchor)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          colorMap={colorMap}
        />
        {filtered.length === 0 && (
          <div className="empty">No entries in this period.</div>
        )}
      </div>

      <FAB onClick={() => { setEditEntry(null); setModalOpen(true) }} />

      {modalOpen && (
        <AddEditModal
          entry={editEntry}
          lastWeight={entries.length > 0 ? String(entries[0].weight) : ''}
          lastMedication={entries.length > 0 ? (entries[0].medication || '') : ''}
          lastDose={entries.length > 0 ? entries[0].dose_mg : null}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditEntry(null) }}
        />
      )}
    </>
  )
}
