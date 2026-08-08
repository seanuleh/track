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

export async function searchFoods(query) {
  if (!query.trim()) return []
  const rows = await pb.collection('foods').getList(1, 20, {
    filter: pb.filter('name ~ {:q} || brand ~ {:q}', { q: query }),
    sort: 'name',
  })
  return rows.items
}

/**
 * Resolve a scanned barcode to a food record.
 *
 * Write-through cache: local hit wins, otherwise ask Open Food Facts and store
 * the result so the next scan of that item is offline-capable and instant.
 * A miss is not an error — it means "prompt for manual entry".
 *
 * Returns { food, origin } where origin is 'cache' | 'off' | null.
 */
export async function resolveBarcode(barcode) {
  const cached = await findFoodByBarcode(barcode)
  if (cached) return { food: cached, origin: 'cache' }

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
