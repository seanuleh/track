import { useState } from 'react'
import { updateLogGroupMeal, scaleLogGroup, deleteLogGroup } from '../food/api.js'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']

/**
 * Editing a logged recipe serving. Individual ingredient amounts belong to
 * the recipe itself (Recipes tab) — what applies here, to the group as a
 * whole, is which meal it's under, how many servings were actually eaten,
 * and removing it.
 *
 * "Servings eaten" starts at 1 (logRecipe always logs exactly one serving)
 * and is a scale factor applied to every ingredient row on save — there's no
 * stored base amount to recompute from (see scaleLogGroup), so the field
 * resets to 1 after each save rather than tracking a running total.
 */
export default function RecipeGroupModal({ entry, onSaved, onClose }) {
  const [meal, setMeal] = useState(entry.items[0]?.meal || 'snack')
  const [servings, setServings] = useState('1')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const factor = parseFloat(servings)
    if (isNaN(factor) || factor <= 0) { setError('Enter a valid servings amount.'); return }

    setSaving(true)
    setError(null)
    try {
      if (factor !== 1) await scaleLogGroup(entry.recipe_group, factor)
      await updateLogGroupMeal(entry.recipe_group, meal)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${entry.recipe_name}?`)) return
    setDeleting(true)
    setError(null)
    try {
      await deleteLogGroup(entry.recipe_group)
      onSaved()
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{entry.recipe_name || 'Recipe'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="food-hint">
            {entry.items.length} ingredient{entry.items.length === 1 ? '' : 's'} — edit individual amounts from the Recipes tab.
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Servings eaten</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={servings}
              onChange={e => setServings(e.target.value)}
            />
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

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting || saving}>
              {deleting ? 'Removing…' : 'Delete'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || deleting}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
