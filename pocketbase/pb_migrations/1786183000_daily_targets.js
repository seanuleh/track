/// <reference path="../pb_data/types.d.ts" />

// daily_targets — kcal + optional macro goals, date-effective.
//
// Not a single row on the user: a new row is written every time the target
// changes, each carrying the date it started applying from. Resolving "the
// target for date X" means the newest row with effective_date <= X — so
// raising a target next month never rescoles today, and the diary can always
// answer "what was I aiming for on that day" for any day in history, not
// just the current setting.
//
// Only kcal is required. protein/fat/carbs are optional — Sean may only care
// about a calorie ceiling most days and add macro goals later without a
// schema change.
migrate((db) => {
  const dao = new Dao(db)

  const targets = new Collection({
    name: 'daily_targets',
    type: 'base',
    listRule: '@request.auth.id = user',
    viewRule: '@request.auth.id = user',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id = user',
    deleteRule: '@request.auth.id = user',
    schema: [
      { name: 'effective_date', type: 'text', required: true, options: {} },
      { name: 'kcal', type: 'number', required: true, options: { min: 0, max: null, noDecimal: false } },
      { name: 'protein', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'fat', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'carbs', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      {
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: '_pb_users_auth_', cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: [] },
      },
    ],
    indexes: [
      'CREATE INDEX `idx_daily_targets_user_date` ON `daily_targets` (`user`, `effective_date`)',
    ],
  })
  dao.saveCollection(targets)
}, (db) => {
  const dao = new Dao(db)
  dao.deleteCollection(dao.findCollectionByNameOrId('daily_targets'))
})
