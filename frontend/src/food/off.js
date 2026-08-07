// Open Food Facts client.
//
// Called straight from the browser — OFF sends `access-control-allow-origin: *`,
// so no worker or proxy is needed.
//
// Only the barcode endpoint is used. OFF's /search endpoint is aggressively
// throttled and regularly returns an HTML "Page temporarily unavailable" body
// instead of JSON, so nothing here may depend on it.

const OFF_BASE = 'https://world.openfoodfacts.org/api/v2'

// OFF asks that apps identify themselves so they can spot misbehaving clients.
const USER_AGENT = 'uleh-track/1.0 (seanelsayed@gmail.com)'

const FIELDS = [
  'product_name',
  'brands',
  'quantity',
  'serving_quantity',
  'serving_size',
  'nutriments',
].join(',')

// OFF returns nutriment keys per 100 g with a `_100g` suffix. Values may be
// missing entirely, or present as strings — coerce and drop anything unusable.
function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Some products carry kJ but not kcal (common on AU/EU packaging).
function kcalFrom(nutriments) {
  const kcal = num(nutriments['energy-kcal_100g'])
  if (kcal !== null) return kcal
  const kj = num(nutriments['energy-kj_100g']) ?? num(nutriments.energy_100g)
  return kj === null ? null : kj / 4.184
}

/**
 * Look up a barcode.
 * Returns a normalised food (macros per 100 g), or null if OFF doesn't have it.
 * Throws only on network/transport failure, so callers can tell "not found"
 * (fall through to manual entry) from "couldn't reach OFF" (retryable).
 */
export async function lookupBarcode(barcode) {
  const url = `${OFF_BASE}/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-User-Agent': USER_AGENT },
  })

  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`)

  // Throttled responses come back as HTML with a 200, so parsing must be guarded.
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Open Food Facts is rate-limiting or down — try again shortly')
  }

  if (data.status === 0 || !data.product) return null

  const p = data.product
  const n = p.nutriments || {}

  const name = (p.product_name || '').trim()
  if (!name) return null // A record with no name is useless to log against.

  return {
    barcode,
    name,
    brand: (p.brands || '').split(',')[0].trim(),
    source: 'off',
    serving_g: num(p.serving_quantity),
    kcal: kcalFrom(n),
    protein: num(n.proteins_100g),
    fat: num(n.fat_100g),
    carbs: num(n.carbohydrates_100g),
    fiber: num(n.fiber_100g),
    sugar: num(n.sugars_100g),
    // OFF reports sodium in g per 100 g; store mg.
    sodium: num(n.sodium_100g) === null ? null : num(n.sodium_100g) * 1000,
    raw: p,
  }
}
