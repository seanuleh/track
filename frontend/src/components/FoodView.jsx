import { useState, useEffect, useCallback } from 'react'
import { getLogsForDate, deleteLog, resolveBarcode, searchFoods, searchCatalog, macrosFor, totalMacros, gramsFor, formatAmount } from '../food/api.js'
import Scanner from './Scanner.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'
import { today, shiftDate } from '../dates.js'

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
  const [catalogResults, setCatalogResults] = useState([])

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

  // Two sources, both local: your own foods, then the Open Food Facts mirror.
  // Yours first because a food you've logged before is nearly always the one
  // you mean, and it carries your corrections and serving units.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setCatalogResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const [mine, catalog] = await Promise.all([
          searchFoods(query),
          searchCatalog(query),
        ])
        if (cancelled) return
        setResults(mine)
        // Drop catalog rows already in your library, or the same product
        // appears twice with the top one being the stale copy.
        const known = new Set(mine.map(f => f.barcode).filter(Boolean))
        setCatalogResults(catalog.filter(c => !known.has(c.barcode)))
      } catch { /* a failed search shouldn't disturb the day view */ }
    }, 200)
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
      if (origin === 'catalog') setStatus('Found in the local Open Food Facts catalog')
      else if (origin === 'off') setStatus('Added from Open Food Facts')
    } catch (err) {
      setStatus(null)
      setError(err.message)
    }
  }

  function clearSearch() {
    setQuery('')
    setResults([])
    setCatalogResults([])
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
          placeholder="Search foods…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {(results.length > 0 || catalogResults.length > 0) && (
          <div className="search-results">
            {results.map(f => (
              <button
                key={f.id}
                className="search-result"
                onClick={() => { setPending({ food: f, barcode: f.barcode }); clearSearch() }}
              >
                <span className="sr-name">{f.name}</span>
                <span className="sr-meta">
                  {f.brand ? `${f.brand} · ` : ''}
                  {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
                </span>
              </button>
            ))}

            {catalogResults.length > 0 && (
              <div className="sr-divider">Open Food Facts</div>
            )}
            {catalogResults.map(c => (
              <button
                key={c.id}
                className="search-result"
                onClick={() => { setPending({ catalog: c, barcode: c.barcode }); clearSearch() }}
              >
                <span className="sr-name">{c.name}</span>
                <span className="sr-meta">
                  {c.brand ? `${c.brand} · ` : ''}
                  {Math.round(c.kcal)} kcal/100g
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
              const food = log.expand?.food
              const m = macrosFor(food, gramsFor(log, food))
              return (
                <div key={log.id} className="log-card" onClick={() => handleDelete(log.id)}>
                  <div className="log-main">
                    <div className="log-name">{food?.name || 'Unknown food'}</div>
                    <div className="log-meta">
                      {formatAmount(log, food)}
                      {food?.brand ? ` · ${food.brand}` : ''}
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
          catalog={pending.catalog}
          barcode={pending.barcode}
          date={date}
          onSaved={() => { setPending(null); setStatus(null); load() }}
          onClose={() => { setPending(null); setStatus(null) }}
        />
      )}
    </>
  )
}
