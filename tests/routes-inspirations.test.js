import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb, createInspiration } from '../server/lib/db.js';

let db;
let baseUrl;
let server;

beforeEach(async () => {
  db = openDb(':memory:');
  const app = createApp({
    db,
    dataDir: mkdtempSync(join(tmpdir(), 'app-')),
    client: null,
    captureFn: async () => ({ imagePath: '/tmp/x.png', facts: null }),
    analyzeFn: async () => ({}),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// node:test ignores a function returned from a hook, so the listening server
// has to be closed explicitly — otherwise open handles keep the runner alive
// and the suite hangs after the last test.
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test('GET /api/health reports whether a key is configured', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, hasApiKey: false });
});

test('GET /api/inspirations lists and filters', async () => {
  createInspiration(db, { imagePath: 'a.png', designType: 'Editorial' });
  createInspiration(db, { imagePath: 'b.png', designType: 'Brutalist' });

  const all = await (await fetch(`${baseUrl}/api/inspirations`)).json();
  assert.equal(all.length, 2);

  const filtered = await (
    await fetch(`${baseUrl}/api/inspirations?designType=Editorial`)
  ).json();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].designType, 'Editorial');
});

test('GET /api/design-types returns counts', async () => {
  createInspiration(db, { imagePath: 'a.png', designType: 'Editorial' });
  createInspiration(db, { imagePath: 'b.png', designType: 'Editorial' });
  const types = await (await fetch(`${baseUrl}/api/design-types`)).json();
  assert.deepEqual(types, [{ designType: 'Editorial', count: 2 }]);
});

test('GET /api/inspirations/:id returns 404 when missing', async () => {
  const res = await fetch(`${baseUrl}/api/inspirations/nope`);
  assert.equal(res.status, 404);
});

test('PATCH /api/inspirations/:id updates editable fields', async () => {
  const row = createInspiration(db, { imagePath: 'a.png' });
  const res = await fetch(`${baseUrl}/api/inspirations/${row.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: 'Edited', designType: 'Editorial' }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.brief, 'Edited');
  assert.equal(updated.designType, 'Editorial');
});

test('GET /api/inspirations/:id/prompt returns assembled markdown', async () => {
  const row = createInspiration(db, { imagePath: 'a.png', title: 'Kinfolk' });
  const res = await fetch(`${baseUrl}/api/inspirations/${row.id}/prompt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  assert.equal(await res.text(), '# Kinfolk\n');
});

test('DELETE /api/inspirations/:id removes the record', async () => {
  const row = createInspiration(db, { imagePath: 'a.png' });
  const res = await fetch(`${baseUrl}/api/inspirations/${row.id}`, { method: 'DELETE' });
  assert.equal(res.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/inspirations/${row.id}`)).status, 404);
});
