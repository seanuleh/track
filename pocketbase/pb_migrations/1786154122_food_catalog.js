/// <reference path="../pb_data/types.d.ts" />

// food_catalog — a local mirror of the Open Food Facts products sold in
// AU/NZ, so food search is instant and works without the network.
//
// Deliberately NOT the same collection as `foods`. `foods` means "things I
// actually eat": it backs the Foods manager, favourites, and the write-through
// barcode cache, and every row in it is there because a human chose it.
// Dropping ~93k imported rows into that would turn the library into a haystack
// and make favourites meaningless.
//
// The two are joined by behaviour, not by schema: the picker searches the
// catalog, and the first time a catalog row is logged it is *copied* into
// `foods`. Same write-through pattern already used for barcode lookups, just
// sourced from local disk instead of Open Food Facts over the wire.
//
// Rows are written by scripts/off-import.py, which writes to SQLite directly —
// 93k inserts through the REST API would take hours. Hence no create/update
// rules: nothing client-side may write here.
//
// Macros are per 100 g, matching `foods`. Sodium is mg (OFF reports g).
migrate((db) => {
  const dao = new Dao(db)

  const catalog = new Collection({
    name: 'food_catalog',
    type: 'base',
    // Read-only to signed-in users. The importer bypasses these entirely.
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    schema: [
      { name: 'barcode', type: 'text', required: false, options: {} },
      { name: 'name', type: 'text', required: true, options: {} },
      { name: 'brand', type: 'text', required: false, options: {} },
      { name: 'serving_g', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'kcal', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'protein', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'fat', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'carbs', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'fiber', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'sugar', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      { name: 'sodium', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      // 'au' | 'nz' | 'au,nz' — kept so the scope of the mirror is visible in
      // the data rather than only in the import script.
      { name: 'countries', type: 'text', required: false, options: {} },
      // OFF's last_modified_t, so the nightly delta can skip rows that are
      // already newer locally than the change it is replaying.
      { name: 'off_modified', type: 'number', required: false, options: { min: 0, max: null, noDecimal: true } },
    ],
    indexes: [
      // Unique on barcode: the delta job upserts by it every night, and a
      // duplicate would mean the same product appearing twice in search.
      'CREATE UNIQUE INDEX `idx_food_catalog_barcode` ON `food_catalog` (`barcode`)',
      'CREATE INDEX `idx_food_catalog_name` ON `food_catalog` (`name`)',
    ],
  })
  dao.saveCollection(catalog)
}, (db) => {
  const dao = new Dao(db)
  dao.deleteCollection(dao.findCollectionByNameOrId('food_catalog'))
})
