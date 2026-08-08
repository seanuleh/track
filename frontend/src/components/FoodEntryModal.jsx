import { useState } from 'react'
import { createFood, logFood, updateLog, deleteLog, macrosFor, gramsFor, ensureFoodFromCatalog, portionOf } from '../food/api.js'
import FoodForm, { formFromFood, foodFromForm } from './FoodForm.jsx'
import { today } from '../dates.js'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

// Guess the meal from the clock so the common case needs no taps.
export function defaultMeal() {
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
export default function FoodEntryModal({ food, catalog, barcode, log, date: presetDate, meal: presetMeal, onSaved, onDeleted, onClose }) {
  // Editing an existing log: the food it points at, not a fresh lookup.
  const isEditing = !!log
  food = food || catalog || (isEditing ? log.expand?.food : null) || null
  const isManual = !isEditing && !food

  // Editing prefills from the log itself; a new entry prefills from your usual
  // portion for this food — falling back to a unit, the pack serving, then
  // 100 g. Always overridable either way.
  const hasUnit = !!food?.unit_label
  const initial = isEditing ? { amount: log.amount, unit: log.unit || 'g' } : portionOf(food)
  const [unit, setUnit] = useState(initial.unit)
  const [amount, setAmount] = useState(() => String(initial.amount))
  // A meal tapped on the picker sheet is already decided — no need to ask again.
  const [meal, setMeal] = useState(isEditing ? (log.meal || 'snack') : (presetMeal || defaultMeal()))
  // The diary always knows the day it's logging into and passes it fixed; a
  // caller with no day context (the Foods manager's quick-add) gets an
  // editable field here instead, defaulting to today.
  const [entryDate, setEntryDate] = useState(isEditing ? log.date : (presetDate || today()))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
      if (isEditing) {
        await updateLog(log.id, { date: entryDate, amount: a, unit, food, meal })
      } else {
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
        await logFood({ date: entryDate, foodId: target.id, amount: a, unit, food: target, meal })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this entry?')) return
    setDeleting(true)
    setError(null)
    try {
      await deleteLog(log.id)
      onDeleted ? onDeleted() : onSaved()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
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

          {!presetDate && (
            <div className="form-group form-group--compact">
              <label className="form-label">Date</label>
              <input
                className="form-input form-input--compact"
                type="date"
                value={entryDate}
                max={today()}
                onChange={e => e.target.value && setEntryDate(e.target.value)}
                required
              />
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

          <div className="macro-preview">
            <div><strong>{Math.round(preview.kcal)}</strong><span>kcal</span></div>
            <div><strong>{preview.protein.toFixed(1)}</strong><span>protein</span></div>
            <div><strong>{preview.fat.toFixed(1)}</strong><span>fat</span></div>
            <div><strong>{preview.carbs.toFixed(1)}</strong><span>carbs</span></div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            {isEditing && (
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting || saving}>
                {deleting ? 'Removing…' : 'Delete'}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || deleting}>
              {saving ? 'Saving…' : (isEditing ? 'Save' : 'Log it')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
