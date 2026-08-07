import { useState, useEffect, useCallback } from 'react'
import { getLogsForDate, deleteLog, resolveBarcode, searchFoods, macrosFor, totalMacros } from '../food/api.js'
import Scanner from './Scanner.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'

const today = () => new Date().toISOString().slice(0, 10)

function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

export default function FoodView() {
  const [date, setDate] = useState(today)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [scanning, setScanning] = useState(false)
  const [pending, setPending] = useState(null) // { food, barcode } for the modal
  const [status, setStatus] = useState(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  const load = useCallback(async () => {
    try {
      setLogs(await getLogsForDate(date))
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  // Search the local cache — foods you've already scanned, plus manual entries.
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const found = await searchFoods(query)
        if (!cancelled) setResults(found)
      } catch { /* a failed search shouldn't disturb the day view */ }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  async function handleDetected(barcode) {
    setScanning(false)
    setStatus('Looking up…')
    try {
      const { food, origin } = await resolveBarcode(barcode)
      setStatus(null)
      // A miss opens the same modal in manual mode, carrying the barcode so
      // the food gets saved against it and the next scan hits the cache.
      setPending({ food, barcode })
      if (origin === 'off') setStatus('Added from Open Food Facts')
    } catch (err) {
      setStatus(null)
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this entry?')) return
    try {
      await deleteLog(id)
      await load()
    } catch (err) {
      alert('Failed to remove: ' + err.message)
    }
  }

  const totals = totalMacros(logs)

  const byMeal = MEAL_ORDER
    .map(meal => ({ meal, items: logs.filter(l => (l.meal || 'snack') === meal) }))
    .filter(group => group.items.length > 0)

  if (loading) return <div className="loading">Loading…</div>

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div className="header-title">Calories</div>
          <div className="header-weight">
            {Math.round(totals.kcal)}<span>kcal</span>
          </div>
          <div className="macro-row">
            <span><strong>{totals.protein.toFixed(0)}g</strong> protein</span>
            <span><strong>{totals.fat.toFixed(0)}g</strong> fat</span>
            <span><strong>{totals.carbs.toFixed(0)}g</strong> carbs</span>
          </div>
        </div>
      </div>

      <div className="date-nav">
        <button onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day">‹</button>
        <span>{date === today() ? 'Today' : date}</span>
        <button
          onClick={() => setDate(d => shiftDate(d, 1))}
          disabled={date >= today()}
          aria-label="Next day"
        >›</button>
      </div>

      <div className="food-actions">
        <button className="btn btn-primary" onClick={() => setScanning(true)}>
          Scan barcode
        </button>
        <button className="btn btn-ghost" onClick={() => setPending({ food: null, barcode: '' })}>
          Add manually
        </button>
      </div>

      <div className="food-search">
        <input
          className="form-input"
          placeholder="Search foods you've logged before…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="search-results">
            {results.map(f => (
              <button
                key={f.id}
                className="search-result"
                onClick={() => { setPending({ food: f, barcode: f.barcode }); setQuery(''); setResults([]) }}
              >
                <span className="sr-name">{f.name}</span>
                <span className="sr-meta">
                  {f.brand ? `${f.brand} · ` : ''}
                  {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {status && <div className="food-status">{status}</div>}
      {error && <div className="error">{error}</div>}

      {byMeal.map(({ meal, items }) => (
        <div key={meal}>
          <div className="section-title">{meal}</div>
          <div className="log-list">
            {items.map(log => {
              const m = macrosFor(log.expand?.food, log.grams)
              return (
                <div key={log.id} className="log-card" onClick={() => handleDelete(log.id)}>
                  <div className="log-main">
                    <div className="log-name">{log.expand?.food?.name || 'Unknown food'}</div>
                    <div className="log-meta">
                      {Math.round(log.grams)} g
                      {log.expand?.food?.brand ? ` · ${log.expand.food.brand}` : ''}
                    </div>
                  </div>
                  <div className="log-kcal">{Math.round(m.kcal)}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {logs.length === 0 && <div className="empty">Nothing logged yet.</div>}

      {scanning && (
        <Scanner onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}

      {pending && (
        <FoodEntryModal
          food={pending.food}
          barcode={pending.barcode}
          date={date}
          onSaved={() => { setPending(null); setStatus(null); load() }}
          onClose={() => { setPending(null); setStatus(null) }}
        />
      )}
    </>
  )
}
