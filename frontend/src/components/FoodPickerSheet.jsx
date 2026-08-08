import { useState, useEffect } from 'react'
import { searchFoods, searchCatalog, getRecentFoods, getFavouriteFoods, resolveBarcode } from '../food/api.js'
import Scanner from './Scanner.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'

/**
 * The single entry point for "add something to this meal" — replaces the old
 * top-of-day Scan/Add-manually/Search trio, none of which knew which meal you
 * meant. Opened from a `+` on a meal header, so the meal is already decided;
 * everything here ends at `FoodEntryModal` with that meal locked in.
 *
 * Before you type: recents and favourites, so re-logging something you eat
 * constantly is zero typing. After you type: your own foods, then the local
 * Open Food Facts mirror — same ranking as the old diary search.
 */
export default function FoodPickerSheet({ meal, date, onClose, onLogged }) {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState([])
  const [catalog, setCatalog] = useState([])
  const [recents, setRecents] = useState([])
  const [favourites, setFavourites] = useState([])
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState(null)
  const [entry, setEntry] = useState(null) // { food, catalog, barcode } for FoodEntryModal

  useEffect(() => {
    getRecentFoods(8).then(setRecents).catch(() => {})
    getFavouriteFoods(20).then(setFavourites).catch(() => {})
  }, [])

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
      } catch { /* a failed search shouldn't block the sheet */ }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query])

  async function handleDetected(barcode) {
    setScanning(false)
    setStatus('Looking up…')
    try {
      const { food, origin } = await resolveBarcode(barcode)
      setStatus(null)
      setEntry({ food, barcode })
      if (origin === 'catalog') setStatus('Found in the local Open Food Facts catalog')
      else if (origin === 'off') setStatus('Added from Open Food Facts')
    } catch (err) {
      setStatus(null)
      setStatus('Lookup failed — ' + err.message)
    }
  }

  if (entry) {
    return (
      <FoodEntryModal
        food={entry.food}
        catalog={entry.catalog}
        barcode={entry.barcode}
        date={date}
        meal={meal}
        onSaved={onLogged}
        onClose={() => setEntry(null)}
      />
    )
  }

  // Favourites not already surfaced by recents, so the same food isn't listed twice.
  const recentIds = new Set(recents.map(f => f.id))
  const favouritesOnly = favourites.filter(f => !recentIds.has(f.id))
  const showBrowse = !query.trim() && (recents.length > 0 || favouritesOnly.length > 0)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">Add to {meal}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="food-search food-search--sheet">
          <input
            className="form-input"
            placeholder="Search foods…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="food-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setScanning(true)}>
            Scan barcode
          </button>
        </div>

        {status && <div className="food-status">{status}</div>}

        {query.trim() ? (
          (mine.length > 0 || catalog.length > 0) && (
            <div className="search-results search-results--sheet">
              {mine.map(f => (
                <button key={f.id} type="button" className="search-result" onClick={() => setEntry({ food: f })}>
                  <span className="sr-name">{f.name}</span>
                  <span className="sr-meta">
                    {f.brand ? `${f.brand} · ` : ''}
                    {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
                  </span>
                </button>
              ))}
              {catalog.length > 0 && <div className="sr-divider">Open Food Facts</div>}
              {catalog.map(c => (
                <button key={c.id} type="button" className="search-result" onClick={() => setEntry({ catalog: c })}>
                  <span className="sr-name">{c.name}</span>
                  <span className="sr-meta">
                    {c.brand ? `${c.brand} · ` : ''}
                    {Math.round(c.kcal)} kcal/100g
                  </span>
                </button>
              ))}
            </div>
          )
        ) : showBrowse && (
          <div className="search-results search-results--sheet">
            {recents.length > 0 && <div className="sr-divider">Recent</div>}
            {recents.map(f => (
              <button key={f.id} type="button" className="search-result" onClick={() => setEntry({ food: f })}>
                <span className="sr-name">{f.name}</span>
                <span className="sr-meta">
                  {f.brand ? `${f.brand} · ` : ''}
                  {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
                </span>
              </button>
            ))}
            {favouritesOnly.length > 0 && <div className="sr-divider">Favourites</div>}
            {favouritesOnly.map(f => (
              <button key={f.id} type="button" className="search-result" onClick={() => setEntry({ food: f })}>
                <span className="sr-name">{f.name}</span>
                <span className="sr-meta">
                  {f.brand ? `${f.brand} · ` : ''}
                  {f.kcal != null ? `${Math.round(f.kcal)} kcal/100g` : '—'}
                </span>
              </button>
            ))}
          </div>
        )}

        <button type="button" className="btn btn-ghost btn-block" onClick={() => setEntry({ food: null, barcode: '' })}>
          Create custom food
        </button>
      </div>

      {scanning && (
        <Scanner onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  )
}
