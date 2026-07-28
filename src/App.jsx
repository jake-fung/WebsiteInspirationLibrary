import { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Grid } from './components/Grid.jsx';
import { CaptureBar } from './components/CaptureBar.jsx';

export default function App() {
  const [items, setItems] = useState([]);
  const [types, setTypes] = useState([]);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const [nextItems, nextTypes] = await Promise.all([
      api.listInspirations(selectedType),
      api.listDesignTypes(),
    ]);
    setItems(nextItems);
    setTypes(nextTypes);
  }, [selectedType]);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);

  useEffect(() => {
    api.getHealth().then((h) => setHasApiKey(h.hasApiKey)).catch(() => {});
  }, []);

  // Poll only while something is still being analysed.
  useEffect(() => {
    if (!items.some((i) => i.status === 'analyzing')) return;
    const timer = setInterval(() => { refresh().catch(() => {}); }, 2000);
    return () => clearInterval(timer);
  }, [items, refresh]);

  const total = types.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="app">
      {!hasApiKey && (
        <div className="banner">
          No <code>ANTHROPIC_API_KEY</code> found. Capture and manual editing work
          normally — add a key to <code>.env</code> and restart to enable AI drafting.
        </div>
      )}

      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error} <span className="dismiss">dismiss</span>
        </div>
      )}

      <CaptureBar
        onCaptured={(item) => { setSelectedId(item.id); refresh().catch(() => {}); }}
        onError={setError}
      />

      <div className="layout">
        <Sidebar
          types={types}
          total={Math.max(total, items.length)}
          selected={selectedType}
          onSelect={setSelectedType}
        />
        <main className="main">
          <Grid items={items} selectedId={selectedId} onSelect={setSelectedId} />
        </main>
      </div>
    </div>
  );
}
