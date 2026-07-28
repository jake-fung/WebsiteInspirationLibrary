async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

export const getHealth = () => request('/api/health');
export const listDesignTypes = () => request('/api/design-types');

export const listInspirations = (designType) =>
  request(
    '/api/inspirations' +
      (designType ? `?designType=${encodeURIComponent(designType)}` : '')
  );

export const updateInspiration = (id, fields) =>
  request(`/api/inspirations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });

export const deleteInspiration = (id) =>
  request(`/api/inspirations/${id}`, { method: 'DELETE' });

export const retryAnalysis = (id) =>
  request(`/api/inspirations/${id}/analyze`, { method: 'POST' });

export const ingestFile = (file) =>
  request('/api/ingest/file', {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });

export const ingestUrl = (url) =>
  request('/api/ingest/url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

export async function getPrompt(id) {
  const response = await fetch(`/api/inspirations/${id}/prompt`);
  if (!response.ok) throw new Error('Could not build the prompt');
  return response.text();
}

// The server stores absolute paths; the browser needs the /images route.
export const imageSrc = (imagePath) =>
  `/images/${imagePath.split('/').pop()}`;
