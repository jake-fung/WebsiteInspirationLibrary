import { useEffect, useState } from 'react';
import * as api from '../api.js';

const FIELDS = [
  ['title', 'Title', 'input'],
  ['designType', 'Design type', 'type-input'],
  ['brief', 'Brief', 'textarea'],
  ['aesthetics', 'Aesthetics', 'textarea'],
  ['reference', 'Reference', 'textarea'],
  ['intent', 'Intent', 'textarea'],
];

export function DetailPanel({ item, knownTypes, onChanged, onClose, onError }) {
  const [draft, setDraft] = useState(item);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setDraft(item); setCopied(false); }, [item]);

  async function saveField(key) {
    if (draft[key] === item[key]) return;
    try {
      onChanged(await api.updateInspiration(item.id, { [key]: draft[key] }));
    } catch (err) {
      onError(err.message);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(await api.getPrompt(item.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      onError(err.message);
    }
  }

  async function retry() {
    try {
      onChanged(await api.retryAnalysis(item.id));
    } catch (err) {
      onError(err.message);
    }
  }

  async function remove() {
    try {
      await api.deleteInspiration(item.id);
      onClose();
      onChanged(null);
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <aside className="detail">
      <div className="detail-head">
        <button className="link" onClick={onClose}>close</button>
        <div className="detail-actions">
          {item.status !== 'analyzing' && (
            <button className="link" onClick={retry}>retry analysis</button>
          )}
          <button className="link danger" onClick={remove}>delete</button>
        </div>
      </div>

      <img className="detail-image" src={api.imageSrc(item.imagePath)} alt="" />

      {item.status === 'failed' && (
        <p className="detail-error">Analysis failed: {item.error}</p>
      )}
      {item.status === 'analyzing' && <p className="detail-note">Analyzing…</p>}

      <datalist id="known-types">
        {knownTypes.map(({ designType }) => (
          <option key={designType} value={designType} />
        ))}
      </datalist>

      {FIELDS.map(([key, label, kind]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          {kind === 'textarea' ? (
            <textarea
              rows={4}
              value={draft[key] ?? ''}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              onBlur={() => saveField(key)}
            />
          ) : (
            <input
              type="text"
              list={kind === 'type-input' ? 'known-types' : undefined}
              value={draft[key] ?? ''}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              onBlur={() => saveField(key)}
            />
          )}
        </label>
      ))}

      <button className="copy" onClick={copyPrompt}>
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
    </aside>
  );
}
