import { useState, useEffect } from 'react'
import { searchCatalog, ensureFoodFromCatalog } from '../food/api.js'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import { useEscapeClose } from '../modalKeys.js'

/**
 * Search the local Open Food Facts mirror and promote a hit into `foods`.
 *
 * Promotion happens on tap, not on save-in-the-edit-form: the manager flow is
 * "find it, then correct/enrich it", and the edit form needs a real `foods`
 * row to update rather than a bare catalog row.
 */
export default function CatalogSearchModal({ onPicked, onClose }) {
  useEscapeClose(onClose)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const rows = await searchCatalog(query)
        if (!cancelled) setResults(rows)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  async function pick(item) {
    setError(null)
    try {
      const food = await ensureFoodFromCatalog(item)
      onPicked(food)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">Search Open Food Facts</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="food-search">
          <input
            className="form-input"
            placeholder="Search by name or brand…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {error && <div className="form-error">{error}</div>}
        {loading && <div className="loading">Searching…</div>}

        <div className="log-list">
          {results.map(item => (
            <div key={item.id} className="log-card" onClick={() => pick(item)}>
              <div className="log-main">
                <div className="log-name">{item.name}</div>
                <div className="log-meta">{item.brand ? `${item.brand} · ` : ''}Open Food Facts</div>
              </div>
              <div className="log-stats">
                <MacroLine food={item} />
                <KcalCol kcal={item.kcal} />
              </div>
            </div>
          ))}
        </div>

        {!loading && query.trim() && results.length === 0 && (
          <div className="empty">No matches in the catalog.</div>
        )}
      </div>
    </div>
  )
}
