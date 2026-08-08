import { useState, useEffect, useCallback, useRef } from 'react'
import {
  listFoods, setFavourite, resolveBarcode, portionOf, hasOwnPortion, gramsFor, formatAmount,
  getRecipes, setRecipeFavourite, recipeTotals,
} from '../food/api.js'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import FoodEditModal from './FoodEditModal.jsx'
import FoodEntryModal from './FoodEntryModal.jsx'
import CatalogSearchModal from './CatalogSearchModal.jsx'
import Scanner from './Scanner.jsx'
import FAB from './FAB.jsx'
import RecipesView from './RecipesView.jsx'
import RecipeBuilderModal from './RecipeBuilderModal.jsx'
import RecipeLogModal from './RecipeLogModal.jsx'

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
  const [expandedId, setExpandedId] = useState(null) // food.id showing Edit/Add/Cancel instead of macros
  const [expandedRecipeId, setExpandedRecipeId] = useState(null) // recipe.id showing Edit/Vary/Cancel
  const [quickAdd, setQuickAdd] = useState(null) // { food } for FoodEntryModal, opened from Add
  const [recipes, setRecipes] = useState([])
  const [recipeMacros, setRecipeMacros] = useState({}) // recipe.id -> per-serving macros
  const [editingRecipe, setEditingRecipe] = useState(null) // { recipe } | { recipe: null }
  const [loggingRecipe, setLoggingRecipe] = useState(null) // { recipe } for RecipeLogModal, opened from Add

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

  // Recipes appear in the Foods list too, so they can be favourited and found
  // the same way — the library is small, so a full fetch each search is fine.
  const loadRecipes = useCallback(async () => {
    const rows = await getRecipes()
    setRecipes(rows)
    const foodCache = new Map()
    const entries = await Promise.all(rows.map(async r => [r.id, await recipeTotals(r, foodCache)]))
    setRecipeMacros(Object.fromEntries(entries))
  }, [])

  useEffect(() => { loadRecipes() }, [loadRecipes])

  const matchingRecipes = recipes
    .filter(r => !debounced.trim() || r.name.toLowerCase().includes(debounced.trim().toLowerCase()))
    .sort((a, b) => (b.favourite === a.favourite ? a.name.localeCompare(b.name) : (b.favourite ? 1 : -1)))

  // Favourites of either kind lead the list; recipes break ties within each
  // half only because they're a shorter list checked before the (paginated,
  // server-sorted) foods below — not a hard type ordering.
  const favRecipes = matchingRecipes.filter(r => r.favourite)
  const restRecipes = matchingRecipes.filter(r => !r.favourite)
  const favFoods = foods.filter(f => f.favourite)
  const restFoods = foods.filter(f => !f.favourite)

  async function toggleRecipeFav(e, recipe) {
    e.stopPropagation()
    const next = !recipe.favourite
    setRecipes(prev => prev.map(r => (r.id === recipe.id ? { ...r, favourite: next } : r)))
    try {
      await setRecipeFavourite(recipe.id, next)
    } catch (err) {
      setRecipes(prev => prev.map(r => (r.id === recipe.id ? { ...r, favourite: !next } : r)))
      setError(err.message)
    }
  }

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

  function renderRecipeRow(recipe) {
    return (
      <div
        key={`recipe-${recipe.id}`}
        className="log-card"
        onClick={() => setExpandedRecipeId(id => (id === recipe.id ? null : recipe.id))}
      >
        <button
          className={`fav-star${recipe.favourite ? ' active' : ''}`}
          onClick={e => toggleRecipeFav(e, recipe)}
          aria-label={recipe.favourite ? 'Remove favourite' : 'Mark favourite'}
        >
          {recipe.favourite ? '★' : '☆'}
        </button>
        <div className="log-main">
          <div className="log-name">{recipe.name}</div>
          <div className="log-meta">
            Recipe · {(recipe.items || []).length} ingredient{(recipe.items || []).length === 1 ? '' : 's'}
          </div>
        </div>
        {expandedRecipeId === recipe.id ? (
          <div className="log-quick-actions" onClick={e => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditingRecipe({ recipe }); setExpandedRecipeId(null) }}>
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditingRecipe({ recipe: { name: `${recipe.name} (variation)`, servings: recipe.servings, items: recipe.items } })
                setExpandedRecipeId(null)
              }}
            >
              Vary
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setLoggingRecipe({ recipe }); setExpandedRecipeId(null) }}
            >
              Add
            </button>
            <button
              type="button"
              className="icon-btn log-quick-cancel"
              aria-label="Cancel"
              onClick={() => setExpandedRecipeId(null)}
            >✕</button>
          </div>
        ) : (
          recipeMacros[recipe.id] && (
            <div className="log-stats">
              <MacroLine food={recipeMacros[recipe.id]} />
              <KcalCol kcal={recipeMacros[recipe.id].kcal} suffix="/serving" />
            </div>
          )
        )}
      </div>
    )
  }

  function renderFoodRow(food) {
    // Macros are reported for the portion, not per 100 g — the number
    // that matters is what you'd actually eat.
    const portion = portionOf(food)
    const portionGrams = gramsFor(portion, food)
    return (
      <div
        key={food.id}
        className="log-card"
        onClick={() => setExpandedId(id => (id === food.id ? null : food.id))}
      >
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
            <span className={hasOwnPortion(food) ? '' : 'portion-unset'}>
              {formatAmount(portion, food)}
              {/* The gram equivalent of a unit portion, since that's
                  what the macros beside it are actually computed on. */}
              {portion.unit === 'unit' && portionGrams != null
                ? ` (${Math.round(portionGrams)} g)`
                : ''}
              {hasOwnPortion(food) ? '' : ' (default)'}
            </span>
            {` · ${food.source || 'manual'}`}
          </div>
        </div>
        {expandedId === food.id ? (
          <div className="log-quick-actions" onClick={e => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ food })}>
              Edit
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setQuickAdd({ food })}>
              Add
            </button>
            <button
              type="button"
              className="icon-btn log-quick-cancel"
              aria-label="Cancel"
              onClick={() => setExpandedId(null)}
            >✕</button>
          </div>
        ) : (
          <div className="log-stats">
            <MacroLine food={food} grams={portionGrams} />
            <KcalCol
              kcal={food.kcal == null || portionGrams == null
                ? null
                : food.kcal * portionGrams / 100}
              suffix="/portion"
            />
          </div>
        )}
      </div>
    )
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
            {query && (
              <button type="button" className="food-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>✕</button>
            )}
          </div>

          {status && <div className="food-status">{status}</div>}
          {error && <div className="error">{error}</div>}
          {loading && <div className="loading">Loading…</div>}

          <div className="log-list">
            {favRecipes.map(recipe => renderRecipeRow(recipe))}
            {favFoods.map(food => renderFoodRow(food))}
            {restRecipes.map(recipe => renderRecipeRow(recipe))}
            {restFoods.map(food => renderFoodRow(food))}
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
              onSaved={() => { setEditing(null); setExpandedId(null); setLoading(true); load(1, true) }}
              onClose={() => setEditing(null)}
            />
          )}

          {quickAdd && (
            <FoodEntryModal
              food={quickAdd.food}
              onSaved={() => { setQuickAdd(null); setExpandedId(null); setStatus('Logged.') }}
              onClose={() => setQuickAdd(null)}
            />
          )}

          {editingRecipe && (
            <RecipeBuilderModal
              recipe={editingRecipe.recipe}
              onSaved={() => { setEditingRecipe(null); loadRecipes() }}
              onClose={() => setEditingRecipe(null)}
            />
          )}

          {loggingRecipe && (
            <RecipeLogModal
              recipe={loggingRecipe.recipe}
              onLogged={() => { setLoggingRecipe(null); setStatus('Logged.') }}
              onClose={() => setLoggingRecipe(null)}
            />
          )}
        </>
      )}
    </>
  )
}
