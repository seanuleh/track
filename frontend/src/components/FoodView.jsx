import { useState, useEffect, useCallback } from 'react'
import { getLogsForDate, deleteLog, updateLogMeal, macrosFor, totalMacros, gramsFor, formatAmount } from '../food/api.js'
import FoodPickerSheet from './FoodPickerSheet.jsx'
import FAB from './FAB.jsx'
import { today, shiftDate } from '../dates.js'

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

export default function FoodView() {
  const [date, setDate] = useState(today)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [adding, setAdding] = useState(false) // FAB-opened picker sheet; meal is chosen inside
  const [dragId, setDragId] = useState(null)
  const [dragOverMeal, setDragOverMeal] = useState(null)

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

  async function handleDelete(id) {
    if (!confirm('Remove this entry?')) return
    try {
      await deleteLog(id)
      await load()
    } catch (err) {
      alert('Failed to remove: ' + err.message)
    }
  }

  async function handleDrop(meal) {
    setDragOverMeal(null)
    const id = dragId
    setDragId(null)
    if (!id) return
    const log = logs.find(l => l.id === id)
    if (!log || (log.meal || 'snack') === meal) return
    // Reflect the move immediately — waiting on the round trip makes the drop feel unresponsive.
    setLogs(ls => ls.map(l => (l.id === id ? { ...l, meal } : l)))
    try {
      await updateLogMeal(id, meal)
    } catch (err) {
      setError(err.message)
      await load()
    }
  }

  const totals = totalMacros(logs)

  // Every meal always gets a header, including empty ones, so it's a valid drop
  // target even before anything has ever been logged into it.
  const byMeal = MEAL_ORDER
    .map(meal => ({ meal, items: logs.filter(l => (l.meal || 'snack') === meal) }))

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

      {error && <div className="error">{error}</div>}

      {byMeal.map(({ meal, items }) => (
        <div
          key={meal}
          className={`meal-section${dragOverMeal === meal ? ' meal-section--dragover' : ''}`}
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setDragOverMeal(meal) } }}
          onDragLeave={() => setDragOverMeal(m => (m === meal ? null : m))}
          onDrop={(e) => { e.preventDefault(); handleDrop(meal) }}
        >
          <div className="section-title">{meal}</div>
          {items.length > 0 ? (
            <div className="log-list">
              {items.map(log => {
                const food = log.expand?.food
                const m = macrosFor(food, gramsFor(log, food))
                return (
                  <div
                    key={log.id}
                    className={`log-card${dragId === log.id ? ' log-card--dragging' : ''}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(log.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverMeal(null) }}
                    onClick={() => handleDelete(log.id)}
                  >
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
          ) : (
            <div className="meal-empty">Drop food here, or use + to add</div>
          )}
        </div>
      ))}

      <FAB onClick={() => setAdding(true)} />

      {adding && (
        <FoodPickerSheet
          date={date}
          onClose={() => setAdding(false)}
          onLogged={() => { setAdding(false); load() }}
        />
      )}
    </>
  )
}
