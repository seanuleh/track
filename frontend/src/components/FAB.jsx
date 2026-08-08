import { useState } from 'react'

/**
 * Plain FAB when `onClick` is given. With `actions` instead, it becomes a
 * speed-dial: tapping it reveals a stack of labelled mini-buttons above it,
 * one per action, and picking one (or tapping the backdrop) closes it again.
 */
export default function FAB({ onClick, actions }) {
  const [open, setOpen] = useState(false)

  if (!actions) {
    return (
      <button className="fab" onClick={onClick} aria-label="Add entry">
        +
      </button>
    )
  }

  return (
    <>
      {open && <div className="fab-backdrop" onClick={() => setOpen(false)} />}
      <div className="fab-menu">
        {open && actions.map((a, i) => (
          <button
            key={a.label}
            className="fab-action"
            style={{ bottom: `${32 + (i + 1) * 60}px` }}
            onClick={() => { setOpen(false); a.onClick() }}
          >
            {a.label}
          </button>
        ))}
        <button
          className="fab"
          onClick={() => setOpen(o => !o)}
          aria-label="Add food"
        >
          {open ? '✕' : '+'}
        </button>
      </div>
    </>
  )
}
