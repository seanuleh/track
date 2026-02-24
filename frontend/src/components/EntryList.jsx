export default function EntryList({ entries, onEdit, onDelete }) {
  if (entries.length === 0) return null

  return (
    <div className="entry-list">
      {entries.map(entry => (
        <div key={entry.id} className="entry-card">
          <div className="entry-weight">
            {parseFloat(entry.weight).toFixed(1)}<span> kg</span>
          </div>
          <div className="entry-meta">
            <div className="entry-date">{entry.date}</div>
            {entry.notes && <div className="entry-notes">{entry.notes}</div>}
          </div>
          <div className="entry-actions">
            <button className="icon-btn" onClick={() => onEdit(entry)} title="Edit">✎</button>
            <button className="icon-btn danger" onClick={() => onDelete(entry.id)} title="Delete">✕</button>
          </div>
        </div>
      ))}
    </div>
  )
}
