// Color palettes for medication/dose combos — ordered by dose ascending
// Mounjaro: green → yellow → orange → red (warm progression, high contrast between doses)
// WeGovy:   violet → purple → pink (cool/purple family)
// None:     neutral slate

const MOUNJARO_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899', '#a855f7']
const WEGOVY_COLORS   = ['#818cf8', '#a855f7', '#ec4899', '#e879f9', '#c084fc', '#7c3aed']
export const NO_MED_COLOR = '#94a3b8'

export function buildColorMap(entries) {
  const mounjaroDoses = [...new Set(
    entries.filter(e => e.medication === 'Mounjaro' && e.dose_mg != null).map(e => Number(e.dose_mg))
  )].sort((a, b) => a - b)

  const wegovyDoses = [...new Set(
    entries.filter(e => e.medication === 'WeGovy' && e.dose_mg != null).map(e => Number(e.dose_mg))
  )].sort((a, b) => a - b)

  const map = { '': NO_MED_COLOR }
  mounjaroDoses.forEach((dose, i) => {
    map[`Mounjaro|${dose}`] = MOUNJARO_COLORS[i % MOUNJARO_COLORS.length]
  })
  wegovyDoses.forEach((dose, i) => {
    map[`WeGovy|${dose}`] = WEGOVY_COLORS[i % WEGOVY_COLORS.length]
  })
  return map
}

export function getMedKey(entry) {
  if (!entry?.medication) return ''
  return `${entry.medication}|${Number(entry.dose_mg)}`
}

export function formatMedLabel(key) {
  if (!key) return 'No medication'
  const [med, dose] = key.split('|')
  return `${med} ${dose} mg`
}
