/// <reference path="../pb_data/types.d.ts" />

// A personal portion on `foods` — the amount *you* actually eat.
//
// Distinct from `serving_g`, which is what the pack declares. Pack servings are
// reference data and frequently useless (a "serving" of cereal is 30 g on paper
// and 90 g in the bowl), so they can't be the default when logging. They stay
// on record as a hint; the portion is what the Foods manager reports macros for
// and what the diary prefills.
//
// Two fields rather than one gram figure, because a portion is the same shape
// as a log's {amount, unit}: "1.5 scoops" must stay expressed in scoops so that
// fixing the food's unit_g later corrects the portion too — the same rule
// gramsFor already enforces for logs. Storing 45 g would let it go stale
// silently.
//
// Left null for existing rows on purpose: portionOf() falls back to 1 unit,
// then the pack serving, then 100 g. Backfilling serving_g here would bake in
// exactly the numbers this field exists to escape, and would destroy the
// "never set" signal.
migrate((db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.addField(new SchemaField({
    name: 'portion_amount',
    type: 'number',
    required: false,
    options: { min: 0 },
  }))
  foods.schema.addField(new SchemaField({
    name: 'portion_unit',
    type: 'text',
    required: false,
    options: {},
  }))
  dao.saveCollection(foods)
}, (db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.removeField(foods.schema.getFieldByName('portion_amount').id)
  foods.schema.removeField(foods.schema.getFieldByName('portion_unit').id)
  dao.saveCollection(foods)
})
