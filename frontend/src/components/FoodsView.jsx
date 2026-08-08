import { useState, useEffect, useCallback, useRef } from 'react'
import { listFoods, setFavourite, resolveBarcode } from '../food/api.js'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import FoodEditModal from './FoodEditModal.jsx'
import CatalogSearchModal from './CatalogSearchModal.jsx'
import Scanner from './Scanner.jsx'
import FAB from './FAB.jsx'
import RecipesView from './RecipesView.jsx'

/**
 * The Foods tab — a library, not a diary.
 *
 * Date-less by design: this is where food definitions are browsed, curated and
 * corrected, and it deliberately carries no logging affordance. The diary owns
 * logging. Cramming "add to today" in here would fight both surfaces.
 */
export default function FoodsView() {
  const [tab, setTab] = useState('foods') // 'foods' | 'recipes'
  const [query, setQuery] = useState('')
  const [foods, setFoods] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // { food, barcode? } | { food: null } for new
  const [scanning, setScanning] = useState(false)
  const [searchingCatalog, setSearchingCatalog] = useState(false)
  const [status, setStatus] = useState(null)

  // Debounced so typing doesn't fire a request per keystroke.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async (targetPage, replace) => {
    try {
      const res = await listFoods({ query: debounced, page: targetPage })
      setFoods(prev => (replace ? res.items : [...prev, ...res.items]))
      setTotalPages(res.totalPages)
      setPage(res.page)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [debounced])

  // A new search always restarts at page 1.
  useEffect(() => { setLoading(true); load(1, true) }, [load])

  // Infinite scroll, matching the weight history list.
  const sentinelRef = useRef(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || page >= totalPages) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) load(page + 1, false)
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [page, totalPages, load])

  async function toggleFav(e, food) {
    // The row itself opens the editor; the star must not.
    e.stopPropagation()
    const next = !food.favourite
    // Optimistic: a star that lags behind the tap feels broken.
    setFoods(prev => prev.map(f => (f.id === food.id ? { ...f, favourite: next } : f)))
    try {
      await setFavourite(food.id, next)
    } catch (err) {
      setFoods(prev => prev.map(f => (f.id === food.id ? { ...f, favourite: !next } : f)))
      setError(err.message)
    }
  }

  async function handleDetected(barcode) {
    setScanning(false)
    setStatus('Looking up…')
    try {
      const { food } = await resolveBarcode(barcode)
      setStatus(null)
      // Always land in the edit form — hit or miss — so a scan from the
      // manager is a review-and-fix step, never a silent write.
      setEditing({ food, barcode: food ? undefined : barcode })
    } catch (err) {
      setStatus(null)
      setError(err.message)
    }
  }

  return (
    <>
      <div className="food-tabs food-tabs--top">
        <button
          className={`food-tab${tab === 'foods' ? ' active' : ''}`}
          onClick={() => setTab('foods')}
        >Foods</button>
        <button
          className={`food-tab${tab === 'recipes' ? ' active' : ''}`}
          onClick={() => setTab('recipes')}
        >Recipes</button>
      </div>

      {tab === 'recipes' ? (
        <RecipesView />
      ) : (
        <>
          <div className="food-search">
            <input
              className="form-input"
              placeholder="Search by name, brand or barcode…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          {status && <div className="food-status">{status}</div>}
          {error && <div className="error">{error}</div>}
          {loading && <div className="loading">Loading…</div>}

          <div className="log-list">
            {foods.map(food => (
              <div key={food.id} className="log-card" onClick={() => setEditing({ food })}>
                <button
                  className={`fav-star${food.favourite ? ' active' : ''}`}
                  onClick={e => toggleFav(e, food)}
                  aria-label={food.favourite ? 'Remove favourite' : 'Mark favourite'}
                >
                  {food.favourite ? '★' : '☆'}
                </button>
                <div className="log-main">
                  <div className="log-name">{food.name}</div>
                  <div className="log-meta">
                    {food.brand ? `${food.brand} · ` : ''}
                    {food.unit_label
                      ? `per ${food.unit_label}${food.unit_g ? ` (${food.unit_g} g)` : ''} · `
                      : ''}
                    {food.source || 'manual'}
                  </div>
                </div>
                <div className="log-stats">
                  <MacroLine food={food} />
                  <KcalCol kcal={food.kcal} />
                </div>
              </div>
            ))}
          </div>

          {!loading && foods.length === 0 && (
            <div className="empty">
              {query ? 'No foods match that.' : 'No foods yet — scan something, or add one below.'}
            </div>
          )}

          <div ref={sentinelRef} />

          <FAB
            actions={[
              { label: 'Scan barcode', onClick: () => setScanning(true) },
              { label: 'Search catalog', onClick: () => setSearchingCatalog(true) },
              { label: 'Add manually', onClick: () => setEditing({ food: null }) },
            ]}
          />

          {scanning && (
            <Scanner onDetected={handleDetected} onClose={() => setScanning(false)} />
          )}

          {searchingCatalog && (
            <CatalogSearchModal
              onPicked={food => { setSearchingCatalog(false); setEditing({ food }) }}
              onClose={() => setSearchingCatalog(false)}
            />
          )}

          {editing && (
            <FoodEditModal
              food={editing.food}
              barcode={editing.barcode}
              onSaved={() => { setEditing(null); setLoading(true); load(1, true) }}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}
    </>
  )
}
