import { useState, useEffect, useCallback } from 'react'
import { getLogsForDate, deleteLog, macrosFor, totalMacros, gramsFor, formatAmount } from '../food/api.js'
import FoodPickerSheet from './FoodPickerSheet.jsx'
import { today, shiftDate } from '../dates.js'

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

export default function FoodView() {
  const [date, setDate] = useState(today)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [addingMeal, setAddingMeal] = useState(null) // meal name for the open picker sheet

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

  const totals = totalMacros(logs)

  // Every meal always gets a header — including empty ones — so its `+` is
  // reachable without first logging something into it another way.
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
        <div key={meal}>
          <div className="section-title section-title--meal">
            <span>{meal}</span>
            <button
              type="button"
              className="meal-add-btn"
              aria-label={`Add to ${meal}`}
              onClick={() => setAddingMeal(meal)}
            >+</button>
          </div>
          {items.length > 0 && (
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
          )}
        </div>
      ))}

      {addingMeal && (
        <FoodPickerSheet
          meal={addingMeal}
          date={date}
          onClose={() => setAddingMeal(null)}
          onLogged={() => { setAddingMeal(null); load() }}
        />
      )}
    </>
  )
}
