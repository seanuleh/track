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
 * Search the local Open Food Facts mirror (~75k AU/NZ products).
 *
 * Local, so it's fast enough to run as you type and works with OFF down or
 * offline. Ranked by name matches before brand matches — typing "tim tam"
 * should surface the biscuit, not everything Arnott's makes.
 */
export async function searchCatalog(query, limit = 20) {
  if (!query.trim()) return []
  const rows = await pb.collection('food_catalog').getList(1, limit, {
    filter: wordFilter(query),
    sort: 'name',
  })
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
  return rows.items.sort(
    (a, b) => score(a) - score(b) || (a.name || '').length - (b.name || '').length
  )
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
  }
  return createFood({
    barcode: item.barcode || '',
    name: item.name,
    brand: item.brand || '',
    source: 'off',
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
export async function logFood({ date, foodId, amount, unit = 'g', food, meal }) {
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
    user: pb.authStore.model.id,
  })
}

export async function deleteLog(id) {
  return pb.collection('food_logs').delete(id)
}

// ── recipes ──────────────────────────────────────────────────────────────

export async function getRecipes() {
  return pb.collection('recipes').getFullList({ sort: 'name' })
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

/**
 * Log one serving of a recipe by expanding it into individual food_logs rows.
 * Expanding at log time (rather than storing a reference) means editing a
 * recipe later never rewrites history that was already logged.
 *
 * Items carry their own unit — a recipe can hold "1 scoop" of protein powder
 * alongside "34 g" of oats. Dividing by servings works either way.
 */
export async function logRecipe(recipe, { date, meal }) {
  const servings = Number(recipe.servings) || 1
  const items = Array.isArray(recipe.items) ? recipe.items : []

  return Promise.all(
    items.map(item =>
      logFood({
        date,
        foodId: item.food,
        amount: Number(item.amount ?? item.grams) / servings,
        unit: item.unit || 'g',
        meal,
      })
    )
  )
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
