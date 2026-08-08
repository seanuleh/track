import { useState, useEffect } from 'react'
import { searchFoods, searchCatalog, ensureFoodFromCatalog } from '../food/api.js'

/**
 * Inline "find a food" search — your own library first, then the local Open
 * Food Facts mirror. Shared by the recipe builder so ingredients aren't
 * limited to foods already logged once.
 *
 * A catalog pick is promoted into `foods` on tap, same as everywhere else
 * that touches the catalog — a recipe ingredient must be a real `foods`
 * relation, not a bare catalog row.
 */
export default function FoodPicker({ onPick }) {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState([])
  const [catalog, setCatalog] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!query.trim()) { setMine([]); setCatalog([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([searchFoods(query), searchCatalog(query)])
        if (cancelled) return
        setMine(a)
        const known = new Set(a.map(f => f.barcode).filter(Boolean))
        setCatalog(b.filter(c => !known.has(c.barcode)))
      } catch { /* a failed search shouldn't block picking */ }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  async function pickCatalog(item) {
    setError(null)
    try {
      onPick(await ensureFoodFromCatalog(item))
      setQuery('')
    } catch (err) {
      setError(err.message)
    }
  }

  function pickMine(food) {
    onPick(food)
    setQuery('')
  }

  return (
    <div className="food-search">
      <input
        className="form-input"
        placeholder="Add an ingredient…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {error && <div className="form-error">{error}</div>}
      {(mine.length > 0 || catalog.length > 0) && (
        <div className="search-results">
          {mine.map(f => (
            <button key={f.id} type="button" className="search-result" onClick={() => pickMine(f)}>
              <span className="sr-name">{f.name}</span>
              <span className="sr-meta">
                {f.brand ? `${f.brand} · ` : ''}
                {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
              </span>
            </button>
          ))}
          {catalog.length > 0 && <div className="sr-divider">Open Food Facts</div>}
          {catalog.map(c => (
            <button key={c.id} type="button" className="search-result" onClick={() => pickCatalog(c)}>
              <span className="sr-name">{c.name}</span>
              <span className="sr-meta">
                {c.brand ? `${c.brand} · ` : ''}
                {Math.round(c.kcal)} kcal/100g
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
