import { useState, useEffect, useCallback } from 'react'
import { getRecipes, deleteRecipe, getFood, gramsFor, macrosFor } from '../food/api.js'
import RecipeBuilderModal from './RecipeBuilderModal.jsx'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import FAB from './FAB.jsx'

// Sum a recipe's items into per-serving macros. Foods aren't expanded on the
// recipe record, so each referenced food is fetched once and cached by id —
// recipes commonly share ingredients (milk, protein powder), so this avoids
// re-fetching the same food for every recipe that uses it.
async function totalsFor(recipe, foodCache) {
  const items = Array.isArray(recipe.items) ? recipe.items : []
  const servings = Number(recipe.servings) || 1

  await Promise.all(items.map(async it => {
    if (foodCache.has(it.food)) return
    foodCache.set(it.food, await getFood(it.food).catch(() => null))
  }))

  const totals = items.reduce((acc, it) => {
    const food = foodCache.get(it.food)
    const grams = gramsFor(it, food)
    const m = macrosFor(food, grams)
    acc.kcal += m.kcal
    acc.protein += m.protein
    acc.fat += m.fat
    acc.carbs += m.carbs
    return acc
  }, { kcal: 0, protein: 0, fat: 0, carbs: 0 })

  return {
    kcal: totals.kcal / servings,
    protein: totals.protein / servings,
    fat: totals.fat / servings,
    carbs: totals.carbs / servings,
  }
}

/** The recipe library — list, create, edit, delete. No logging here; that's the diary's job. */
export default function RecipesView() {
  const [recipes, setRecipes] = useState([])
  const [totals, setTotals] = useState({}) // recipe.id -> per-serving macros
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // { recipe } | { recipe: null } for new

  const load = useCallback(async () => {
    try {
      const rows = await getRecipes()
      setRecipes(rows)
      setError(null)

      const foodCache = new Map()
      const entries = await Promise.all(rows.map(async r => [r.id, await totalsFor(r, foodCache)]))
      setTotals(Object.fromEntries(entries))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleDelete(e, recipe) {
    e.stopPropagation()
    if (!confirm(`Delete ${recipe.name}?`)) return
    try {
      await deleteRecipe(recipe.id)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <div className="loading">Loading…</div>

  return (
    <>
      {error && <div className="error">{error}</div>}

      <div className="log-list">
        {recipes.map(recipe => (
          <div key={recipe.id} className="log-card" onClick={() => setEditing({ recipe })}>
            <div className="log-main">
              <div className="log-name">{recipe.name}</div>
              <div className="log-meta">
                {(recipe.items || []).length} ingredient{(recipe.items || []).length === 1 ? '' : 's'}
                {' · '}{recipe.servings || 1} serving{(recipe.servings || 1) === 1 ? '' : 's'}
              </div>
            </div>
            {totals[recipe.id] && (
              <div className="log-stats">
                <MacroLine food={totals[recipe.id]} />
                <KcalCol kcal={totals[recipe.id].kcal} suffix="/serving" />
              </div>
            )}
            <button className="icon-btn danger" onClick={e => handleDelete(e, recipe)}>✕</button>
          </div>
        ))}
      </div>

      {recipes.length === 0 && <div className="empty">No recipes yet — build one below.</div>}

      <FAB onClick={() => setEditing({ recipe: null })} />

      {editing && (
        <RecipeBuilderModal
          recipe={editing.recipe}
          onSaved={() => { setEditing(null); load() }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
