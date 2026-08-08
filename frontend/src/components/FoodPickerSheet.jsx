import { useState, useEffect } from 'react'
import {
  searchFoods, searchCatalog, getRecentFoods, getFavouriteFoods, resolveBarcode,
  getRecipes, getFood, gramsFor, macrosFor,
} from '../food/api.js'
import Scanner from './Scanner.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'
import RecipeLogModal from './RecipeLogModal.jsx'
import { useEscapeClose } from '../modalKeys.js'

// Per-serving kcal for a recipe — same math as RecipesView, duplicated rather
// than imported because it's a private helper there, not part of the API surface.
async function recipeKcal(recipe, foodCache) {
  const items = Array.isArray(recipe.items) ? recipe.items : []
  const servings = Number(recipe.servings) || 1
  await Promise.all(items.map(async it => {
    if (foodCache.has(it.food)) return
    foodCache.set(it.food, await getFood(it.food).catch(() => null))
  }))
  const kcal = items.reduce((sum, it) => {
    const food = foodCache.get(it.food)
    return sum + macrosFor(food, gramsFor(it, food)).kcal
  }, 0)
  return kcal / servings
}

/**
 * The single entry point for "add something" — replaces the old top-of-day
 * Scan/Add-manually/Search trio. Opened from the diary's FAB; meal isn't
 * decided here (that's `FoodEntryModal`'s job, defaulting from the clock) —
 * dragging a logged entry between meal sections is the other way to fix it
 * up afterwards.
 *
 * Before you type: recents and favourites, so re-logging something you eat
 * constantly is zero typing. After you type: your own foods, then the local
 * Open Food Facts mirror — same ranking as the old diary search.
 */
export default function FoodPickerSheet({ meal, date, onClose, onLogged }) {
  useEscapeClose(onClose)
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState([])
  const [catalog, setCatalog] = useState([])
  const [recents, setRecents] = useState([])
  const [favourites, setFavourites] = useState([])
  const [recipes, setRecipes] = useState([])
  const [recipeKcals, setRecipeKcals] = useState({}) // recipe.id -> per-serving kcal
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState(null)
  const [entry, setEntry] = useState(null) // { food, catalog, barcode } for FoodEntryModal
  const [loggingRecipe, setLoggingRecipe] = useState(null) // recipe opened for edit-before-log

  useEffect(() => {
    getRecentFoods(8).then(setRecents).catch(() => {})
    getFavouriteFoods(20).then(setFavourites).catch(() => {})
    getRecipes().then(async list => {
      setRecipes(list)
      const foodCache = new Map()
      const entries = await Promise.all(list.map(async r => [r.id, await recipeKcal(r, foodCache)]))
      setRecipeKcals(Object.fromEntries(entries))
    }).catch(() => {})
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
      } catch (err) {
        setStatus('Search failed — ' + err.message)
      }
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

  if (loggingRecipe) {
    return (
      <RecipeLogModal
        recipe={loggingRecipe}
        date={date}
        meal={meal}
        onLogged={onLogged}
        onClose={() => setLoggingRecipe(null)}
      />
    )
  }

  // Favourites not already surfaced by recents, so the same food isn't listed twice.
  const recentIds = new Set(recents.map(f => f.id))
  const favouritesOnly = favourites.filter(f => !recentIds.has(f.id))
  const showBrowse = !query.trim() && (recents.length > 0 || favouritesOnly.length > 0 || recipes.length > 0)

  // Client-filtered — the recipe library is small (dozens, not thousands),
  // so a server round-trip per keystroke isn't worth it.
  const q = query.trim().toLowerCase()
  const matchedRecipes = q ? recipes.filter(r => (r.name || '').toLowerCase().includes(q)) : recipes

  function recipeButton(r) {
    const kcal = recipeKcals[r.id]
    return (
      <button
        key={r.id}
        type="button"
        className="search-result"
        onClick={() => setLoggingRecipe(r)}
      >
        <span className="sr-name">{r.name}</span>
        <span className="sr-meta">
          {kcal != null ? `${Math.round(kcal)} kcal/serving` : '—'}
        </span>
      </button>
    )
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header modal-header--compact">
          <div className="modal-title modal-title--compact">{meal ? `Add to ${meal}` : 'Add food'}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="food-search food-search--sheet">
          <input
            className="form-input"
            placeholder="Search foods…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="food-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setScanning(true)}>
            Scan barcode
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setEntry({ food: null, barcode: '' })}>
            Create custom food
          </button>
        </div>

        {status && <div className="food-status">{status}</div>}

        {query.trim() ? (
          (mine.length > 0 || catalog.length > 0 || matchedRecipes.length > 0) && (
            <div className="search-results search-results--sheet">
              {matchedRecipes.length > 0 && <div className="sr-divider">Recipes</div>}
              {matchedRecipes.map(recipeButton)}
              {mine.length > 0 && matchedRecipes.length > 0 && <div className="sr-divider">Foods</div>}
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
            {recipes.length > 0 && <div className="sr-divider">Recipes</div>}
            {recipes.map(recipeButton)}
          </div>
        )}
      </div>

      {scanning && (
        <Scanner onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  )
}
