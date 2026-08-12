import { useState, useRef } from 'react'
import { createFood, updateFood, deleteFood, countLogsForFood, extractNutritionFromImage } from '../food/api.js'
import FoodForm, { formFromFood, foodFromForm } from './FoodForm.jsx'
import { useEscapeClose, onFormKeyDown, overlayDismiss } from '../modalKeys.js'
import ConfirmModal from './ConfirmModal.jsx'
import BarcodeRow from './BarcodeRow.jsx'

// Keeps the upload small and the vision model fast — a nutrition panel is
// legible from a phone camera well below full resolution.
const MAX_DIM = 1024

function fileToResizedBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scale
      canvas.height = img.height * scale
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

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
export default function FoodEditModal({ food, barcode, onSaved, onClose }) {
  useEscapeClose(onClose)
  const isNew = !food
  const [form, setForm] = useState(() => formFromFood(food))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  // null until the usage count comes back; then { used } drives the confirm sheet.
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [counting, setCounting] = useState(false)
  const fileInputRef = useRef(null)

  async function handlePhoto(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return

    setScanning(true)
    setError(null)
    try {
      const base64 = await fileToResizedBase64(file)
      const extracted = await extractNutritionFromImage(base64)
      // Only fill fields the model actually read — never stomp a value the
      // user already typed with a blank guess.
      setForm(f => {
        const next = { ...f }
        for (const [key, val] of Object.entries(extracted)) {
          if (val != null) next[key] = String(val)
        }
        return next
      })
    } catch (err) {
      setError('Could not read label: ' + err.message)
    } finally {
      setScanning(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the food a name.'); return }

    setSaving(true)
    setError(null)
    try {
      const data = foodFromForm(form)
      if (isNew) await createFood({ ...data, source: 'manual', barcode: barcode || '' })
      else await updateFood(food.id, data)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // Deleting a food that history points at would leave those logs as "Unknown
  // food" with no macros, quietly changing past totals — so count them first
  // and say how many, before the confirm sheet goes up.
  async function requestDelete() {
    setError(null)
    setCounting(true)
    try {
      setConfirmDelete({ used: await countLogsForFood(food.id) })
    } catch (err) {
      setError(err.message)
    } finally {
      setCounting(false)
    }
  }

  async function handleDelete() {
    setError(null)
    setSaving(true)
    try {
      await deleteFood(food.id)
      onSaved()
    } catch (err) {
      setConfirmDelete(null)
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <>
    <div className="modal-overlay" {...overlayDismiss(onClose)}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">
            {isNew ? 'New food' : 'Edit food'}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} onKeyDown={onFormKeyDown}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhoto}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%', marginBottom: '0.75rem' }}
            onClick={() => fileInputRef.current.click()}
            disabled={scanning}
          >
            {scanning ? 'Reading label…' : 'Scan nutrition panel'}
          </button>

          <FoodForm form={form} onChange={setForm} showExtras />

          {!isNew && (
            <BarcodeRow food={food} suffix={`source ${food.source || 'manual'}`} />
          )}
          {isNew && barcode && (
            <div className="food-hint">Barcode {barcode} isn't on record yet — add it once and it's saved for good.</div>
          )}
          {!isNew && (
            <div className="food-hint">
              Fixing these numbers also corrects every day this food was logged on.
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          <div className="modal-actions modal-actions--compact">
            {!isNew && (
              <button type="button" className="btn btn-danger" onClick={requestDelete} disabled={saving || counting}>
                {counting ? 'Checking…' : 'Delete'}
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

    {confirmDelete && (
      <ConfirmModal
        title={`Delete ${food.name}?`}
        message={confirmDelete.used > 0
          ? `It's used by ${confirmDelete.used} logged ${confirmDelete.used === 1 ? 'entry' : 'entries'}. Deleting it leaves ${confirmDelete.used === 1 ? 'that entry' : 'those entries'} with no food and no calories, changing what those days say you ate.`
          : 'Nothing has been logged against it, so no history changes.'}
        busy={saving}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    )}
    </>
  )
}
