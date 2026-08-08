import { useState } from 'react'
import { createFood, updateFood, deleteFood, countLogsForFood } from '../food/api.js'
import FoodForm, { formFromFood, foodFromForm } from './FoodForm.jsx'

/**
 * Create or edit a food definition.
 *
 * Editing macros here **rewrites history on purpose**: food_logs store a
 * relation plus an amount, and kcal is computed at render time, so correcting a
 * mis-entered food fixes every day it appeared on. That is the intended
 * behaviour for a bad entry. A product that was genuinely *reformulated* should
 * become a new food instead, so the old days keep the numbers that were true
 * at the time.
 */
export default function FoodEditModal({ food, onSaved, onClose }) {
  const isNew = !food
  const [form, setForm] = useState(() => formFromFood(food))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the food a name.'); return }

    setSaving(true)
    setError(null)
    try {
      const data = foodFromForm(form)
      if (isNew) await createFood({ ...data, source: 'manual', barcode: '' })
      else await updateFood(food.id, data)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    setError(null)
    try {
      // Deleting a food that history points at would leave those logs as
      // "Unknown food" with no macros, quietly changing past totals — so say
      // how many before asking.
      const used = await countLogsForFood(food.id)
      const warning = used > 0
        ? `${food.name} is used by ${used} logged ${used === 1 ? 'entry' : 'entries'}. ` +
          'Deleting it will leave those entries with no food and no calories. Continue?'
        : `Delete ${food.name}?`
      if (!confirm(warning)) return

      setSaving(true)
      await deleteFood(food.id)
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
            {isNew ? 'New food' : 'Edit food'}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <FoodForm form={form} onChange={setForm} autoFocus={isNew} showExtras />

          {!isNew && food.barcode && (
            <div className="food-hint">Barcode {food.barcode} · source {food.source || 'manual'}</div>
          )}
          {!isNew && (
            <div className="food-hint">
              Fixing these numbers also corrects every day this food was logged on.
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            {!isNew && (
              <button type="button" className="btn btn-ghost btn-danger" onClick={handleDelete} disabled={saving}>
                Delete
              </button>
            )}
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
