/// <reference path="../pb_data/types.d.ts" />

// Seed two manual foods requested by Sean: Ear of Corn (per-100g scaled from a
// 143g-kernel label) and Onion (per-100g, portion set to 100g).
migrate((db) => {
  const dao = new Dao(db)
  const foods = dao.findCollectionByNameOrId('foods')

  const seed = (data) => {
    try {
      dao.findFirstRecordByFilter('foods', `name = {:name}`, { name: data.name })
      return
    } catch (e) {
      // not found, fall through and create
    }
    const record = new Record(foods, data)
    dao.saveRecord(record)
  }

  seed({
    name: 'Ear of Corn',
    source: 'manual',
    serving_g: 143,
    unit_label: 'ear',
    unit_g: 143,
    kcal: 86.0,
    protein: 3.22,
    fat: 1.19,
    carbs: 19.02,
    fiber: 2.73,
    sugar: 3.22,
  })

  seed({
    name: 'Onion',
    source: 'manual',
    kcal: 38,
    protein: 0.8,
    fat: 0.1,
    carbs: 8.6,
    fiber: 1.9,
    sugar: 5.8,
    portion_amount: 100,
    portion_unit: 'g',
  })
}, (db) => {
  const dao = new Dao(db)
  ;['Ear of Corn', 'Onion'].forEach((name) => {
    try {
      const rec = dao.findFirstRecordByFilter('foods', `name = {:name}`, { name })
      dao.deleteRecord(rec)
    } catch (e) {
      // not found, nothing to remove
    }
  })
})
