import { useState, useEffect, useCallback } from 'react'
import { getRecipes, deleteRecipe, recipeTotals } from '../food/api.js'
import RecipeBuilderModal from './RecipeBuilderModal.jsx'
import RecipeLogModal from './RecipeLogModal.jsx'
import MacroLine from './MacroLine.jsx'
import KcalCol from './KcalCol.jsx'
import FAB from './FAB.jsx'

/** The recipe library — list, create, edit, delete. No logging here; that's the diary's job. */
export default function RecipesView() {
  const [recipes, setRecipes] = useState([])
  const [totals, setTotals] = useState({}) // recipe.id -> per-serving macros
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // { recipe } | { recipe: null } for new
  const [expandedId, setExpandedId] = useState(null) // recipe.id showing Edit/Vary/Delete instead of macros
  const [logging, setLogging] = useState(null) // { recipe } for RecipeLogModal, opened from Add
  const [status, setStatus] = useState(null)

  const load = useCallback(async () => {
    try {
      const rows = await getRecipes()
      setRecipes(rows)
      setError(null)

      const foodCache = new Map()
      const entries = await Promise.all(rows.map(async r => [r.id, await recipeTotals(r, foodCache)]))
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
      {status && <div className="food-status">{status}</div>}

      <div className="log-list">
        {recipes.map(recipe => (
          <div
            key={recipe.id}
            className="log-card"
            onClick={() => setExpandedId(id => (id === recipe.id ? null : recipe.id))}
          >
            <div className="log-main">
              <div className="log-name">{recipe.name}</div>
              <div className="log-meta">
                {(recipe.items || []).length} ingredient{(recipe.items || []).length === 1 ? '' : 's'}
                {' · '}{recipe.servings || 1} serving{(recipe.servings || 1) === 1 ? '' : 's'}
              </div>
            </div>
            {expandedId === recipe.id ? (
              <div className="log-quick-actions" onClick={e => e.stopPropagation()}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing({ recipe }); setExpandedId(null) }}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing({ recipe: { name: `${recipe.name} (variation)`, servings: recipe.servings, items: recipe.items } })
                    setExpandedId(null)
                  }}
                >
                  Vary
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { setLogging({ recipe }); setExpandedId(null) }}
                >
                  Add
                </button>
                <button className="icon-btn danger" onClick={e => handleDelete(e, recipe)}>✕</button>
              </div>
            ) : (
              totals[recipe.id] && (
                <div className="log-stats">
                  <MacroLine food={totals[recipe.id]} />
                  <KcalCol kcal={totals[recipe.id].kcal} suffix="/serving" />
                </div>
              )
            )}
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

      {logging && (
        <RecipeLogModal
          recipe={logging.recipe}
          onLogged={() => { setLogging(null); setStatus('Logged.') }}
          onClose={() => setLogging(null)}
        />
      )}
    </>
  )
}
