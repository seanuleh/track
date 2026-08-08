import { useState } from 'react'
import { copyLogs } from '../food/api.js'
import { today, shiftDate } from '../dates.js'

/**
 * Copies a set of already-fetched food_logs rows (a meal, or a whole day)
 * onto a different date — new rows, not moved ones, so the source day is
 * untouched. `label` distinguishes "Copy meal" from "Copy day" in the title.
 */
export default function CopyDateModal({ logs, label, onCopied, onClose }) {
  const [targetDate, setTargetDate] = useState(shiftDate(today(), 1))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await copyLogs(logs, targetDate)
      onCopied()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{label}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="food-hint">
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} will be copied — the
            original day is left as-is.
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Copy to</label>
            <input
              className="form-input form-input--compact"
              type="date"
              value={targetDate}
              onChange={e => e.target.value && setTargetDate(e.target.value)}
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || logs.length === 0}>
              {saving ? 'Copying…' : 'Copy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
