import { useState } from 'react'
import { createFood, logFood, macrosFor, gramsFor, ensureFoodFromCatalog } from '../food/api.js'
import FoodForm, { formFromFood, foodFromForm } from './FoodForm.jsx'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

// Guess the meal from the clock so the common case needs no taps.
function defaultMeal() {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

/**
 * Three modes:
 *  - `food` given    → confirm the portion and log it.
 *  - `catalog` given → a hit from the local Open Food Facts mirror. It is
 *                      copied into `foods` on submit, not on tap, so browsing
 *                      the catalog and backing out doesn't litter the library.
 *  - neither         → the barcode wasn't in the cache, the catalog or Open
 *                      Food Facts, so capture the label by hand. Saved to
 *                      `foods`, making it a one-time cost per item.
 */
export default function FoodEntryModal({ food, catalog, barcode, date, onSaved, onClose }) {
  // A catalog row has the same macro shape as a food, so everything below
  // treats it as one — only the save path differs.
  food = food || catalog || null
  const isManual = !food

  // A food that defines a unit (scoop, block, ml) defaults to one of them;
  // everything else defaults to grams, prefilled with the pack's serving.
  const hasUnit = !!food?.unit_label
  const [unit, setUnit] = useState(hasUnit ? 'unit' : 'g')
  const [amount, setAmount] = useState(() =>
    hasUnit ? '1' : String(food?.serving_g || 100)
  )
  const [meal, setMeal] = useState(defaultMeal)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Manual-entry fields — the same form the Foods manager uses.
  const [form, setForm] = useState(() => formFromFood(null))

  // While entering a new food, its macros and unit come from the form, not a
  // record that doesn't exist yet.
  const draft = isManual ? foodFromForm(form) : food

  const grams = gramsFor({ amount, unit }, draft)
  const preview = macrosFor(draft, grams)
  const canUseUnits = isManual ? !!form.unit_label.trim() : hasUnit
  const unitName = (isManual ? form.unit_label : food?.unit_label) || 'unit'

  async function handleSubmit(e) {
    e.preventDefault()
    const a = parseFloat(amount)
    if (isNaN(a) || a <= 0) { setError('Enter a valid amount.'); return }
    if (isManual && !form.name.trim()) { setError('Give the food a name.'); return }
    if (unit === 'unit' && !(parseFloat(isManual ? form.unit_g : food.unit_g) > 0)) {
      setError(`Set how many grams are in one ${unitName}.`); return
    }

    setSaving(true)
    setError(null)
    try {
      let target = food
      if (isManual) {
        target = await createFood({
          ...foodFromForm(form),
          barcode: barcode || '',
          source: 'manual',
        })
      } else if (catalog) {
        // Promote now that it's actually being logged.
        target = await ensureFoodFromCatalog(catalog)
      }
      await logFood({ date, foodId: target.id, amount: a, unit, food: target, meal })
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
          <div className="modal-title modal-title--compact">
            {isManual ? 'New food' : food.name}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          {isManual ? (
            <>
              <div className="food-hint">
                {barcode
                  ? `Barcode ${barcode} isn't in Open Food Facts yet — add it once and it's saved for good.`
                  : 'Add a food by hand.'}
              </div>

              <FoodForm form={form} onChange={setForm} autoFocus />
            </>
          ) : (
            <div className="food-hint">
              {food.brand ? `${food.brand} · ` : ''}
              {food.kcal != null ? `${Math.round(food.kcal)} kcal per 100 g` : 'No energy data on record'}
            </div>
          )}

          <div className="form-group form-group--compact">
            <label className="form-label">Amount</label>
            <div className="amount-row">
              <input
                className="form-input form-input--compact"
                type="number" inputMode="decimal" step="any" min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                autoFocus={!isManual}
                required
              />
              {/* Grams are always available; the unit toggle appears only once
                  the food actually defines one. */}
              <div className="unit-toggle">
                <button
                  type="button"
                  className={`meal-pill${unit === 'g' ? ' active' : ''}`}
                  onClick={() => setUnit('g')}
                >g</button>
                {canUseUnits && (
                  <button
                    type="button"
                    className={`meal-pill${unit === 'unit' ? ' active' : ''}`}
                    onClick={() => setUnit('unit')}
                  >{unitName}</button>
                )}
              </div>
            </div>
            {unit === 'unit' && grams != null && (
              <div className="food-hint">= {Math.round(grams * 10) / 10} g</div>
            )}
          </div>

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

          <div className="macro-preview">
            <div><strong>{Math.round(preview.kcal)}</strong><span>kcal</span></div>
            <div><strong>{preview.protein.toFixed(1)}</strong><span>protein</span></div>
            <div><strong>{preview.fat.toFixed(1)}</strong><span>fat</span></div>
            <div><strong>{preview.carbs.toFixed(1)}</strong><span>carbs</span></div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Log it'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
