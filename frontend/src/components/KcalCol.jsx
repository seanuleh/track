/** The "Kcal" labelled figure beside MacroLine. `suffix` states the basis — "/100g" for a food definition, "/serving" for a recipe. */
export default function KcalCol({ kcal, suffix = '/100g' }) {
  return (
    <div className="log-kcal-col">
      <span className="log-macro-label">Kcal</span>
      <div className="log-kcal">
        {kcal != null ? Math.round(kcal) : '—'}
        <span className="kcal-suffix">{suffix}</span>
      </div>
    </div>
  )
}
