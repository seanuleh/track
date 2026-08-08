import { useState, useEffect, useCallback } from 'react'
import { getLogsForDate, getTargetForDate, updateLogMeal, updateLogGroupMeal, macrosFor, totalMacros, gramsFor, formatAmount } from '../food/api.js'
import FoodPickerSheet from './FoodPickerSheet.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'
import RecipeGroupModal from './RecipeGroupModal.jsx'
import TargetsModal from './TargetsModal.jsx'
import FAB from './FAB.jsx'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import { today, shiftDate } from '../dates.js'

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

export default function FoodView() {
  const [date, setDate] = useState(today)
  const [logs, setLogs] = useState([])
  const [target, setTargetState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [adding, setAdding] = useState(false) // FAB-opened picker sheet; meal is chosen inside
  const [editingLog, setEditingLog] = useState(null) // a single log tapped for edit/delete
  const [editingGroup, setEditingGroup] = useState(null) // a recipe card tapped for edit/delete
  const [editingTarget, setEditingTarget] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOverMeal, setDragOverMeal] = useState(null)

  const load = useCallback(async () => {
    try {
      const [dayLogs, dayTarget] = await Promise.all([getLogsForDate(date), getTargetForDate(date)])
      setLogs(dayLogs)
      setTargetState(dayTarget)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  async function handleDrop(meal) {
    setDragOverMeal(null)
    const id = dragId
    setDragId(null)
    if (!id) return

    if (id.startsWith('group:')) {
      const recipeGroup = id.slice('group:'.length)
      const groupLogs = logs.filter(l => l.recipe_group === recipeGroup)
      if (groupLogs.length === 0 || (groupLogs[0].meal || 'snack') === meal) return
      setLogs(ls => ls.map(l => (l.recipe_group === recipeGroup ? { ...l, meal } : l)))
      try {
        await updateLogGroupMeal(recipeGroup, meal)
      } catch (err) {
        setError(err.message)
        await load()
      }
      return
    }

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

  // Collapse rows sharing a recipe_group into one entry, so a logged recipe
  // shows as itself in the diary rather than as its expanded ingredients.
  // Order preserved from the original -created sort by keeping each group's
  // position at its first row.
  function groupLogs(items) {
    const grouped = []
    const seen = new Map() // recipe_group -> grouped entry
    for (const log of items) {
      if (!log.recipe_group) {
        grouped.push(log)
        continue
      }
      let entry = seen.get(log.recipe_group)
      if (!entry) {
        entry = { recipe_group: log.recipe_group, recipe_name: log.recipe_name, meal: log.meal, items: [] }
        seen.set(log.recipe_group, entry)
        grouped.push(entry)
      }
      entry.items.push(log)
    }
    return grouped
  }

  // Every meal always gets a header, including empty ones, so it's a valid drop
  // target even before anything has ever been logged into it.
  const byMeal = MEAL_ORDER
    .map(meal => ({ meal, items: groupLogs(logs.filter(l => (l.meal || 'snack') === meal)) }))

  if (loading) return <div className="loading">Loading…</div>

  return (
    <>
      <div className="header">
        <div className="header-inner">
          <div className="header-title-row">
            <div className="header-title">Calories</div>
            <button
              type="button"
              className="header-edit-btn"
              onClick={() => setEditingTarget(true)}
              aria-label={target ? 'Edit target' : 'Set target'}
            >
              ✎
            </button>
          </div>
          {target ? (
            <div className="targets-panel">
              <div className={`header-weight header-weight--remaining${totals.kcal > target.kcal ? ' header-weight--over' : ''}`}>
                {Math.round(Math.abs(target.kcal - totals.kcal))}
                <span>{totals.kcal > target.kcal ? 'kcal over' : 'kcal left'}</span>
              </div>
              {[
                { key: 'kcal', label: 'Energy', value: totals.kcal, goal: target.kcal, decimals: 0, unit: 'kcal', color: 'energy' },
                { key: 'protein', label: 'Protein', value: totals.protein, goal: target.protein, decimals: 1, unit: 'g', color: 'protein' },
                { key: 'carbs', label: 'Carbs', value: totals.carbs, goal: target.carbs, decimals: 1, unit: 'g', color: 'carbs' },
                { key: 'fat', label: 'Fat', value: totals.fat, goal: target.fat, decimals: 1, unit: 'g', color: 'fat' },
              ].filter(row => row.goal != null).map(row => {
                const pct = row.goal > 0 ? Math.round((row.value / row.goal) * 100) : 0
                return (
                  <div className="target-metric" key={row.key}>
                    <div className="target-metric-top">
                      <span className="target-metric-label">{row.label}</span>
                      <span className="target-metric-values">
                        {row.value.toFixed(row.decimals)} / {row.goal.toFixed(row.decimals)} {row.unit}
                      </span>
                      <span className="target-metric-pct">{pct}%</span>
                    </div>
                    <div className="target-metric-bar">
                      <div
                        className={`target-metric-fill target-metric-fill--${row.color}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <>
              <div className="header-weight">
                {Math.round(totals.kcal)}<span>kcal</span>
              </div>
              <div className="macro-row">
                <span><strong>{totals.protein.toFixed(0)}g</strong> protein</span>
                <span><strong>{totals.fat.toFixed(0)}g</strong> fat</span>
                <span><strong>{totals.carbs.toFixed(0)}g</strong> carbs</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="date-nav">
        <button onClick={() => setDate(d => shiftDate(d, -1))} aria-label="Previous day">‹</button>
        <label className="date-nav-label">
          {date === today() ? 'Today' : date}
          <input
            type="date"
            className="date-nav-input"
            value={date}
            max={today()}
            onChange={e => e.target.value && setDate(e.target.value)}
            aria-label="Pick a date"
          />
        </label>
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
              {items.map(entry => {
                if (entry.items) {
                  // Grouped recipe row — sum the expanded ingredients' macros.
                  const dragKey = `group:${entry.recipe_group}`
                  const totals = entry.items.reduce((acc, log) => {
                    const food = log.expand?.food
                    const grams = gramsFor(log, food)
                    const m = macrosFor(food, grams)
                    acc.kcal += m.kcal || 0
                    acc.protein += m.protein || 0
                    acc.fat += m.fat || 0
                    acc.carbs += m.carbs || 0
                    return acc
                  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 })
                  return (
                    <div
                      key={entry.recipe_group}
                      className={`log-card${dragId === dragKey ? ' log-card--dragging' : ''}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(dragKey) }}
                      onDragEnd={() => { setDragId(null); setDragOverMeal(null) }}
                      onClick={() => setEditingGroup(entry)}
                    >
                      <div className="log-main">
                        <div className="log-name">{entry.recipe_name || 'Recipe'}</div>
                        <div className="log-meta">
                          {entry.items.length} ingredient{entry.items.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="log-stats">
                        <MacroLine food={totals} grams={100} />
                        <KcalCol kcal={totals.kcal} suffix="" />
                      </div>
                    </div>
                  )
                }

                const log = entry
                const food = log.expand?.food
                const grams = gramsFor(log, food)
                const kcal = macrosFor(food, grams).kcal
                return (
                  <div
                    key={log.id}
                    className={`log-card${dragId === log.id ? ' log-card--dragging' : ''}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragId(log.id) }}
                    onDragEnd={() => { setDragId(null); setDragOverMeal(null) }}
                    onClick={() => setEditingLog(log)}
                  >
                    <div className="log-main">
                      <div className="log-name">{food?.name || 'Unknown food'}</div>
                      <div className="log-meta">
                        {formatAmount(log, food)}
                        {food?.brand ? ` · ${food.brand}` : ''}
                      </div>
                    </div>
                    <div className="log-stats">
                      <MacroLine food={food || {}} grams={grams} />
                      <KcalCol kcal={food ? kcal : null} suffix="" />
                    </div>
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

      {editingLog && (
        <FoodEntryModal
          log={editingLog}
          onClose={() => setEditingLog(null)}
          onSaved={() => { setEditingLog(null); load() }}
          onDeleted={() => { setEditingLog(null); load() }}
        />
      )}

      {editingGroup && (
        <RecipeGroupModal
          entry={editingGroup}
          onClose={() => setEditingGroup(null)}
          onSaved={() => { setEditingGroup(null); load() }}
        />
      )}

      {editingTarget && (
        <TargetsModal
          current={target}
          onClose={() => setEditingTarget(false)}
          onSaved={() => { setEditingTarget(false); load() }}
        />
      )}
    </>
  )
}
