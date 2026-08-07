/// <reference path="../pb_data/types.d.ts" />

// Calorie tracking: foods (barcode cache) + food_logs + recipes.
//
// All macros on `foods` are stored per 100 g, so a serving is a single
// multiply and every source (Open Food Facts, AFCD, manual) normalises to the
// same basis.
migrate((db) => {
  const dao = new Dao(db)

  // foods — shared cache of food definitions, filled on demand by barcode
  // lookups. Not user-scoped: it caches public nutrition data, so any signed-in
  // user may read and add. `raw` keeps the untouched upstream payload so extra
  // nutrients can be backfilled later without re-fetching.
  const foods = new Collection({
    name: 'foods',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    schema: [
      { name: 'barcode', type: 'text', required: false, options: {} },
      { name: 'name', type: 'text', required: true, options: {} },
      { name: 'brand', type: 'text', required: false, options: {} },
      // 'off' | 'afcd' | 'manual'
      { name: 'source', type: 'text', required: false, options: {} },
      // Manufacturer's stated serving, when the pack declares one.
      { name: 'serving_g', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'kcal', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'protein', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'fat', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'carbs', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'fiber', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'sugar', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      // mg per 100 g.
      { name: 'sodium', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'raw', type: 'json', required: false, options: {} },
    ],
    indexes: ['CREATE INDEX `idx_foods_barcode` ON `foods` (`barcode`)'],
  })
  dao.saveCollection(foods)

  // food_logs — one row per thing eaten.
  const foodLogs = new Collection({
    name: 'food_logs',
    type: 'base',
    listRule: '@request.auth.id = user',
    viewRule: '@request.auth.id = user',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id = user',
    deleteRule: '@request.auth.id = user',
    schema: [
      { name: 'date', type: 'text', required: true, options: {} },
      {
        name: 'food',
        type: 'relation',
        required: true,
        options: { collectionId: foods.id, cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: [] },
      },
      { name: 'grams', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      // 'breakfast' | 'lunch' | 'dinner' | 'snack'
      { name: 'meal', type: 'text', required: false, options: {} },
      {
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: '_pb_users_auth_', cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: [] },
      },
    ],
    indexes: ['CREATE INDEX `idx_food_logs_user_date` ON `food_logs` (`user`, `date`)'],
  })
  dao.saveCollection(foodLogs)

  // recipes — a named template of [{ food, grams }]. Logging a recipe expands
  // its items into individual food_logs rows, so edits to a recipe never
  // rewrite history that was already logged.
  const recipes = new Collection({
    name: 'recipes',
    type: 'base',
    listRule: '@request.auth.id = user',
    viewRule: '@request.auth.id = user',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id = user',
    deleteRule: '@request.auth.id = user',
    schema: [
      { name: 'name', type: 'text', required: true, options: {} },
      { name: 'items', type: 'json', required: false, options: {} },
      { name: 'servings', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      {
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: '_pb_users_auth_', cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: [] },
      },
    ],
  })
  dao.saveCollection(recipes)
}, (db) => {
  const dao = new Dao(db)
  dao.deleteCollection(dao.findCollectionByNameOrId('recipes'))
  dao.deleteCollection(dao.findCollectionByNameOrId('food_logs'))
  dao.deleteCollection(dao.findCollectionByNameOrId('foods'))
})
