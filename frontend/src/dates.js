// Dates are handled throughout as local `YYYY-MM-DD` strings: an entry belongs
// to the day you were living, not the UTC day.
//
// `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong
// anywhere east of Greenwich. In AEST (UTC+10/+11) it reports yesterday's date
// for the first 10-11 hours of every local day, and it breaks day-stepping
// outright: converting local midnight to UTC lands in the previous day, so
// stepping forward returned the same date and stepping back skipped two.

/** Format a Date as a local `YYYY-MM-DD` string. */
export function toLocalISO(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Today's date, in the viewer's timezone. */
export function today() {
  return toLocalISO(new Date())
}

/** Move a `YYYY-MM-DD` string by whole days, staying in local time. */
export function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00') // parsed as local midnight
  d.setDate(d.getDate() + days)
  return toLocalISO(d)
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function ordinal(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** Format a `YYYY-MM-DD` string as "Mon, 1st Jan 2026" — the diary's date label. */
export function formatDisplayDate(date) {
  const d = new Date(date + 'T00:00:00') // parsed as local midnight
  return `${WEEKDAYS[d.getDay()]}, ${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
