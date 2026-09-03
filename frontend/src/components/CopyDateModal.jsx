import { useState } from 'react'
import { copyLogs } from '../food/api.js'
import { today, shiftDate, formatDisplayDate } from '../dates.js'
import { useEscapeClose, onFormKeyDown, overlayDismiss } from '../modalKeys.js'

// Today plus the next 6 days. Today is in the list deliberately: the common
// case is standing on a past day and pulling one thing forward onto today.
// The day being copied *from* is dropped, since copying a row onto its own
// day just duplicates it.
function targetDays(sourceDate) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(today(), i))
  return days.filter(d => d !== sourceDate)
}

/**
 * Copies a set of already-fetched food_logs rows (a single item, a meal, or a
 * whole day) onto one or more of the next 7 days — new rows, not moved ones,
 * so the source day is untouched. `label` distinguishes "Copy meal" from
 * "Copy day" in the title. Checkbox list rather than a single date picker, so
 * a whole week can be seeded in one submit instead of one modal open per day.
 */
export default function CopyDateModal({ logs, label, sourceDate, onCopied, onClose }) {
  useEscapeClose(onClose)
  const days = targetDays(sourceDate)
  const [selected, setSelected] = useState(() => new Set(days.slice(0, 1)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function toggle(date) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (selected.size === 0) { setError('Pick at least one day.'); return }

    setSaving(true)
    setError(null)
    try {
      await Promise.all([...selected].map(date => copyLogs(logs, date)))
      onCopied()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" {...overlayDismiss(onClose)}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{label}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
          <div className="food-hint">
            {logs.length} entr{logs.length === 1 ? 'y' : 'ies'} will be copied to each day
            selected — the original day is left as-is.
          </div>

          <div className="form-group form-group--compact">
            <div className="form-label-row">
              <label className="form-label">Copy to</label>
              <div className="form-label-actions">
                <button type="button" className="link-btn" onClick={() => setSelected(new Set(days))}>
                  Select all
                </button>
                <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
                  Clear all
                </button>
              </div>
            </div>
            <div className="copy-date-list">
              {days.map(date => (
                <label key={date} className="copy-date-row">
                  <input
                    type="checkbox"
                    checked={selected.has(date)}
                    onChange={() => toggle(date)}
                  />
                  <span>{formatDisplayDate(date)}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || logs.length === 0 || selected.size === 0}>
              {saving ? 'Copying…' : `Copy to ${selected.size || ''} day${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
