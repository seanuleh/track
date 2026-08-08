import { useState, useEffect } from 'react'
import { getFood, gramsFor, macrosFor, logRecipeItems } from '../food/api.js'
import FoodPicker from './FoodPicker.jsx'
import { defaultMeal } from './FoodEntryModal.jsx'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

/**
 * Edit-before-log: tapping a recipe in the diary opens this instead of
 * logging it immediately. Items are pre-filled at one serving (recipe
 * amounts / servings — the same math logRecipe used to do inline), then
 * freely adjusted — swap an ingredient (remove + FoodPicker add), change an
 * amount, drop one — before anything is written.
 *
 * Confirming calls logRecipeItems with this edited list, not the saved
 * recipe, so tweaking here never rewrites the recipe definition itself
 * (that's the Recipes tab's job) — same "expand by value" rule as logRecipe.
 */
export default function RecipeLogModal({ recipe, date, meal: presetMeal, onLogged, onClose }) {
  const servings = Number(recipe.servings) || 1
  const [items, setItems] = useState(() =>
    (recipe.items || []).map(it => ({
      food: it.food,
      name: it.name || '',
      amount: String((Number(it.amount ?? it.grams) || 0) / servings),
      unit: it.unit || 'g',
      kcal: null,
      unit_g: null,
    }))
  )
  const [meal, setMeal] = useState(presetMeal || defaultMeal())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // The recipe only stores the relation, so fetch each ingredient once to
  // power the live kcal preview — same approach as RecipeBuilderModal.
  useEffect(() => {
    let cancelled = false
    Promise.all(items.map(it => getFood(it.food).catch(() => null))).then(foods => {
      if (cancelled) return
      setItems(prev => prev.map((it, i) => (
        foods[i] ? { ...it, kcal: foods[i].kcal, unit_g: foods[i].unit_g } : it
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
        kcal: food.kcal, unit_g: food.unit_g,
      },
    ])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (items.length === 0) { setError('Add at least one ingredient.'); return }

    setSaving(true)
    setError(null)
    try {
      await logRecipeItems(
        items.map(it => ({ food: it.food, amount: Number(it.amount) || 0, unit: it.unit })),
        { date, meal, recipeName: recipe.name }
      )
      onLogged()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{recipe.name}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
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
                  <span className="ingredient-unit">{it.unit}</span>
                  <button type="button" className="icon-btn danger" onClick={() => removeItem(i)}>✕</button>
                </div>
              )
            })}
          </div>

          <FoodPicker onPick={addItem} />

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
