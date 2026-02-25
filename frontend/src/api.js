import PocketBase from 'pocketbase'

const pb = new PocketBase('/pb')
pb.autoCancellation(false)

let authToken = null

export async function initAuth() {
  const res = await fetch('/pb/api/cf-auth', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`CF auth failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  authToken = data.token
  pb.authStore.save(authToken, data.record)
  return authToken
}

export async function getEntries() {
  const records = await pb.collection('weight_entries').getFullList({
    sort: '-date',
  })
  return records
}

export async function createEntry({ date, weight, notes, medication, dose_mg }) {
  return pb.collection('weight_entries').create({
    date, weight, notes,
    medication: medication || '',
    dose_mg: dose_mg != null && medication ? Number(dose_mg) : null,
    user: pb.authStore.model.id,
  })
}

export async function updateEntry(id, { date, weight, notes, medication, dose_mg }) {
  return pb.collection('weight_entries').update(id, {
    date, weight, notes,
    medication: medication || '',
    dose_mg: dose_mg != null && medication ? Number(dose_mg) : null,
  })
}

export async function deleteEntry(id) {
  return pb.collection('weight_entries').delete(id)
}
