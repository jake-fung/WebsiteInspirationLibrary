export function Sidebar({ types, selected, total, onSelect }) {
  return (
    <nav className="sidebar">
      <button
        className={selected === null ? 'type-row active' : 'type-row'}
        onClick={() => onSelect(null)}
      >
        <span>All</span>
        <span className="count">{total}</span>
      </button>

      {types.map(({ designType, count }) => (
        <button
          key={designType}
          className={selected === designType ? 'type-row active' : 'type-row'}
          onClick={() => onSelect(designType)}
        >
          <span>{designType}</span>
          <span className="count">{count}</span>
        </button>
      ))}
    </nav>
  );
}
