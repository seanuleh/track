// kcal → kJ at the same 4.184 factor off.js uses the other way round.
const KJ_PER_KCAL = 4.184

/**
 * The macro summary shown under a food row: protein/carbs/fat plus kJ, so the
 * kcal figure isn't the only number on screen. Missing macros are `null`
 * (unknown), not 0 — shown as "—" rather than a false zero.
 *
 * `grams` scales the per-100g record to an actual amount (a portion). Left
 * unset it reports per 100 g, which is the record's own basis.
 */
const FIELDS = [
  { key: 'protein', label: 'Pro' },
  { key: 'carbs', label: 'Car' },
  { key: 'fat', label: 'Fat' },
]

export default function MacroLine({ food, grams = 100 }) {
  // null grams means a unit-based amount on a food with no gram equivalent —
  // the macros are genuinely unknown, so don't invent them.
  const factor = grams == null ? null : grams / 100
  const scale = v => (v == null || factor == null ? null : v * factor)
  const fmt = v => (v == null ? '—' : `${Math.round(v)}g`)
  const kj = scale(food.kcal)
  return (
    <div className="log-macros">
      {FIELDS.map(({ key, label }) => (
        <div className="log-macro-col" key={key}>
          <span className="log-macro-label">{label}</span>
          <span className="log-macro-value">{fmt(scale(food[key]))}</span>
        </div>
      ))}
      {kj != null && (
        <div className="log-macro-col log-kj-col">
          <span className="log-macro-label">kJ</span>
          <span className="log-macro-value">{Math.round(kj * KJ_PER_KCAL)}</span>
        </div>
      )}
    </div>
  )
}
