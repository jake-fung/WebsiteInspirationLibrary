import { useState } from 'react';
import * as api from '../api.js';

export function CaptureBar({ onCaptured, onError }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function run(work) {
    setBusy(true);
    try {
      onCaptured(await work());
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);

    const file = [...event.dataTransfer.files].find((f) =>
      f.type.startsWith('image/')
    );
    if (!file) {
      return onError('That drop had no image in it. Drop a PNG, JPG, or WebP.');
    }
    run(() => api.ingestFile(file));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setUrl('');
    run(() => api.ingestUrl(trimmed));
  }

  return (
    <form
      className={dragging ? 'capture-bar dragging' : 'capture-bar'}
      onSubmit={handleSubmit}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input
        type="text"
        value={url}
        disabled={busy}
        placeholder={
          busy ? 'Capturing…' : 'Drop an image, or paste a URL and press Enter…'
        }
        onChange={(e) => setUrl(e.target.value)}
      />
    </form>
  );
}
