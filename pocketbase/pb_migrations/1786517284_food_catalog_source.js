/// <reference path="../pb_data/types.d.ts" />

// food_catalog gains a provenance pair so it can hold more than Open Food Facts.
//
// Why here: AFCD (Australian Food Composition Database, FSANZ) is the
// authoritative AU source for the things OFF covers badly — chicken breast,
// rolled oats, a banana — because OFF is a *barcode* database and those are
// sold without a pack. Same kind of thing as the OFF mirror (a browsable
// reference that gets copied into `foods` on first log), so it goes in the same
// collection rather than a second one with a second search path.
//
// Two schema problems that had to be solved together:
//
//   1. `source` didn't exist. Without it an AFCD row and an OFF row are
//      indistinguishable in the UI and on re-import.
//   2. AFCD rows have no barcode, and `idx_food_catalog_barcode` is UNIQUE.
//      SQLite treats '' = '', so the second barcode-less row inserted would be
//      rejected. Relaxed to a partial unique index over non-empty barcodes —
//      OFF still can't duplicate a product, and unbarcoded rows are free.
//
// `source_id` is the upstream's own key (AFCD's "Public Food Key", e.g.
// F002258), unique per source, so a re-import upserts rather than duplicating.
// OFF rows leave it empty and keep upserting on barcode as before.
migrate((db) => {
  const dao = new Dao(db)
  const c = dao.findCollectionByNameOrId('food_catalog')

  c.schema.addField(new SchemaField({
    name: 'source',
    type: 'text',
    required: false,
    options: {},
  }))
  c.schema.addField(new SchemaField({
    name: 'source_id',
    type: 'text',
    required: false,
    options: {},
  }))

  c.indexes = [
    // Partial: barcode stays unique where it exists, and the barcode-less AFCD
    // rows no longer collide with each other on ''.
    'CREATE UNIQUE INDEX `idx_food_catalog_barcode` ON `food_catalog` (`barcode`) WHERE `barcode` != \'\'',
    'CREATE UNIQUE INDEX `idx_food_catalog_source_id` ON `food_catalog` (`source`, `source_id`) WHERE `source_id` != \'\'',
    'CREATE INDEX `idx_food_catalog_name` ON `food_catalog` (`name`)',
  ]

  dao.saveCollection(c)

  // Existing rows are all the OFF mirror. Labelling them now means `source` is
  // never empty in practice, so the UI can trust it without a fallback.
  db.newQuery("UPDATE food_catalog SET source = 'off' WHERE source = '' OR source IS NULL").execute()
}, (db) => {
  const dao = new Dao(db)
  const c = dao.findCollectionByNameOrId('food_catalog')
  c.schema.removeField(c.schema.getFieldByName('source').id)
  c.schema.removeField(c.schema.getFieldByName('source_id').id)
  c.indexes = [
    'CREATE UNIQUE INDEX `idx_food_catalog_barcode` ON `food_catalog` (`barcode`)',
    'CREATE INDEX `idx_food_catalog_name` ON `food_catalog` (`name`)',
  ]
  dao.saveCollection(c)
})
