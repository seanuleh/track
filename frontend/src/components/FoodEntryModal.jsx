import { useState } from 'react'
import { createFood, logFood, macrosFor, gramsFor } from '../food/api.js'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

// Guess the meal from the clock so the common case needs no taps.
function defaultMeal() {
  const h = new Date().getHours()
  if (h < 10) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

const MACRO_FIELDS = [
  { key: 'kcal', label: 'kcal' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'fat', label: 'Fat (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
]

/**
 * Two modes:
 *  - `food` given → confirm the portion and log it.
 *  - `food` null  → the barcode wasn't in the cache or Open Food Facts, so
 *                   capture the label by hand and log it. The food is saved to
 *                   `foods`, making this a one-time cost per item.
 */
export default function FoodEntryModal({ food, barcode, date, onSaved, onClose }) {
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

  // Manual-entry fields. Macros are per 100 g, matching how they're stored.
  // unit_label/unit_g are optional: they let this food later be logged as
  // "1 scoop" or "135 ml" instead of a weight.
  const [form, setForm] = useState({
    name: '', brand: '', kcal: '', protein: '', fat: '', carbs: '',
    unit_label: '', unit_g: '',
  })

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }))

  // While entering a new food, its unit comes from the form, not the record.
  const draft = isManual
    ? {
        kcal: Number(form.kcal), protein: Number(form.protein),
        fat: Number(form.fat), carbs: Number(form.carbs),
        unit_label: form.unit_label, unit_g: parseFloat(form.unit_g),
      }
    : food

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
          barcode: barcode || '',
          name: form.name.trim(),
          brand: form.brand.trim(),
          source: 'manual',
          // Blank stays null rather than 0, so "unknown" and "genuinely zero"
          // don't get conflated in later totals.
          kcal: form.kcal === '' ? null : parseFloat(form.kcal),
          protein: form.protein === '' ? null : parseFloat(form.protein),
          fat: form.fat === '' ? null : parseFloat(form.fat),
          carbs: form.carbs === '' ? null : parseFloat(form.carbs),
          unit_label: form.unit_label.trim(),
          unit_g: form.unit_g === '' ? null : parseFloat(form.unit_g),
        })
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

              <div className="form-group form-group--compact">
                <label className="form-label">Name</label>
                <input
                  className="form-input form-input--compact"
                  value={form.name}
                  onChange={e => setField('name', e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group form-group--compact">
                <label className="form-label">Brand</label>
                <input
                  className="form-input form-input--compact"
                  value={form.brand}
                  onChange={e => setField('brand', e.target.value)}
                />
              </div>

              <div className="food-hint">
                Optional: a natural unit, so you can log this as “1 scoop” or
                “135 ml” instead of a weight.
              </div>

              <div className="form-row-2">
                <div className="form-group form-group--compact">
                  <label className="form-label">Unit name</label>
                  <input
                    className="form-input form-input--compact"
                    placeholder="scoop, block, ml"
                    value={form.unit_label}
                    onChange={e => setField('unit_label', e.target.value)}
                  />
                </div>
                <div className="form-group form-group--compact">
                  <label className="form-label">Grams per {unitName}</label>
                  <input
                    className="form-input form-input--compact"
                    type="number" inputMode="decimal" step="any" min="0"
                    value={form.unit_g}
                    onChange={e => setField('unit_g', e.target.value)}
                  />
                </div>
              </div>

              <div className="food-hint">Per 100 g, from the nutrition panel</div>

              <div className="form-row-2">
                {MACRO_FIELDS.map(({ key, label }) => (
                  <div className="form-group form-group--compact" key={key}>
                    <label className="form-label">{label}</label>
                    <input
                      className="form-input form-input--compact"
                      type="number" inputMode="decimal" step="any" min="0"
                      value={form[key]}
                      onChange={e => setField(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
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
