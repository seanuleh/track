// kcal → kJ at the same 4.184 factor off.js uses the other way round.
const KJ_PER_KCAL = 4.184

/**
 * The per-100g macro summary shown under a food row: protein/carbs/fat plus
 * kJ, so the kcal figure isn't the only number on screen. Missing macros are
 * `null` (unknown), not 0 — shown as "—" rather than a false zero.
 */
const FIELDS = [
  { key: 'protein', label: 'Pro' },
  { key: 'carbs', label: 'Car' },
  { key: 'fat', label: 'Fat' },
]

export default function MacroLine({ food }) {
  const fmt = v => (v == null ? '—' : `${Math.round(v)}g`)
  return (
    <div className="log-macros">
      {FIELDS.map(({ key, label }) => (
        <div className="log-macro-col" key={key}>
          <span className="log-macro-label">{label}</span>
          <span className="log-macro-value">{fmt(food[key])}</span>
        </div>
      ))}
      {food.kcal != null && (
        <div className="log-macro-col log-kj-col">
          <span className="log-macro-label">kJ</span>
          <span className="log-macro-value">{Math.round(food.kcal * KJ_PER_KCAL)}</span>
        </div>
      )}
    </div>
  )
}
