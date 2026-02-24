import { useState } from 'react'
import { createEntry, updateEntry } from '../api.js'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function AddEditModal({ entry, onSave, onClose }) {
  const [weight, setWeight] = useState(entry ? String(entry.weight) : '')
  const [date, setDate] = useState(entry ? entry.date : today())
  const [notes, setNotes] = useState(entry ? entry.notes : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const w = parseFloat(weight)
    if (isNaN(w) || w <= 0) {
      setError('Enter a valid weight.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (entry) {
        await updateEntry(entry.id, { date, weight: w, notes })
      } else {
        await createEntry({ date, weight: w, notes })
      }
      onSave()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{entry ? 'Edit entry' : 'Add entry'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Weight (kg)</label>
            <input
              className="form-input"
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 82.5"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              className="form-input"
              type="date"
              value={date}
              max={today()}
              onChange={e => setDate(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. after workout"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions">
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
