import PocketBase from 'pocketbase'
import { lookupBarcode } from './off.js'

const pb = new PocketBase('/')
pb.autoCancellation(false)

// ── foods ────────────────────────────────────────────────────────────────

export async function findFoodByBarcode(barcode) {
  const rows = await pb.collection('foods').getList(1, 1, {
    filter: pb.filter('barcode = {:barcode}', { barcode }),
  })
  return rows.items[0] || null
}

/**
 * Find an already-copied food that has no barcode to match on.
 *
 * AFCD whole foods and bakery items are sold without a pack, so barcode — the
 * identity used everywhere else here — is empty and `'' = ''` matches every
 * other unbarcoded food. Name plus brand is the only identity they have. Exact
 * match, not `~`: "Banana, cavendish, peeled, raw" and "Banana, frozen" are
 * genuinely different foods with different macros.
 */
export async function findFoodByName(name, brand = '') {
  const rows = await pb.collection('foods').getList(1, 1, {
    filter: pb.filter('barcode = "" && name = {:name} && brand = {:brand}',
      { name, brand }),
  })
  return rows.items[0] || null
}

export async function createFood(food) {
  return pb.collection('foods').create(food)
}

/**
 * Build a filter that requires every word of the query to appear somewhere in
 * the name or brand.
 *
 * A single `name ~ "weet bix"` is a substring match, so it misses "Weet-Bix" —
 * and product names are full of hyphens, commas and pack sizes that sit
 * between the words you'd actually type. Matching each word independently
 * means word order and punctuation stop mattering.
 */
function wordFilter(query) {
  const words = query.trim().split(/\s+/).slice(0, 6)
  return words
    .map(w => pb.filter('(name ~ {:w} || brand ~ {:w})', { w }))
    .join(' && ')
}

export async function searchFoods(query) {
  if (!query.trim()) return []
  const rows = await pb.collection('foods').getList(1, 20, {
    filter: wordFilter(query),
    sort: 'name',
  })
  return rows.items
}

/**
 * The Foods manager's list: favourites first, then alphabetical.
 *
 * Paginated rather than getFullList — the cache only grows, and the manager is
 * a browsing surface, so it must not degrade as the library fills up.
 */
export async function listFoods({ query = '', page = 1, perPage = 50 } = {}) {
  const opts = { sort: '-favourite,name' }
  if (query.trim()) {
    opts.filter = pb.filter('name ~ {:q} || brand ~ {:q} || barcode ~ {:q}', { q: query })
  }
  return pb.collection('foods').getList(page, perPage, opts)
}

// ── food_catalog ─────────────────────────────────────────────────────────

/**
 * Search the local food catalog — ~75k AU/NZ Open Food Facts products plus the
 * ~1.6k AFCD whole foods (`source` tells them apart).
 *
 * Local, so it's fast enough to run as you type and works with OFF down or
 * offline. Ranked by name matches before brand matches — typing "tim tam"
 * should surface the biscuit, not everything Arnott's makes.
 */
export async function searchCatalog(query, limit = 20) {
  if (!query.trim()) return []
  const filter = wordFilter(query)

  // Two queries, not one. PocketBase sorts server-side and truncates at
  // `limit`, and OFF outnumbers AFCD 47:1 — sorted by name, "chicken breast"
  // filled all 20 slots with branded schnitzels and pub meals before reaching
  // "Chicken, breast, lean flesh, raw". The whole point of importing AFCD is
  // that it answers exactly the queries OFF answers worst, so it gets its own
  // slots rather than competing for the same page of results.
  const [branded, whole] = await Promise.all([
    pb.collection('food_catalog').getList(1, limit, { filter, sort: 'name' }),
    pb.collection('food_catalog').getList(1, Math.ceil(limit / 2), {
      filter: `(${filter}) && source = 'afcd'`,
      sort: 'name',
    }),
  ])

  const merged = []
  const seen = new Set()
  for (const item of [...whole.items, ...branded.items]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    merged.push(item)
  }

  // Rank client-side: a name that starts with what you typed is almost always
  // what you meant, and a shorter name beats a longer one carrying pack sizes
  // and marketing ("Vegemite" over "Vegemite 455g Spread Jar").
  const q = query.trim().toLowerCase()
  const score = f => {
    const name = (f.name || '').toLowerCase()
    if (name.startsWith(q)) return 0
    if (name.includes(q)) return 1
    return 2
  }
  return merged
    .sort((a, b) => score(a) - score(b) || (a.name || '').length - (b.name || '').length)
    .slice(0, limit)
}

/**
 * Promote a catalog row into `foods` so it can be logged against.
 *
 * `food_logs.food` is a relation to `foods`, and `foods` means "things I
 * actually eat" — so the catalog is copied in on first use rather than being
 * logged against directly. Same write-through pattern as a barcode lookup,
 * sourced from the local mirror instead of the network.
 *
 * Copies by value: a later catalog refresh must not silently rewrite the
 * macros behind days you've already logged.
 */
export async function ensureFoodFromCatalog(item) {
  if (item.barcode) {
    const existing = await findFoodByBarcode(item.barcode)
    if (existing) return existing
  } else {
    // Without this, logging the same AFCD food twice creates a second `foods`
    // row each time: the barcode check above can't run, so every log of
    // "Chicken, breast, lean flesh, raw" was a fresh copy.
    const existing = await findFoodByName(item.name, item.brand || '')
    if (existing) return existing
  }
  return createFood({
    barcode: item.barcode || '',
    name: item.name,
    brand: item.brand || '',
    // Carry the catalog row's provenance rather than assuming OFF: the mirror
    // also holds AFCD whole foods, and `foods.source` is what tells a barcode
    // cache entry apart from a government reference value later.
    source: item.source || 'off',
    serving_g: item.serving_g || null,
    kcal: item.kcal, protein: item.protein, fat: item.fat, carbs: item.carbs,
    fiber: item.fiber, sugar: item.sugar, sodium: item.sodium,
  })
}

export async function getFood(id) {
  return pb.collection('foods').getOne(id)
}

export async function updateFood(id, data) {
  return pb.collection('foods').update(id, data)
}

export async function deleteFood(id) {
  return pb.collection('foods').delete(id)
}

export async function setFavourite(id, favourite) {
  return pb.collection('foods').update(id, { favourite })
}

/**
 * Foods you've logged recently, most-recent-first, deduped.
 *
 * Read from `food_logs` rather than a "last used" column on `foods` — logging
 * is already the signal, so there's nothing extra to keep in sync. Overfetches
 * logs (3x limit) since the same food repeats across entries and dedup can
 * otherwise starve the result short of `limit`.
 */
export async function getRecentFoods(limit = 8) {
  const rows = await pb.collection('food_logs').getList(1, limit * 3, {
    sort: '-created',
    expand: 'food',
  })
  const seen = new Set()
  const out = []
  for (const log of rows.items) {
    const food = log.expand?.food
    if (!food || seen.has(food.id)) continue
    seen.add(food.id)
    out.push(food)
    if (out.length >= limit) break
  }
  return out
}

export async function getFavouriteFoods(limit = 20) {
  const rows = await pb.collection('foods').getList(1, limit, {
    filter: 'favourite = true',
    sort: 'name',
  })
  return rows.items
}

/**
 * How many logs reference this food.
 *
 * `foods` is deliberately not cascade-delete: deleting a food that history
 * points at would leave logs rendering as "Unknown food" with no macros, and
 * silently change past totals. The manager asks before doing that.
 */
export async function countLogsForFood(foodId) {
  const rows = await pb.collection('food_logs').getList(1, 1, {
    filter: pb.filter('food = {:id}', { id: foodId }),
  })
  return rows.totalItems
}

/**
 * Resolve a scanned barcode to a food record.
 *
 * Three tiers, cheapest first:
 *   1. `foods` — you've logged it before, and it carries your corrections
 *      and serving units, so it must win over any fresher upstream copy.
 *   2. `food_catalog` — the local Open Food Facts mirror. No network, so most
 *      scans resolve offline and stay fast when OFF is down or throttling.
 *   3. Open Food Facts over the wire — for products newer than the last
 *      catalog sync, or sold outside AU/NZ.
 *
 * A miss is not an error — it means "prompt for manual entry".
 *
 * Returns { food, origin }, origin being 'cache' | 'catalog' | 'off' | null.
 */
/**
 * Snap a nutrition panel and get back per-100g macros, via the local
 * `pb_hooks/vision.pb.js` proxy to Ollama (qwen2.5vl) — never Anthropic, so
 * this costs nothing and never touches an API key or CLI subscription.
 *
 * `imageBase64` is raw base64, no data-URL prefix. Field names match the
 * `foods` schema so the caller can spread the result straight into form state.
 * Missing/unreadable fields come back absent, not zero — the caller must not
 * treat a gap as "confirmed zero".
 */
export async function extractNutritionFromImage(imageBase64) {
  const result = await pb.send('/api/vision/nutrition', {
    method: 'POST',
    body: { image: imageBase64 },
  })
  return {
    kcal: result.kcal_per_100 ?? null,
    protein: result.protein_g_per_100 ?? null,
    fat: result.fat_g_per_100 ?? null,
    carbs: result.carbs_g_per_100 ?? null,
    fiber: result.fiber_g_per_100 ?? null,
    sugar: result.sugar_g_per_100 ?? null,
    sodium: result.sodium_mg_per_100 ?? null,
    serving_g: result.serving_g_or_ml ?? null,
  }
}

export async function resolveBarcode(barcode) {
  const cached = await findFoodByBarcode(barcode)
  if (cached) return { food: cached, origin: 'cache' }

  const local = await pb.collection('food_catalog').getList(1, 1, {
    filter: pb.filter('barcode = {:barcode}', { barcode }),
  })
  if (local.items[0]) {
    return { food: await ensureFoodFromCatalog(local.items[0]), origin: 'catalog' }
  }

  const fetched = await lookupBarcode(barcode)
  if (!fetched) return { food: null, origin: null }

  return { food: await createFood(fetched), origin: 'off' }
}

// ── food_logs ────────────────────────────────────────────────────────────

export async function getLogsForDate(date) {
  return pb.collection('food_logs').getFullList({
    filter: pb.filter('date = {:date}', { date }),
    expand: 'food',
    sort: '-created',
  })
}

/**
 * Log an amount of a food, expressed either in grams or in the food's own
 * natural unit (`unit: 'unit'` — scoops, blocks, ml, wraps).
 *
 * `grams` is written too, so the row still makes sense to anything reading the
 * old field, but nothing computes from it — see gramsFor.
 */
export async function logFood({ date, foodId, amount, unit = 'g', food, meal, recipeGroup, recipeName }) {
  const n = Number(amount)
  // Only a unit-based amount needs the record; grams are already grams.
  if (!food && unit === 'unit') food = await pb.collection('foods').getOne(foodId)
  return pb.collection('food_logs').create({
    date,
    food: foodId,
    amount: n,
    unit,
    grams: gramsFor({ amount: n, unit }, food),
    meal: meal || '',
    recipe_group: recipeGroup || '',
    recipe_name: recipeName || '',
    user: pb.authStore.model.id,
  })
}

/** Edit an existing log's amount, unit, meal or date — grams recomputed from `food`. */
export async function updateLog(id, { date, amount, unit = 'g', food, meal }) {
  const n = Number(amount)
  return pb.collection('food_logs').update(id, {
    date,
    amount: n,
    unit,
    grams: gramsFor({ amount: n, unit }, food),
    meal: meal || '',
  })
}

export async function deleteLog(id) {
  return pb.collection('food_logs').delete(id)
}

/**
 * Scale every ingredient row in a logged recipe by `factor` — the diary's
 * "servings eaten" edit. Recipes aren't referenced by id from a log (see
 * logRecipe), so there's no stored base amount to recompute from; this scales
 * whatever is currently logged, which composes fine across repeated edits.
 */
export async function scaleLogGroup(recipeGroup, factor) {
  const rows = await pb.collection('food_logs').getFullList({
    filter: pb.filter('recipe_group = {:recipeGroup}', { recipeGroup }),
    expand: 'food',
  })
  return Promise.all(rows.map(r => {
    const amount = Number(r.amount) * factor
    return pb.collection('food_logs').update(r.id, {
      amount,
      grams: gramsFor({ amount, unit: r.unit }, r.expand?.food),
    })
  }))
}

/** Delete every row logged together as one recipe serving. */
export async function deleteLogGroup(recipeGroup) {
  const rows = await pb.collection('food_logs').getFullList({
    filter: pb.filter('recipe_group = {:recipeGroup}', { recipeGroup }),
  })
  return Promise.all(rows.map(r => pb.collection('food_logs').delete(r.id)))
}

/** Reassign a logged entry to a different meal — the drag-between-meals target. */
export async function updateLogMeal(id, meal) {
  return pb.collection('food_logs').update(id, { meal })
}

/** Reassign every row in a recipe group to a different meal, as one drag target. */
export async function updateLogGroupMeal(recipeGroup, meal) {
  const rows = await pb.collection('food_logs').getFullList({
    filter: pb.filter('recipe_group = {:recipeGroup}', { recipeGroup }),
  })
  return Promise.all(rows.map(r => pb.collection('food_logs').update(r.id, { meal })))
}

/**
 * Copy a set of logged rows (a meal, or a whole day) onto `targetDate` as
 * fresh food_logs rows — the diary's "copy to another day". Recipe rows keep
 * their grouping so a copied recipe still collapses into one card, but under
 * a new recipe_group per distinct source group, not the original one: reusing
 * the old id would merge the copy's rows into the source day's group in any
 * query that doesn't also filter by date.
 */
export async function copyLogs(logs, targetDate) {
  const groupMap = new Map() // source recipe_group -> new recipe_group
  return Promise.all(logs.map(log => {
    let recipeGroup = ''
    if (log.recipe_group) {
      if (!groupMap.has(log.recipe_group)) groupMap.set(log.recipe_group, crypto.randomUUID())
      recipeGroup = groupMap.get(log.recipe_group)
    }
    return pb.collection('food_logs').create({
      date: targetDate,
      food: log.food,
      amount: log.amount,
      unit: log.unit,
      grams: log.grams,
      meal: log.meal,
      recipe_group: recipeGroup,
      recipe_name: log.recipe_name || '',
      user: pb.authStore.model.id,
    })
  }))
}

// ── recipes ──────────────────────────────────────────────────────────────

export async function getRecipes() {
  return pb.collection('recipes').getFullList({ sort: '-favourite,name' })
}

export async function createRecipe({ name, items, servings }) {
  return pb.collection('recipes').create({
    name,
    items,
    servings: Number(servings) || 1,
    user: pb.authStore.model.id,
  })
}

export async function updateRecipe(id, { name, items, servings }) {
  return pb.collection('recipes').update(id, { name, items, servings: Number(servings) || 1 })
}

export async function deleteRecipe(id) {
  return pb.collection('recipes').delete(id)
}

export async function setRecipeFavourite(id, favourite) {
  return pb.collection('recipes').update(id, { favourite })
}

/**
 * Sum a recipe's items into per-serving macros. Foods aren't expanded on the
 * recipe record, so each referenced food is fetched once and cached by id —
 * recipes commonly share ingredients (milk, protein powder), so a shared
 * cache across recipes avoids re-fetching the same food repeatedly.
 */
export async function recipeTotals(recipe, foodCache = new Map()) {
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

/**
 * Log a finished list of {food, amount, unit} rows as one recipe serving,
 * expanding into individual food_logs rows sharing a recipe_group. This is
 * the write path for both "log as-is" (logRecipe, below) and edit-before-log
 * (RecipeLogModal, which lets items be swapped/adjusted first) — expanding
 * at log time rather than storing a reference means neither path lets a
 * later recipe edit rewrite history that was already logged.
 */
export async function logRecipeItems(items, { date, meal, recipeName }) {
  // Shared by every row from this call, so the diary can collapse them back
  // into one card — crypto.randomUUID() needs no server round trip.
  const recipeGroup = crypto.randomUUID()

  return Promise.all(
    items.map(item =>
      logFood({
        date,
        foodId: item.food,
        amount: Number(item.amount ?? item.grams),
        unit: item.unit || 'g',
        meal,
        recipeGroup,
        recipeName,
      })
    )
  )
}

/**
 * Log one serving of a recipe as saved, no edits. Items carry their own
 * unit — a recipe can hold "1 scoop" of protein powder alongside "34 g" of
 * oats — so dividing by servings works either way.
 */
export async function logRecipe(recipe, { date, meal }) {
  const servings = Number(recipe.servings) || 1
  const items = Array.isArray(recipe.items) ? recipe.items : []
  return logRecipeItems(
    items.map(item => ({
      food: item.food,
      amount: Number(item.amount ?? item.grams) / servings,
      unit: item.unit || 'g',
    })),
    { date, meal, recipeName: recipe.name }
  )
}

// ── daily_targets ────────────────────────────────────────────────────────

/**
 * The target in effect on `date` — the newest row with effective_date <=
 * date, so raising a target later never rescores days already logged
 * against the old one.
 *
 * Dates *before* the very first target ever set have nothing <= them to
 * find; falling through to that first target anyway (rather than null)
 * means the targets panel is the diary's default look everywhere once
 * you've ever set a target, not just from the day you happened to set it.
 * There's no "true" target for those older days regardless — this is a
 * display choice, not a correction, so it doesn't conflict with the
 * no-rescoring rule above.
 *
 * Returns null only if no target has ever been set at all.
 */
export async function getTargetForDate(date) {
  try {
    return await pb.collection('daily_targets').getFirstListItem(
      pb.filter('effective_date <= {:date}', { date }),
      { sort: '-effective_date' }
    )
  } catch (err) {
    if (err.status !== 404) throw err
  }
  try {
    return await pb.collection('daily_targets').getFirstListItem('', { sort: 'effective_date' })
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/**
 * Set a new target, effective from `date` (defaults to today) onward. Always
 * a new row, never an update-in-place — see getTargetForDate.
 */
export async function setTarget({ kcal, protein, fat, carbs, date }) {
  return pb.collection('daily_targets').create({
    effective_date: date,
    kcal: Number(kcal),
    protein: protein === '' || protein == null ? null : Number(protein),
    fat: fat === '' || fat == null ? null : Number(fat),
    carbs: carbs === '' || carbs == null ? null : Number(carbs),
    user: pb.authStore.model.id,
  })
}

// ── amounts, units and macro maths ───────────────────────────────────────

/**
 * Resolve a log's amount to grams.
 *
 * Deliberately computed from the *current* food record rather than read from
 * the stored `grams`: fixing a food's unit_g (a mis-measured scoop, say)
 * should correct every log that used it, exactly as fixing its macros does.
 *
 * A unit-based log for a food with no unit_g has no gram equivalent — returns
 * null rather than guessing, so macros come out as "unknown", not zero.
 */
export function gramsFor(log, food) {
  const amount = Number(log?.amount ?? log?.grams) || 0
  if (log?.unit !== 'unit') return amount

  const unitG = Number(food?.unit_g)
  return unitG > 0 ? amount * unitG : null
}

/**
 * The default amount for this food, as a {amount, unit} pair — the same shape
 * as a log, so it drops straight into gramsFor, formatAmount and logFood.
 *
 * A stored portion wins. Otherwise this falls back rather than forcing every
 * food to be curated before it can be logged: one natural unit if it has one,
 * then the pack's declared serving, then 100 g. The pack serving ranks last of
 * the real options because it's the manufacturer's number, not yours.
 */
export function portionOf(food) {
  if (Number(food?.portion_amount) > 0) {
    return { amount: Number(food.portion_amount), unit: food.portion_unit === 'unit' ? 'unit' : 'g' }
  }
  if (food?.unit_label && Number(food?.unit_g) > 0) return { amount: 1, unit: 'unit' }
  if (Number(food?.serving_g) > 0) return { amount: Number(food.serving_g), unit: 'g' }
  return { amount: 100, unit: 'g' }
}

/** Whether the portion is yours or just the fallback — drives the "set one" nudge. */
export function hasOwnPortion(food) {
  return Number(food?.portion_amount) > 0
}

/** How the amount reads back to a human: "34 g", "1 scoop", "135 ml". */
export function formatAmount(log, food) {
  const amount = Number(log?.amount ?? log?.grams) || 0
  const rounded = Math.round(amount * 10) / 10
  if (log?.unit !== 'unit') return `${rounded} g`

  const label = food?.unit_label || 'unit'
  // 'ml' reads as "135 ml"; a countable unit pluralises — "2 scoops".
  const plural = label.length > 2 && rounded !== 1 ? `${label}s` : label
  return `${rounded} ${plural}`
}

// Every macro on `foods` is per 100 g, so a serving is one multiply.
export function macrosFor(food, grams) {
  const factor = (Number(grams) || 0) / 100
  const scale = v => (v == null ? 0 : v * factor)
  return {
    kcal: scale(food?.kcal),
    protein: scale(food?.protein),
    fat: scale(food?.fat),
    carbs: scale(food?.carbs),
  }
}

export function totalMacros(logs) {
  return logs.reduce(
    (acc, log) => {
      const m = macrosFor(log.expand?.food, gramsFor(log, log.expand?.food))
      acc.kcal += m.kcal
      acc.protein += m.protein
      acc.fat += m.fat
      acc.carbs += m.carbs
      return acc
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  )
}
