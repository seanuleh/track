import { useState, useEffect, useRef } from 'react'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function DateRangePicker({ startDate, endDate, onApply, onClose }) {
  const [start, setStart] = useState(startDate || '')
  const [end, setEnd] = useState(endDate || today())
  const ref = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  function handleApply() {
    if (!start || !end) return
    onApply(start, end)
  }

  return (
    <div className="date-range-popover" ref={ref}>
      <div className="date-range-title">Custom Range</div>
      <div className="date-range-fields">
        <div className="date-range-field">
          <label className="form-label">From</label>
          <input
            className="form-input"
            type="date"
            value={start}
            max={end || today()}
            onChange={e => setStart(e.target.value)}
          />
        </div>
        <div className="date-range-field">
          <label className="form-label">To</label>
          <input
            className="form-input"
            type="date"
            value={end}
            min={start}
            max={today()}
            onChange={e => setEnd(e.target.value)}
          />
        </div>
      </div>
      <div className="date-range-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={handleApply} disabled={!start || !end}>Apply</button>
      </div>
    </div>
  )
}
