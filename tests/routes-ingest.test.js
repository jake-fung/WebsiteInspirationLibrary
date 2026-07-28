import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb, getInspiration } from '../server/lib/db.js';

let db, app, baseUrl, server, analyzeCalls, analyzeImpl;

const RESULT = {
  designType: 'Editorial', title: 'Kinfolk', brief: 'b',
  aesthetics: 'a', reference: 'r', intent: 'i',
};

beforeEach(async () => {
  db = openDb(':memory:');
  analyzeCalls = [];
  analyzeImpl = async (args) => { analyzeCalls.push(args); return RESULT; };

  const dataDir = mkdtempSync(join(tmpdir(), 'app-'));
  mkdirSync(join(dataDir, 'images'), { recursive: true });

  app = createApp({
    db,
    dataDir,
    client: {},
    captureFn: async (url, { outDir, id }) => ({
      imagePath: join(outDir, `${id}.png`),
      facts: { colors: { background: '#faf9f7' } },
    }),
    analyzeFn: (args) => analyzeImpl(args),
  });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// node:test ignores a function returned from a hook, so the listening server
// has to be closed explicitly — otherwise open handles keep the runner alive
// and the suite hangs after the last test.
afterEach(async () => {
  // Settle first so no background analysis writes to a closed database, but
  // close in a finally — a teardown that throws before closing leaks the
  // listening server and hangs the runner.
  try {
    await app.locals.settleAnalysis();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

// Ingest returns before analysis finishes. Await the queue rather than
// sleeping, so the test is deterministic under load.
const settle = () => app.locals.settleAnalysis();

test('POST /api/ingest/file stores the image and returns immediately', async () => {
  const res = await fetch(`${baseUrl}/api/ingest/file`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('png-bytes'),
  });

  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.status, 'analyzing', 'must not block on analysis');
  assert.ok(existsSync(row.imagePath));
});

test('background analysis fills the fields and flips status to ready', async () => {
  const res = await fetch(`${baseUrl}/api/ingest/file`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('png-bytes'),
  });
  const { id } = await res.json();
  await settle();

  const row = getInspiration(db, id);
  assert.equal(row.status, 'ready');
  assert.equal(row.designType, 'Editorial');
  assert.equal(row.title, 'Kinfolk');
});

test('a failed analysis marks the record without losing the image', async () => {
  analyzeImpl = async () => { throw new Error('Claude exploded'); };

  const res = await fetch(`${baseUrl}/api/ingest/file`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('png-bytes'),
  });
  const { id, imagePath } = await res.json();
  await settle();

  const row = getInspiration(db, id);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /Claude exploded/);
  assert.ok(existsSync(imagePath), 'the captured image must survive analysis failure');
});

test('POST /api/ingest/file rejects a non-image content-type', async () => {
  const res = await fetch(`${baseUrl}/api/ingest/file`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'nope',
  });
  assert.equal(res.status, 400);
});

test('POST /api/ingest/url routes a site URL through capture and keeps facts', async () => {
  const res = await fetch(`${baseUrl}/api/ingest/url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://kinfolk.com' }),
  });

  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.sourceUrl, 'https://kinfolk.com');
  assert.deepEqual(row.extractedFacts, { colors: { background: '#faf9f7' } });

  await settle();
  assert.deepEqual(
    analyzeCalls[0].facts,
    { colors: { background: '#faf9f7' } },
    'facts must be passed to the analyzer as ground truth'
  );
});

test('POST /api/ingest/url rejects a missing url', async () => {
  const res = await fetch(`${baseUrl}/api/ingest/url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('POST /api/inspirations/:id/analyze retries a failed record', async () => {
  analyzeImpl = async () => { throw new Error('transient'); };
  const created = await (
    await fetch(`${baseUrl}/api/ingest/file`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('png-bytes'),
    })
  ).json();
  await settle();
  assert.equal(getInspiration(db, created.id).status, 'failed');

  analyzeImpl = async () => RESULT;
  const res = await fetch(`${baseUrl}/api/inspirations/${created.id}/analyze`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);

  const row = await res.json();
  assert.equal(row.status, 'ready');
  assert.equal(row.designType, 'Editorial');
  assert.equal(row.error, null);
});
