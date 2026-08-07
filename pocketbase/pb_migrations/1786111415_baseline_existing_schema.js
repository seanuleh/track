/// <reference path="../pb_data/types.d.ts" />

// Baseline migration.
//
// Records the schema that existed before this app moved from entrypoint.sh
// collection-creation to JS migrations. On the live DB `weight_entries` is
// already present, so this is a no-op there; on a fresh DB it recreates the
// original schema so migrations that follow have something to build on.
//
// `users` is deliberately absent: PocketBase auto-creates the built-in auth
// collection already named `users` (id `_pb_users_auth_`), which is the name
// cf-auth looks up. The old entrypoint's attempt to create a second `users`
// collection always failed silently on the name collision.
migrate((db) => {
  const dao = new Dao(db)

  let exists = true
  try {
    dao.findCollectionByNameOrId('weight_entries')
  } catch (e) {
    exists = false
  }
  if (exists) return

  const weightEntries = new Collection({
    name: 'weight_entries',
    type: 'base',
    listRule: '@request.auth.id = user',
    viewRule: '@request.auth.id = user',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id = user',
    deleteRule: '@request.auth.id = user',
    schema: [
      { name: 'date', type: 'text', required: true, options: {} },
      { name: 'weight', type: 'number', required: true, options: { min: 0, max: null, noDecimal: false } },
      { name: 'notes', type: 'text', required: false, options: {} },
      { name: 'medication', type: 'text', required: false, options: {} },
      { name: 'dose_mg', type: 'number', required: false, options: { min: 0, max: null, noDecimal: false } },
      {
        name: 'user',
        type: 'relation',
        required: true,
        options: { collectionId: '_pb_users_auth_', cascadeDelete: false, minSelect: null, maxSelect: 1, displayFields: [] },
      },
    ],
  })
  dao.saveCollection(weightEntries)
}, (db) => {
  // Down: intentionally a no-op. Reversing this would drop the live weight
  // history, and the collection predates the migration on every real DB.
})
