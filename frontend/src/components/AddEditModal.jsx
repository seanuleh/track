import { useState } from 'react'
import { createEntry, updateEntry } from '../api.js'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MEDICATIONS = ['Mounjaro', 'WeGovy']

export default function AddEditModal({ entry, lastWeight, lastMedication, lastDose, onSave, onClose }) {
  const initMed  = entry ? (entry.medication || '') : (lastMedication || '')
  const initDose = entry ? (entry.dose_mg != null ? String(entry.dose_mg) : '') : (lastDose != null ? String(lastDose) : '')

  const [weight, setWeight]         = useState(entry ? String(entry.weight) : '')
  const [date, setDate]             = useState(entry ? entry.date : today())
  const [notes, setNotes]           = useState(entry ? entry.notes : '')
  const [medication, setMedication] = useState(initMed)
  const [dose, setDose]             = useState(initDose)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    const w = parseFloat(weight)
    if (isNaN(w) || w <= 0) { setError('Enter a valid weight.'); return }
    if (medication && (!dose || isNaN(parseFloat(dose)) || parseFloat(dose) <= 0)) {
      setError('Enter a valid dose for the selected medication.'); return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        date, weight: w, notes,
        medication: medication || '',
        dose_mg: medication && dose ? parseFloat(dose) : null,
      }
      if (entry) {
        await updateEntry(entry.id, payload)
      } else {
        await createEntry(payload)
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
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{entry ? 'Edit entry' : 'Add entry'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row-2">
            <div className="form-group form-group--compact">
              <label className="form-label">Weight (kg)</label>
              <input
                className="form-input form-input--compact"
                type="number"
                step="0.1"
                min="0"
                placeholder={lastWeight || '0.0'}
                value={weight}
                onChange={e => setWeight(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="form-group form-group--compact">
              <label className="form-label">Date</label>
              <input
                className="form-input form-input--compact"
                type="date"
                value={date}
                max={today()}
                onChange={e => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row-2">
            <div className="form-group form-group--compact">
              <label className="form-label">Medication</label>
              <select
                className="form-input form-input--compact form-select"
                value={medication}
                onChange={e => { setMedication(e.target.value); if (!e.target.value) setDose('') }}
              >
                <option value="">— none —</option>
                {MEDICATIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group form-group--compact">
              <label className="form-label">Dose (mg)</label>
              <input
                className="form-input form-input--compact"
                type="number"
                step="0.25"
                min="0"
                placeholder="5"
                value={dose}
                onChange={e => setDose(e.target.value)}
                disabled={!medication}
                required={!!medication}
              />
            </div>
          </div>

          <div className="form-group form-group--compact">
            <label className="form-label">Notes (optional)</label>
            <input
              className="form-input form-input--compact"
              type="text"
              placeholder="e.g. after workout"
              value={notes}
              onChange={e => setNotes(e.target.value)}
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
