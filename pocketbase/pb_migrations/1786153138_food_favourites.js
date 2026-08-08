/// <reference path="../pb_data/types.d.ts" />

// A `favourite` flag on foods, set from the Foods manager.
//
// Its first job is sorting the manager's own list, so the pantry staples sit at
// the top instead of being hunted for. Its second is feeding the picker sheet's
// default list, so re-logging something eaten constantly costs no typing.
migrate((db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.addField(new SchemaField({
    name: 'favourite',
    type: 'bool',
    required: false,
    options: {},
  }))
  dao.saveCollection(foods)
}, (db) => {
  const dao = new Dao(db)

  const foods = dao.findCollectionByNameOrId('foods')
  foods.schema.removeField(foods.schema.getFieldByName('favourite').id)
  dao.saveCollection(foods)
})
