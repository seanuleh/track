import { useState } from 'react'
import { updateFood, findFoodByBarcode } from '../food/api.js'
import Scanner from './Scanner.jsx'

/**
 * The barcode line at the foot of a food modal — a display line until tapped,
 * then a small editor.
 *
 * Deliberately not a button-sized affordance: attaching a barcode is a rare,
 * once-per-food act, so it sits at the same weight as the `.food-hint` line it
 * replaced. Tap the line (or the glyph) to edit; scan or type; ✓ to save.
 *
 * Writes straight to `foods` on save rather than waiting for the parent's Save,
 * because both callers use it beside forms that mean something else — the entry
 * modal's Save writes a *log*, not the food — and a barcode silently riding
 * along with a different record's save is worse than one extra tap.
 */
export default function BarcodeRow({ food, suffix, onChanged }) {
  const [barcode, setBarcode] = useState(food.barcode || '')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(food.barcode || '')
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function open() {
    setValue(barcode)
    setError(null)
    setEditing(true)
  }

  async function save(code) {
    const next = String(code ?? value).trim()
    // Empty is a real choice — clearing a barcode typed in wrong.
    if (next && !/^\d{8,14}$/.test(next)) {
      setError('A barcode is 8–14 digits.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Two foods sharing a barcode makes resolveBarcode's answer arbitrary,
      // so the collision is refused rather than resolved.
      if (next) {
        const clash = await findFoodByBarcode(next)
        if (clash && clash.id !== food.id) {
          setError(`Already on “${clash.name}”.`)
          setSaving(false)
          return
        }
      }
      await updateFood(food.id, { barcode: next })
      setBarcode(next)
      setEditing(false)
      onChanged?.(next)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <>
      <div className="barcode-row">
        <button
          type="button"
          className="barcode-line"
          onClick={editing ? undefined : open}
          aria-label={barcode ? `Edit barcode ${barcode}` : 'Add a barcode'}
          disabled={editing}
        >
          <BarcodeGlyph />
          {!editing && (
            <span className={barcode ? 'barcode-value' : 'barcode-value barcode-value--unset'}>
              {barcode || 'Add barcode'}
              {barcode && suffix ? ` · ${suffix}` : ''}
            </span>
          )}
        </button>

        {editing && (
          <>
            <input
              className="form-input form-input--compact barcode-input"
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="9300658411663"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                // The parent form would otherwise submit — log the food, or
                // save the definition — on Enter in this field.
                if (e.key === 'Enter') { e.preventDefault(); save() }
                if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
              }}
            />
            <button
              type="button"
              className="barcode-btn"
              onClick={() => setScanning(true)}
              disabled={saving}
              aria-label="Scan the barcode"
            >⛶</button>
            <button
              type="button"
              className="barcode-btn barcode-btn--go"
              onClick={() => save()}
              disabled={saving}
              aria-label="Save barcode"
            >✓</button>
          </>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {scanning && (
        <Scanner
          onDetected={code => { setScanning(false); setValue(code); save(code) }}
          onClose={() => setScanning(false)}
        />
      )}
    </>
  )
}

function BarcodeGlyph() {
  return (
    <svg className="barcode-glyph" viewBox="0 0 16 12" aria-hidden="true">
      {[0, 2, 3, 6, 8, 11, 13, 15].map((x, i) => (
        <rect key={x} x={x} y="0" width={i % 3 === 0 ? 1.6 : 0.8} height="12" />
      ))}
    </svg>
  )
}
