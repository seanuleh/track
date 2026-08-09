import { useState, useEffect } from 'react'
import { getFood, gramsFor, macrosFor, logRecipeItems, createRecipe } from '../food/api.js'
import FoodPicker from './FoodPicker.jsx'
import { defaultMeal } from './FoodEntryModal.jsx'
import { today, shiftDate } from '../dates.js'
import { useEscapeClose, onFormKeyDown, overlayDismiss } from '../modalKeys.js'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

/**
 * Edit-before-log: tapping a recipe in the diary (or "Add" from the Foods/
 * Recipes tab) opens this instead of logging it immediately. Items are
 * pre-filled at one serving (recipe amounts / servings — the same math
 * logRecipe used to do inline), then freely adjusted — swap an ingredient
 * (remove + FoodPicker add), change an amount, drop one — before anything
 * is written.
 *
 * `servingsEaten` is a separate multiplier applied to every item's amount
 * only at submit time (same "scale on save, not live" rule as
 * RecipeGroupModal's servings-eaten field) — so per-item amounts stay
 * readable as one serving's worth while editing.
 *
 * Confirming calls logRecipeItems with this edited list, not the saved
 * recipe, so tweaking here never rewrites the recipe definition itself
 * (that's the Recipes tab's job) — same "expand by value" rule as logRecipe.
 */
export default function RecipeLogModal({ recipe, date: presetDate, meal: presetMeal, onLogged, onClose }) {
  useEscapeClose(onClose)
  const [entryDate, setEntryDate] = useState(presetDate || today())
  const servings = Number(recipe.servings) || 1
  const [items, setItems] = useState(() =>
    (recipe.items || []).map(it => ({
      food: it.food,
      name: it.name || '',
      amount: String((Number(it.amount ?? it.grams) || 0) / servings),
      unit: it.unit || 'g',
      kcal: null,
      unit_g: null,
      unit_label: null,
    }))
  )
  const [meal, setMeal] = useState(presetMeal || defaultMeal())
  const [servingsEaten, setServingsEaten] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [savingAs, setSavingAs] = useState(false)
  const [savedAs, setSavedAs] = useState(false)

  // The recipe only stores the relation, so fetch each ingredient once to
  // power the live kcal preview — same approach as RecipeBuilderModal.
  useEffect(() => {
    let cancelled = false
    Promise.all(items.map(it => getFood(it.food).catch(() => null))).then(foods => {
      if (cancelled) return
      setItems(prev => prev.map((it, i) => (
        foods[i] ? { ...it, kcal: foods[i].kcal, unit_g: foods[i].unit_g, unit_label: foods[i].unit_label } : it
      )))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function itemKcal(it) {
    const grams = gramsFor({ amount: it.amount, unit: it.unit }, { unit_g: it.unit_g })
    if (grams == null || it.kcal == null) return null
    return macrosFor({ kcal: it.kcal }, grams).kcal
  }

  function updateItem(i, patch) {
    setItems(prev => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  function removeItem(i) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  function addItem(food) {
    setItems(prev => [
      ...prev,
      {
        food: food.id, name: food.name,
        amount: food.unit_label ? '1' : '100', unit: food.unit_label ? 'unit' : 'g',
        kcal: food.kcal, unit_g: food.unit_g, unit_label: food.unit_label,
      },
    ])
  }

  async function handleSaveAs() {
    if (!saveAsName.trim()) { setError('Name the variation.'); return }
    if (items.length === 0) { setError('Add at least one ingredient.'); return }

    setSavingAs(true)
    setError(null)
    try {
      await createRecipe({
        name: saveAsName.trim(),
        servings: 1,
        items: items.map(it => ({ food: it.food, name: it.name, amount: Number(it.amount) || 0, unit: it.unit })),
      })
      setSavedAs(true)
      setShowSaveAs(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAs(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (items.length === 0) { setError('Add at least one ingredient.'); return }
    const factor = parseFloat(servingsEaten)
    if (isNaN(factor) || factor <= 0) { setError('Enter a valid servings amount.'); return }

    setSaving(true)
    setError(null)
    try {
      await logRecipeItems(
        items.map(it => ({ food: it.food, amount: (Number(it.amount) || 0) * factor, unit: it.unit })),
        { date: entryDate, meal, recipeName: recipe.name }
      )
      onLogged()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" {...overlayDismiss(onClose)}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{recipe.name}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
          {!presetMeal && (
            <div className="form-group form-group--compact">
              <label className="form-label">Meal</label>
              <div className="meal-pills">
                {MEALS.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`meal-pill${meal === m ? ' active' : ''}`}
                    onClick={() => setMeal(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group form-group--compact">
            <label className="form-label">Servings</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={servingsEaten}
              onChange={e => setServingsEaten(e.target.value)}
            />
          </div>

          {!presetDate && (
            <div className="form-group form-group--compact">
              <label className="form-label">Date</label>
              <input
                className="form-input form-input--compact"
                type="date"
                value={entryDate}
                max={shiftDate(today(), 7)}
                onChange={e => e.target.value && setEntryDate(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-label">Ingredients</div>
          <div className="log-list">
            {items.map((it, i) => {
              const kcal = itemKcal(it)
              return (
                <div key={i} className="ingredient-row">
                  <div className="ingredient-name">{it.name}</div>
                  <div className="ingredient-kcal">
                    {kcal != null ? `${Math.round(kcal)} kcal` : ''}
                  </div>
                  <input
                    className="form-input form-input--compact ingredient-amount"
                    type="number" inputMode="decimal" step="any" min="0"
                    value={it.amount}
                    onChange={e => updateItem(i, { amount: e.target.value })}
                  />
                  <span className="ingredient-unit">{it.unit === 'unit' ? (it.unit_label || 'unit') : it.unit}</span>
                  <button type="button" className="icon-btn danger" onClick={() => removeItem(i)}>✕</button>
                </div>
              )
            })}
          </div>

          <FoodPicker onPick={addItem} />

          {savedAs && !showSaveAs && (
            <div className="ingredient-name">Saved as a new recipe.</div>
          )}
          {!showSaveAs ? (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setShowSaveAs(true)}>
              Save this variation as a new recipe
            </button>
          ) : (
            <div className="form-group form-group--compact">
              <label className="form-label">Variation name</label>
              <div className="ingredient-row">
                <input
                  className="form-input form-input--compact"
                  value={saveAsName}
                  onChange={e => setSaveAsName(e.target.value)}
                  placeholder={`${recipe.name} – variation`}
                />
                <button type="button" className="btn btn-ghost" onClick={() => setShowSaveAs(false)}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={savingAs} onClick={handleSaveAs}>
                  {savingAs ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Logging…' : 'Log it'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
