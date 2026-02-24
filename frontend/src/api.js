import PocketBase from 'pocketbase'

const pb = new PocketBase('/pb')
pb.autoCancellation(false)

let authToken = null

export async function initAuth() {
  const config = window.__CONFIG__ || {}
  const email = config.PB_ADMIN_EMAIL
  const password = config.PB_ADMIN_PASSWORD

  if (!email || !password) {
    throw new Error('Missing PocketBase credentials in window.__CONFIG__')
  }

  const auth = await pb.admins.authWithPassword(email, password)
  authToken = auth.token
  return authToken
}

export async function getEntries() {
  const records = await pb.collection('weight_entries').getFullList({
    sort: '-date',
  })
  return records
}

export async function createEntry({ date, weight, notes }) {
  return pb.collection('weight_entries').create({ date, weight, notes })
}

export async function updateEntry(id, { date, weight, notes }) {
  return pb.collection('weight_entries').update(id, { date, weight, notes })
}

export async function deleteEntry(id) {
  return pb.collection('weight_entries').delete(id)
}
