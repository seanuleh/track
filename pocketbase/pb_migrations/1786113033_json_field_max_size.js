/// <reference path="../pb_data/types.d.ts" />

// Give the `json` fields an explicit maxSize.
//
// 1786111416_food_tracking.js created them with `options: {}`, which PocketBase
// stores as maxSize 0 — and 0 means "reject everything", not "no limit". Any
// write carrying a value fails with:
//
//   validation_json_size_limit: The maximum allowed JSON size is 0 bytes
//
// That broke both json fields in practice: `foods.raw` holds the full Open Food
// Facts payload, so every scanned product failed to cache, and `recipes.items`
// holds the item list, so no recipe could be saved.
//
// 2 MB matches PocketBase's own default for json fields. An OFF product payload
// is a few KB, so this is generous.
const MAX_SIZE = 2000000

migrate((db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.getFieldByName('raw').options = { maxSize: MAX_SIZE }
  dao.saveCollection(foods)

  const recipes = dao.findCollectionByNameOrId('recipes')
  recipes.schema.getFieldByName('items').options = { maxSize: MAX_SIZE }
  dao.saveCollection(recipes)
}, (db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.getFieldByName('raw').options = {}
  dao.saveCollection(foods)

  const recipes = dao.findCollectionByNameOrId('recipes')
  recipes.schema.getFieldByName('items').options = {}
  dao.saveCollection(recipes)
})
