import { useState, useEffect } from 'react'
import { createRecipe, updateRecipe, getFood, gramsFor, macrosFor } from '../food/api.js'
import FoodPicker from './FoodPicker.jsx'
import { useEscapeClose, onFormKeyDown } from '../modalKeys.js'

/**
 * Create or edit a recipe: name, servings, and a list of
 * `{ food, name, amount, unit }` rows.
 *
 * `items` stores `food` (the relation id) plus a denormalised `name` so the
 * row list can render without an `expand` round-trip. Amount/unit follow §1 —
 * a recipe can hold "1 scoop" of protein powder next to "34 g" of oats.
 *
 * Each row also carries `kcal`/`unit_g` at runtime only, for the live kcal
 * preview — those come from the food record, not the saved recipe, so a
 * later macro correction is reflected next time the recipe is opened rather
 * than baked in.
 */
export default function RecipeBuilderModal({ recipe, onSaved, onClose }) {
  useEscapeClose(onClose)
  // A recipe with no `id` is a "Vary" copy: prefilled from an existing recipe
  // but with nothing saved yet, so it must still take the create path.
  const isNew = !recipe?.id
  const [name, setName] = useState(recipe?.name || '')
  const [servings, setServings] = useState(String(recipe?.servings || 1))
  const [items, setItems] = useState(() =>
    (recipe?.items || []).map(it => ({
      food: it.food,
      name: it.name || '',
      amount: String(it.amount ?? it.grams ?? ''),
      unit: it.unit || 'g',
      kcal: null,
      unit_g: null,
      unit_label: null,
    }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Existing rows load without macros (the recipe only stores the relation),
  // so fetch each referenced food once to power the kcal preview and show
  // its real unit name ("scoop", "ml") instead of the literal unit type.
  useEffect(() => {
    if (items.length === 0) return
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

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setError('Give the recipe a name.'); return }
    if (items.length === 0) { setError('Add at least one ingredient.'); return }

    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim(),
        servings,
        items: items.map(it => ({ food: it.food, name: it.name, amount: Number(it.amount) || 0, unit: it.unit })),
      }
      if (isNew) await createRecipe(payload)
      else await updateRecipe(recipe.id, payload)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{isNew ? 'New recipe' : 'Edit recipe'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
          <div className="form-group form-group--compact">
            <label className="form-label">Name</label>
            <input
              className="form-input form-input--compact"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Servings</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="1"
              value={servings}
              onChange={e => setServings(e.target.value)}
            />
          </div>

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

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
