import { useState, useEffect, useRef, useCallback } from 'react'

const PAGE_SIZE = 20

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function IconEdit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

function EntryCard({ entry, onEdit, onDelete }) {
  const [actionsVisible, setActionsVisible] = useState(false)
  const cardRef = useRef(null)

  // On touch devices, tap the row to reveal actions, tap outside to hide
  useEffect(() => {
    if (!actionsVisible) return
    function handleOutside(e) {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        setActionsVisible(false)
      }
    }
    document.addEventListener('touchstart', handleOutside)
    return () => document.removeEventListener('touchstart', handleOutside)
  }, [actionsVisible])

  return (
    <div
      ref={cardRef}
      className={`entry-card${actionsVisible ? ' actions-visible' : ''}`}
      onTouchEnd={(e) => {
        // Only toggle if touch didn't land on a button
        if (e.target.closest('.icon-btn')) return
        setActionsVisible(v => !v)
      }}
    >
      <div className="entry-meta">
        <div className="entry-date">{formatDate(entry.date)}</div>
        {entry.notes && <div className="entry-notes">{entry.notes}</div>}
      </div>
      <div className="entry-weight">
        {parseFloat(entry.weight).toFixed(1)}<span>kg</span>
      </div>
      <div className="entry-actions">
        <button className="icon-btn" onClick={() => onEdit(entry)} title="Edit">
          <IconEdit />
        </button>
        <button className="icon-btn danger" onClick={() => onDelete(entry.id)} title="Delete">
          <IconTrash />
        </button>
      </div>
    </div>
  )
}

export default function EntryList({ entries, onEdit, onDelete }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef(null)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [entries])

  const loadMore = useCallback(() => {
    setVisibleCount(n => Math.min(n + PAGE_SIZE, entries.length))
  }, [entries.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '120px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadMore])

  if (entries.length === 0) return null

  const visible = entries.slice(0, visibleCount)
  const hasMore = visibleCount < entries.length

  return (
    <>
      <div className="entry-list">
        {visible.map(entry => (
          <EntryCard key={entry.id} entry={entry} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="load-more-sentinel" />}
    </>
  )
}
