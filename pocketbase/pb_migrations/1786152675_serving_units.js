/// <reference path="../pb_data/types.d.ts" />

// Serving units.
//
// Macros stay per 100 g on `foods` — that is the storage basis every source
// (Open Food Facts, AFCD, manual) normalises to, and it stays a single multiply.
// What was missing was a way to *express* an amount in anything but grams:
//
//   - "1 scoop" of protein powder
//   - "1 block" of chocolate
//   - "135 ml" of milk
//   - "34 g" of chicken — an arbitrary weight, not a multiple of anything
//
// foods gains:
//   unit_label  the name of one natural unit ('scoop', 'block', 'ml', 'wrap')
//   unit_g      how many grams that unit weighs (milk: 1.03 g per ml,
//               protein: 30 g per scoop). Empty when the unit has no known
//               gram equivalent.
//
// food_logs gains:
//   amount      the number the user typed
//   unit        'g' — amount is grams
//               'unit' — amount is a count of the food's unit_label
//
// Grams are resolved at *render* time (amount, or amount * food.unit_g), not
// baked into the row. Same reasoning as macros: correcting a food's unit_g
// later fixes every log that referenced it, which is the intended behaviour
// for a mis-entered definition.
//
// The old `grams` field is left in place and backfilled into amount/unit so
// nothing is lost, but it is no longer read.
migrate((db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.addField(new SchemaField({
    name: 'unit_label',
    type: 'text',
    required: false,
    options: {},
  }))
  foods.schema.addField(new SchemaField({
    name: 'unit_g',
    type: 'number',
    required: false,
    options: { min: 0, max: null, noDecimal: false },
  }))
  dao.saveCollection(foods)

  const logs = dao.findCollectionByNameOrId('food_logs')
  logs.schema.addField(new SchemaField({
    name: 'amount',
    type: 'number',
    required: false,
    options: { min: 0, max: null, noDecimal: false },
  }))
  logs.schema.addField(new SchemaField({
    name: 'unit',
    type: 'text',
    required: false,
    options: {},
  }))
  dao.saveCollection(logs)

  // Backfill: every existing row was grams, by definition.
  db.newQuery(
    "UPDATE food_logs SET amount = grams, unit = 'g' WHERE amount IS NULL OR amount = 0"
  ).execute()
}, (db) => {
  const dao = new Dao(db)

  const logs = dao.findCollectionByNameOrId('food_logs')
  logs.schema.removeField(logs.schema.getFieldByName('amount').id)
  logs.schema.removeField(logs.schema.getFieldByName('unit').id)
  dao.saveCollection(logs)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.removeField(foods.schema.getFieldByName('unit_label').id)
  foods.schema.removeField(foods.schema.getFieldByName('unit_g').id)
  dao.saveCollection(foods)
})
