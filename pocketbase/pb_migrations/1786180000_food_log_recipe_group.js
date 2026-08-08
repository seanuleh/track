/// <reference path="../pb_data/types.d.ts" />

// Groups the food_logs rows created by logging a recipe, so the diary can
// collapse them back into one card instead of showing each ingredient.
//
// recipe_group is a client-generated id shared by every row from one
// logRecipe() call. recipe_name is copied at log time (not a relation to
// `recipes`) — same "expand by value" rule as everything else here: editing
// or deleting the recipe later must not change what a past day says was eaten.
migrate((db) => {
  const dao = new Dao(db)

  const foodLogs = dao.findCollectionByNameOrId('food_logs')
  foodLogs.schema.addField(new SchemaField({
    name: 'recipe_group',
    type: 'text',
    required: false,
    options: {},
  }))
  foodLogs.schema.addField(new SchemaField({
    name: 'recipe_name',
    type: 'text',
    required: false,
    options: {},
  }))
  dao.saveCollection(foodLogs)
}, (db) => {
  const dao = new Dao(db)

  const foodLogs = dao.findCollectionByNameOrId('food_logs')
  foodLogs.schema.removeField(foodLogs.schema.getFieldByName('recipe_group').id)
  foodLogs.schema.removeField(foodLogs.schema.getFieldByName('recipe_name').id)
  dao.saveCollection(foodLogs)
})
