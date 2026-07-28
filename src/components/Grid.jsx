import { imageSrc } from '../api.js';

function Card({ item, isSelected, onSelect }) {
  return (
    <button
      className={isSelected ? 'card selected' : 'card'}
      onClick={() => onSelect(item.id)}
    >
      <img src={imageSrc(item.imagePath)} alt={item.title || 'Inspiration'} />

      <div className="card-meta">
        <span className="card-title">{item.title || 'Untitled'}</span>
        {item.status === 'analyzing' && <span className="badge">analyzing…</span>}
        {item.status === 'failed' && <span className="badge failed">failed</span>}
        {item.status === 'ready' && item.designType && (
          <span className="badge">{item.designType}</span>
        )}
      </div>
    </button>
  );
}

export function Grid({ items, selectedId, onSelect }) {
  if (items.length === 0) {
    return (
      <p className="empty">
        Nothing here yet. Drop an image above, or paste a URL.
      </p>
    );
  }

  return (
    <div className="grid">
      {items.map((item) => (
        <Card
          key={item.id}
          item={item}
          isSelected={item.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
