import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getEntries, deleteEntry } from './api.js'
import WeightChart, { getLegendKeys } from './components/WeightChart.jsx'
import EntryList from './components/EntryList.jsx'
import AddEditModal from './components/AddEditModal.jsx'
import FAB from './components/FAB.jsx'
import FoodView from './components/FoodView.jsx'
import FoodsView from './components/FoodsView.jsx'
import { toLocalISO } from './dates.js'
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
  const cutoffStr = toLocalISO(cutoff)
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

function WeightView() {
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

// Diary and Foods are separate surfaces on purpose: the diary is date-scoped
// and disposable, the library is date-less and curated. The 'food' key is kept
// for the diary so the stored tab preference survives the rename.
const TABS = [
  { key: 'foods', label: 'Foods' },
  { key: 'food', label: 'Diary' },
  { key: 'weight', label: 'Weight' },
]

// Horizontal travel (px) before a gesture counts as a tab swipe, and how much
// more horizontal than vertical it must be. The ratio is what stops an ordinary
// diagonal scroll down the history list from flipping tabs.
const SWIPE_MIN_X = 60
const SWIPE_RATIO = 1.5

// A swipe that starts inside one of these is meant for that element, not the
// tab strip: the scanner and modals sit above the page, and the search results
// are their own scrollable list.
const SWIPE_EXEMPT = '.scanner-overlay, .modal-overlay, .search-results'

// How far past SWIPE_MIN_X a gesture must get before the pill bar is revealed.
// Lower than the commit threshold so the bar shows up as confirmation while the
// finger is still moving, rather than only after the tab has already changed.
const SWIPE_HINT_X = 24

// How long the pill bar lingers after a swipe settles.
const BAR_LINGER_MS = 1600

export default function App() {
  // Storage key is versioned: v1 predates Food existing, so honouring a stale
  // 'weight' from it would hide the new default from anyone who'd used the app.
  const [tab, setTab] = useState(() => localStorage.getItem('trackTab.v2') || 'food')
  const [slide, setSlide] = useState(null)
  const [barVisible, setBarVisible] = useState(false)

  const touchRef = useRef(null)
  const barTimerRef = useRef(null)

  const index = TABS.findIndex(t => t.key === tab)

  // Show the pill bar, then fade it out again once the gesture has settled.
  const flashBar = useCallback((linger = BAR_LINGER_MS) => {
    setBarVisible(true)
    clearTimeout(barTimerRef.current)
    barTimerRef.current = setTimeout(() => setBarVisible(false), linger)
  }, [])

  const selectTab = useCallback((key, direction = null) => {
    setTab(key)
    setSlide(direction)
    localStorage.setItem('trackTab.v2', key)
    flashBar()
  }, [flashBar])

  useEffect(() => () => clearTimeout(barTimerRef.current), [])

  // Listeners live on the document, not the tab panel. The panel is only as
  // tall as its content, so anything attached there silently stops working
  // below the last card — which is most of the screen on a short day's log.
  useEffect(() => {
    function onTouchStart(e) {
      if (e.target.closest(SWIPE_EXEMPT)) { touchRef.current = null; return }
      const t = e.changedTouches[0]
      touchRef.current = { x: t.clientX, y: t.clientY, hinted: false }
    }

    function onTouchMove(e) {
      const start = touchRef.current
      if (!start || start.hinted) return

      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y

      // Only reveal the bar once the gesture actually looks horizontal,
      // otherwise it would flash on every vertical scroll.
      if (Math.abs(dx) > SWIPE_HINT_X && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
        start.hinted = true
        flashBar()
      }
    }

    function onTouchEnd(e) {
      const start = touchRef.current
      touchRef.current = null
      if (!start) return

      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y

      if (Math.abs(dx) < SWIPE_MIN_X) return
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return

      // Swiping left drags the next tab in from the right, and vice versa.
      // The index wraps, so a swipe at either end carries on round rather than
      // dying against the edge.
      const step = dx < 0 ? 1 : -1
      const next = TABS[(index + step + TABS.length) % TABS.length]
      selectTab(next.key, step > 0 ? 'left' : 'right')
    }

    // Passive: the handlers never preventDefault, and marking them so keeps
    // vertical scrolling smooth.
    const opts = { passive: true }
    document.addEventListener('touchstart', onTouchStart, opts)
    document.addEventListener('touchmove', onTouchMove, opts)
    document.addEventListener('touchend', onTouchEnd, opts)
    document.addEventListener('touchcancel', onTouchEnd, opts)

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [index, selectTab, flashBar])

  return (
    <>
      <div
        className={slide ? `tab-panel slide-${slide}` : 'tab-panel'}
        // `key` restarts the slide animation on every change, including a
        // repeat swipe in the same direction.
        key={tab}
      >
        {tab === 'weight' ? <WeightView /> : tab === 'foods' ? <FoodsView /> : <FoodView />}
      </div>

      <nav
        className={`tab-bar${barVisible ? ' visible' : ''}`}
        // Keep the bar up while it's being used, so it can't fade mid-tap.
        onPointerEnter={() => flashBar()}
      >
        {TABS.map((t, i) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => selectTab(t.key, i > index ? 'left' : i < index ? 'right' : null)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
