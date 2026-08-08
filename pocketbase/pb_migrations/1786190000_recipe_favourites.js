/// <reference path="../pb_data/types.d.ts" />

// A `favourite` flag on recipes, mirroring foods — recipes now show up in the
// Foods manager list alongside foods so they can be starred and surfaced the
// same way.
migrate((db) => {
  const dao = new Dao(db)

  const recipes = dao.findCollectionByNameOrId('recipes')
  recipes.schema.addField(new SchemaField({
    name: 'favourite',
    type: 'bool',
    required: false,
    options: {},
  }))
  dao.saveCollection(recipes)
}, (db) => {
  const dao = new Dao(db)

  const recipes = dao.findCollectionByNameOrId('recipes')
  recipes.schema.removeField(recipes.schema.getFieldByName('favourite').id)
  dao.saveCollection(recipes)
})
