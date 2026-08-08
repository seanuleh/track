import { useState } from 'react'
import { setTarget } from '../food/api.js'
import { today } from '../dates.js'

/**
 * Sets a new daily target, effective from today. Never edits an existing
 * row — see getTargetForDate/setTarget in food/api.js: a new dated row means
 * raising the target next month can't rescore days already logged against
 * the old one.
 */
export default function TargetsModal({ current, onSaved, onClose }) {
  const [kcal, setKcal] = useState(current?.kcal != null ? String(current.kcal) : '')
  const [protein, setProtein] = useState(current?.protein != null ? String(current.protein) : '')
  const [fat, setFat] = useState(current?.fat != null ? String(current.fat) : '')
  const [carbs, setCarbs] = useState(current?.carbs != null ? String(current.carbs) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const k = parseFloat(kcal)
    if (isNaN(k) || k <= 0) { setError('Enter a valid kcal target.'); return }

    setSaving(true)
    setError(null)
    try {
      await setTarget({ kcal: k, protein, fat, carbs, date: today() })
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
          <div className="modal-title modal-title--compact">Daily target</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="food-hint">
            Applies from today onward — days already logged keep whatever target was in
            effect then.
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Kcal</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={kcal}
              onChange={e => setKcal(e.target.value)}
              required
            />
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Protein (g) — optional</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={protein}
              onChange={e => setProtein(e.target.value)}
            />
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Fat (g) — optional</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={fat}
              onChange={e => setFat(e.target.value)}
            />
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Carbs (g) — optional</label>
            <input
              className="form-input form-input--compact"
              type="number" inputMode="decimal" step="any" min="0"
              value={carbs}
              onChange={e => setCarbs(e.target.value)}
            />
          </div>

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
