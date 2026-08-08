/**
 * The food definition form: name, brand, natural unit, macros.
 *
 * Shared deliberately. "Define a food" happens in the Foods manager (create and
 * edit) and will happen again in the picker sheet's "create custom food"
 * fallback. One form means the unit fields and the null-vs-zero rule below
 * can't drift between them.
 *
 * Controlled: the parent owns the values and the save button, because the two
 * callers wrap it in different chrome — a full-screen editor vs a bottom sheet
 * that also logs what it just created.
 */

// Blank must survive as null, not collapse to 0: "unknown" and "genuinely
// zero" are different facts, and conflating them makes totals under-report
// while looking complete.
export function numOrNull(v) {
  return v === '' || v == null ? null : parseFloat(v)
}

/** A food record from form state, ready for create/update. */
export function foodFromForm(form) {
  return {
    name: form.name.trim(),
    brand: form.brand.trim(),
    unit_label: form.unit_label.trim(),
    unit_g: numOrNull(form.unit_g),
    serving_g: numOrNull(form.serving_g),
    kcal: numOrNull(form.kcal),
    protein: numOrNull(form.protein),
    fat: numOrNull(form.fat),
    carbs: numOrNull(form.carbs),
    fiber: numOrNull(form.fiber),
    sugar: numOrNull(form.sugar),
    sodium: numOrNull(form.sodium),
  }
}

/** Form state from an existing record — or blanks for a new one. */
export function formFromFood(food) {
  const str = v => (v == null ? '' : String(v))
  return {
    name: food?.name || '',
    brand: food?.brand || '',
    unit_label: food?.unit_label || '',
    unit_g: str(food?.unit_g || ''),
    serving_g: str(food?.serving_g || ''),
    kcal: str(food?.kcal), protein: str(food?.protein),
    fat: str(food?.fat), carbs: str(food?.carbs),
    fiber: str(food?.fiber), sugar: str(food?.sugar),
    sodium: str(food?.sodium),
  }
}

const MACRO_FIELDS = [
  { key: 'kcal', label: 'kcal' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'fat', label: 'Fat (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
]

const EXTRA_FIELDS = [
  { key: 'fiber', label: 'Fibre (g)' },
  { key: 'sugar', label: 'Sugar (g)' },
  { key: 'sodium', label: 'Sodium (mg)' },
]

export default function FoodForm({ form, onChange, autoFocus = false, showExtras = false }) {
  const set = (key, value) => onChange({ ...form, [key]: value })
  const unitName = form.unit_label.trim() || 'unit'

  return (
    <>
      <div className="form-group form-group--compact">
        <label className="form-label">Name</label>
        <input
          className="form-input form-input--compact"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          autoFocus={autoFocus}
          required
        />
      </div>

      <div className="form-group form-group--compact">
        <label className="form-label">Brand</label>
        <input
          className="form-input form-input--compact"
          value={form.brand}
          onChange={e => set('brand', e.target.value)}
        />
      </div>

      <div className="food-hint">
        Optional: a natural unit, so this can be logged as “1 {unitName}”
        instead of a weight. Millilitres count — milk is “ml” at about 1.03 g each.
      </div>

      <div className="form-row-2">
        <div className="form-group form-group--compact">
          <label className="form-label">Unit name</label>
          <input
            className="form-input form-input--compact"
            placeholder="scoop, block, ml"
            value={form.unit_label}
            onChange={e => set('unit_label', e.target.value)}
          />
        </div>
        <div className="form-group form-group--compact">
          <label className="form-label">Grams per {unitName}</label>
          <input
            className="form-input form-input--compact"
            type="number" inputMode="decimal" step="any" min="0"
            value={form.unit_g}
            onChange={e => set('unit_g', e.target.value)}
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
              onChange={e => set(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {showExtras && (
        <div className="form-row-2">
          {EXTRA_FIELDS.map(({ key, label }) => (
            <div className="form-group form-group--compact" key={key}>
              <label className="form-label">{label}</label>
              <input
                className="form-input form-input--compact"
                type="number" inputMode="decimal" step="any" min="0"
                value={form[key]}
                onChange={e => set(key, e.target.value)}
              />
            </div>
          ))}
          <div className="form-group form-group--compact">
            <label className="form-label">Pack serving (g)</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={form.serving_g}
              onChange={e => set('serving_g', e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  )
}
