import { useState, useEffect, useCallback } from 'react'
import { initAuth, getEntries, deleteEntry } from './api.js'
import WeightChart from './components/WeightChart.jsx'
import EntryList from './components/EntryList.jsx'
import AddEditModal from './components/AddEditModal.jsx'
import FAB from './components/FAB.jsx'

const WINDOWS = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: null },
]

function filterByWindow(entries, days) {
  if (!days) return entries
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return entries.filter(e => e.date >= cutoffStr)
}

export default function App() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [window_, setWindow_] = useState('3M')
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
        await initAuth()
        await load()
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [load])

  const selectedWindow = WINDOWS.find(w => w.label === window_)
  const filtered = filterByWindow(entries, selectedWindow?.days)

  // Sorted ascending for chart
  const chartData = [...filtered].sort((a, b) => a.date.localeCompare(b.date))

  const currentWeight = entries.length > 0
    ? parseFloat(entries[0].weight)
    : null

  const windowStart = filtered.length > 0
    ? parseFloat(filtered[filtered.length - 1].weight)
    : null

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

  function handleFAB() {
    setEditEntry(null)
    setModalOpen(true)
  }

  async function handleSave() {
    setModalOpen(false)
    setEditEntry(null)
    await load()
  }

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="error">Error: {error}</div>

  return (
    <>
      <div className="header">
        <div className="header-title">Current Weight</div>
        {currentWeight !== null ? (
          <div className="header-weight">
            {currentWeight.toFixed(1)}<span>kg</span>
          </div>
        ) : (
          <div className="header-weight" style={{ fontSize: 24, color: 'var(--text-muted)' }}>
            No entries yet
          </div>
        )}
        {deltaLabel && (
          <div className={`header-delta ${delta > 0 ? 'delta-positive' : delta < 0 ? 'delta-negative' : 'delta-neutral'}`}>
            {deltaLabel} vs {window_}
          </div>
        )}
      </div>

      <div className="window-pills">
        {WINDOWS.map(w => (
          <button
            key={w.label}
            className={`pill${window_ === w.label ? ' active' : ''}`}
            onClick={() => setWindow_(w.label)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="chart-card">
        <WeightChart data={chartData} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div className="section-title">History</div>
        <EntryList
          entries={filtered}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
        {filtered.length === 0 && (
          <div className="empty">No entries in this period. Add one!</div>
        )}
      </div>

      <FAB onClick={handleFAB} />

      {modalOpen && (
        <AddEditModal
          entry={editEntry}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditEntry(null) }}
        />
      )}
    </>
  )
}
