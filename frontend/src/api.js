import PocketBase from 'pocketbase'

const pb = new PocketBase('/')
pb.autoCancellation(false)

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
