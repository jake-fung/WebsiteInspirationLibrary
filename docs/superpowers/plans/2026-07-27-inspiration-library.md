# Website Inspiration Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only web app that captures website design inspiration (dropped images, image URLs, live site URLs), drafts a brief and an aesthetics/reference/intent prompt with Claude, and lets you copy that prompt into another Claude Code session.

**Architecture:** Two processes under one `npm run dev` — an Express backend owning Playwright, the Anthropic SDK, and file/DB writes; a Vite + React frontend. Three ingest paths converge on the same shape (a local image file plus optional extracted facts), then a single vision call produces validated JSON. Analysis runs in the background so capture is never blocking.

**Tech Stack:** Node 24 (ESM), Express 5, Playwright (chromium), `node:sqlite`, `@anthropic-ai/sdk`, Vite + React, `node:test` for tests.

## Global Constraints

- **Node >= 24.** Required for built-in `node:sqlite`. Verified present on this machine (v24.15.0).
- **ESM everywhere.** `package.json` sets `"type": "module"`. No `require()`, no `__dirname` — derive paths from `import.meta.url`.
- **Model ID is exactly `claude-opus-5`.** Never append a date suffix.
- **`max_tokens: 24000`, non-streaming, `thinking: {type: 'adaptive'}` with `effort: 'low'`.** On `claude-opus-5` thinking is on by default and `max_tokens` caps thinking **plus** response text together. Describing a design is a perception task, not deep reasoning, so low effort keeps the spend down while leaving ample headroom for the JSON. A `stop_reason === 'max_tokens'` response must be reported as truncation, never as malformed JSON.
- **Zero test dependencies.** `node:test` + `node:assert/strict` only. No jest, vitest, or supertest.
- **No native-compilation dependencies.** This is why `node:sqlite` is used instead of `better-sqlite3`.
- **JS objects use camelCase; SQL columns use snake_case.** `db.js` is the only module that knows about snake_case — it maps at the boundary.
- **`extractedFacts` is stored and sent to Claude, but never appears in copy output.** Facts make the generated prose concrete; they are not dumped raw.
- **Copy output shape is fixed** (see Task 1). `prompt.js` is the single source of truth — the frontend never assembles markdown itself.

**Deliberate refinement of the spec:** the spec listed `server/index.js` as the Express app. This plan splits it into `server/app.js` (a `createApp({...})` factory taking injected dependencies) and `server/index.js` (which listens). This is required to test routes without starting a real server or calling the real Anthropic API.

## File Structure

| File | Responsibility |
|---|---|
| `server/lib/prompt.js` | Pure function: inspiration → copy-output markdown |
| `server/lib/db.js` | All SQL. Schema, CRUD, camelCase mapping. No other module writes queries. |
| `server/lib/analyze.js` | All Anthropic API calls. Knows nothing about HTTP or storage. |
| `server/lib/capture.js` | All Playwright. Screenshot + DOM fact extraction. Knows nothing about DB or Claude. |
| `server/lib/images.js` | Saving image bytes/URLs to disk, media-type resolution |
| `server/app.js` | `createApp(deps)` factory — routes wired to injected dependencies |
| `server/index.js` | Reads env, opens real DB, starts listening |
| `server/routes/inspirations.js` | CRUD + prompt endpoint |
| `server/routes/ingest.js` | File upload, image URL, site URL, URL sniffing |
| `server/routes/analyze.js` | Retry-analysis endpoint |
| `src/api.js` | Frontend HTTP client. Single place that knows endpoint paths. |
| `src/App.jsx` | Layout shell, polling for `analyzing` records, API-key banner |
| `src/components/CaptureBar.jsx` | Drop target + URL paste |
| `src/components/Sidebar.jsx` | Design-type list with counts |
| `src/components/Grid.jsx` | Card grid, including `analyzing` and `failed` states |
| `src/components/DetailPanel.jsx` | Editable fields + Copy prompt |

---

### Task 1: Project scaffold and `prompt.js`

Scaffolding folds into this task because `prompt.js` is the first thing that needs a package and a test runner.

**Files:**
- Create: `package.json`, `.env.example`, `server/lib/prompt.js`, `tests/prompt.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `toMarkdown(inspiration) -> string` where `inspiration` is `{title, brief, aesthetics, reference, intent}` (all strings, any may be empty)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "website-inspiration-library",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "concurrently -n server,web -c blue,green \"npm run dev:server\" \"npm run dev:web\"",
    "dev:server": "node --watch server/index.js",
    "dev:web": "vite",
    "build": "vite build",
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```bash
# Get a key at https://console.anthropic.com/settings/keys
# The app runs without this — capture and manual editing work,
# only AI drafting is disabled.
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: Write the failing test**

Create `tests/prompt.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown } from '../server/lib/prompt.js';

const full = {
  title: 'Kinfolk',
  brief: 'Editorial minimalism with generous whitespace.',
  aesthetics: 'Warm off-white, serif display type.',
  reference: 'kinfolk.com hero and article index.',
  intent: 'Feels unhurried and considered.',
};

test('renders every section in order', () => {
  assert.equal(
    toMarkdown(full),
    '# Kinfolk\n\n' +
      'Editorial minimalism with generous whitespace.\n\n' +
      '## Aesthetics\nWarm off-white, serif display type.\n\n' +
      '## Reference\nkinfolk.com hero and article index.\n\n' +
      '## Intent\nFeels unhurried and considered.\n'
  );
});

test('omits sections that are empty or whitespace', () => {
  const md = toMarkdown({ ...full, reference: '', intent: '   ' });
  assert.ok(md.includes('## Aesthetics'));
  assert.ok(!md.includes('## Reference'));
  assert.ok(!md.includes('## Intent'));
});

test('falls back to Untitled when title is blank', () => {
  assert.ok(toMarkdown({ ...full, title: '' }).startsWith('# Untitled\n'));
});

test('a fully blank inspiration still produces a valid heading', () => {
  assert.equal(toMarkdown({}), '# Untitled\n');
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tests/prompt.test.js`
Expected: FAIL — `Cannot find module '.../server/lib/prompt.js'`

- [ ] **Step 5: Write the implementation**

Create `server/lib/prompt.js`:

```js
const SECTIONS = [
  ['Aesthetics', 'aesthetics'],
  ['Reference', 'reference'],
  ['Intent', 'intent'],
];

/**
 * Assemble the copy-output markdown for an inspiration.
 * This is the single source of truth for copy shape — the frontend
 * fetches this rather than building markdown itself.
 */
export function toMarkdown(inspiration = {}) {
  const title = String(inspiration.title || '').trim() || 'Untitled';
  const parts = [`# ${title}`];

  const brief = String(inspiration.brief || '').trim();
  if (brief) parts.push(brief);

  for (const [heading, key] of SECTIONS) {
    const value = String(inspiration[key] || '').trim();
    if (value) parts.push(`## ${heading}\n${value}`);
  }

  return parts.join('\n\n') + '\n';
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/prompt.test.js`
Expected: PASS — 4 tests passing

- [ ] **Step 7: Commit**

```bash
git add package.json .env.example server/lib/prompt.js tests/prompt.test.js
git commit -m "feat: project scaffold and copy-output markdown assembly"
```

---

### Task 2: `db.js` — schema and queries

**Files:**
- Create: `server/lib/db.js`, `tests/db.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `openDb(path) -> DatabaseSync` (pass `':memory:'` in tests)
  - `createInspiration(db, {imagePath, sourceUrl?, designType?, title?, extractedFacts?, status?}) -> inspiration`
  - `listInspirations(db, {designType?} = {}) -> inspiration[]` (newest first)
  - `getInspiration(db, id) -> inspiration | undefined`
  - `updateInspiration(db, id, fields) -> inspiration | undefined`
  - `deleteInspiration(db, id) -> boolean`
  - `listDesignTypes(db) -> [{designType, count}]`
  - An `inspiration` is `{id, designType, title, sourceUrl, imagePath, brief, aesthetics, reference, intent, extractedFacts, status, error, createdAt}`. `extractedFacts` is a parsed object or `null`. `status` is `'analyzing' | 'ready' | 'failed'`.

- [ ] **Step 1: Write the failing test**

Create `tests/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDb, createInspiration, listInspirations, getInspiration,
  updateInspiration, deleteInspiration, listDesignTypes,
} from '../server/lib/db.js';

function freshDb() {
  return openDb(':memory:');
}

test('createInspiration returns a full record with defaults', () => {
  const db = freshDb();
  const row = createInspiration(db, { imagePath: 'images/a.png' });

  assert.ok(row.id);
  assert.equal(row.imagePath, 'images/a.png');
  assert.equal(row.status, 'analyzing');
  assert.equal(row.designType, '');
  assert.equal(row.brief, '');
  assert.equal(row.extractedFacts, null);
  assert.ok(row.createdAt);
});

test('extractedFacts round-trips as an object', () => {
  const db = freshDb();
  const facts = { colors: { background: '#fff' } };
  const created = createInspiration(db, { imagePath: 'a.png', extractedFacts: facts });
  assert.deepEqual(created.extractedFacts, facts);
  assert.deepEqual(getInspiration(db, created.id).extractedFacts, facts);
});

test('listInspirations filters by designType', () => {
  const db = freshDb();
  createInspiration(db, { imagePath: 'a.png', designType: 'Editorial' });
  createInspiration(db, { imagePath: 'b.png', designType: 'Brutalist' });

  assert.equal(listInspirations(db).length, 2);
  const editorial = listInspirations(db, { designType: 'Editorial' });
  assert.equal(editorial.length, 1);
  assert.equal(editorial[0].imagePath, 'a.png');
});

test('updateInspiration writes whitelisted fields and ignores unknown ones', () => {
  const db = freshDb();
  const row = createInspiration(db, { imagePath: 'a.png' });

  const updated = updateInspiration(db, row.id, {
    brief: 'A brief',
    designType: 'Editorial',
    status: 'ready',
    id: 'hacked',
    nonsense: 'ignored',
  });

  assert.equal(updated.brief, 'A brief');
  assert.equal(updated.designType, 'Editorial');
  assert.equal(updated.status, 'ready');
  assert.equal(updated.id, row.id, 'id must not be overwritable');
});

test('updateInspiration returns undefined for an unknown id', () => {
  const db = freshDb();
  assert.equal(updateInspiration(db, 'nope', { brief: 'x' }), undefined);
});

test('listDesignTypes counts and skips blanks', () => {
  const db = freshDb();
  createInspiration(db, { imagePath: 'a.png', designType: 'Editorial' });
  createInspiration(db, { imagePath: 'b.png', designType: 'Editorial' });
  createInspiration(db, { imagePath: 'c.png', designType: 'Brutalist' });
  createInspiration(db, { imagePath: 'd.png' });

  assert.deepEqual(listDesignTypes(db), [
    { designType: 'Editorial', count: 2 },
    { designType: 'Brutalist', count: 1 },
  ]);
});

test('deleteInspiration removes the row', () => {
  const db = freshDb();
  const row = createInspiration(db, { imagePath: 'a.png' });
  assert.equal(deleteInspiration(db, row.id), true);
  assert.equal(getInspiration(db, row.id), undefined);
  assert.equal(deleteInspiration(db, row.id), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `Cannot find module '.../server/lib/db.js'`

- [ ] **Step 3: Write the implementation**

Create `server/lib/db.js`:

```js
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inspirations (
  id              TEXT PRIMARY KEY,
  design_type     TEXT NOT NULL DEFAULT '',
  title           TEXT NOT NULL DEFAULT '',
  source_url      TEXT,
  image_path      TEXT NOT NULL,
  brief           TEXT NOT NULL DEFAULT '',
  aesthetics      TEXT NOT NULL DEFAULT '',
  reference       TEXT NOT NULL DEFAULT '',
  intent          TEXT NOT NULL DEFAULT '',
  extracted_facts TEXT,
  status          TEXT NOT NULL DEFAULT 'analyzing',
  error           TEXT,
  created_at      TEXT NOT NULL
);
`;

// Only these may be written by updateInspiration. Keeping this list
// explicit is what stops a request body from overwriting `id`.
const UPDATABLE = new Set([
  'designType', 'title', 'brief', 'aesthetics',
  'reference', 'intent', 'status', 'error', 'extractedFacts',
]);

const COLUMN = {
  designType: 'design_type',
  title: 'title',
  brief: 'brief',
  aesthetics: 'aesthetics',
  reference: 'reference',
  intent: 'intent',
  status: 'status',
  error: 'error',
  extractedFacts: 'extracted_facts',
};

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

function toInspiration(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    designType: row.design_type,
    title: row.title,
    sourceUrl: row.source_url,
    imagePath: row.image_path,
    brief: row.brief,
    aesthetics: row.aesthetics,
    reference: row.reference,
    intent: row.intent,
    extractedFacts: row.extracted_facts ? JSON.parse(row.extracted_facts) : null,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function createInspiration(db, input) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO inspirations
       (id, design_type, title, source_url, image_path, extracted_facts, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.designType ?? '',
    input.title ?? '',
    input.sourceUrl ?? null,
    input.imagePath,
    input.extractedFacts ? JSON.stringify(input.extractedFacts) : null,
    input.status ?? 'analyzing',
    new Date().toISOString()
  );
  return getInspiration(db, id);
}

export function listInspirations(db, { designType } = {}) {
  const rows = designType
    ? db.prepare(
        'SELECT * FROM inspirations WHERE design_type = ? ORDER BY created_at DESC'
      ).all(designType)
    : db.prepare('SELECT * FROM inspirations ORDER BY created_at DESC').all();
  return rows.map(toInspiration);
}

export function getInspiration(db, id) {
  return toInspiration(db.prepare('SELECT * FROM inspirations WHERE id = ?').get(id));
}

export function updateInspiration(db, id, fields) {
  if (!getInspiration(db, id)) return undefined;

  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!UPDATABLE.has(key)) continue;
    sets.push(`${COLUMN[key]} = ?`);
    values.push(
      key === 'extractedFacts'
        ? (value ? JSON.stringify(value) : null)
        : (value ?? null)
    );
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE inspirations SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values, id);
  }
  return getInspiration(db, id);
}

export function deleteInspiration(db, id) {
  return db.prepare('DELETE FROM inspirations WHERE id = ?').run(id).changes > 0;
}

export function listDesignTypes(db) {
  return db.prepare(
    `SELECT design_type AS designType, COUNT(*) AS count
       FROM inspirations
      WHERE design_type <> ''
      GROUP BY design_type
      ORDER BY count DESC, design_type ASC`
  ).all().map((r) => ({ designType: r.designType, count: Number(r.count) }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add server/lib/db.js tests/db.test.js
git commit -m "feat: sqlite schema and inspiration queries"
```

---

### Task 3: `analyze.js` — Claude vision call with structured output

**Files:**
- Create: `server/lib/analyze.js`, `tests/analyze.test.js`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `createClient() -> Anthropic | null` (returns `null` when `ANTHROPIC_API_KEY` is unset)
  - `mediaTypeFor(filePath) -> string` (throws on unsupported extension)
  - `analyzeImage({imagePath, facts, client}) -> {designType, title, brief, aesthetics, reference, intent}`
  - `ANALYSIS_SCHEMA` — the JSON Schema object passed to `output_config.format`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: adds `@anthropic-ai/sdk` to dependencies

- [ ] **Step 2: Write the failing test**

Create `tests/analyze.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImage, mediaTypeFor, ANALYSIS_SCHEMA } from '../server/lib/analyze.js';

function tempImage(name = 'shot.png') {
  const dir = mkdtempSync(join(tmpdir(), 'insp-'));
  const file = join(dir, name);
  writeFileSync(file, Buffer.from('fake-png-bytes'));
  return file;
}

const GOOD_RESULT = {
  designType: 'Editorial',
  title: 'Kinfolk',
  brief: 'Editorial minimalism.',
  aesthetics: 'Warm off-white #FAF9F7, serif display.',
  reference: 'Hero and article index.',
  intent: 'Unhurried and considered.',
};

function stubClient(response) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return response;
      },
    },
  };
}

const okResponse = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(GOOD_RESULT) }],
};

test('mediaTypeFor maps known extensions', () => {
  assert.equal(mediaTypeFor('a.png'), 'image/png');
  assert.equal(mediaTypeFor('a.JPG'), 'image/jpeg');
  assert.equal(mediaTypeFor('a.jpeg'), 'image/jpeg');
  assert.equal(mediaTypeFor('a.webp'), 'image/webp');
  assert.throws(() => mediaTypeFor('a.bmp'), /Unsupported image type/);
});

test('analyzeImage returns the parsed structured result', async () => {
  const client = stubClient(okResponse);
  const result = await analyzeImage({ imagePath: tempImage(), client });
  assert.deepEqual(result, GOOD_RESULT);
});

test('analyzeImage sends the image, the model, and the schema', async () => {
  const client = stubClient(okResponse);
  await analyzeImage({ imagePath: tempImage(), client });

  const params = client.calls[0];
  assert.equal(params.model, 'claude-opus-5');
  assert.equal(params.max_tokens, 24000);
  assert.deepEqual(params.thinking, { type: 'adaptive' });
  assert.equal(params.output_config.effort, 'low');
  assert.deepEqual(params.output_config.format.schema, ANALYSIS_SCHEMA);

  const blocks = params.messages[0].content;
  const image = blocks.find((b) => b.type === 'image');
  assert.equal(image.source.media_type, 'image/png');
  assert.equal(image.source.type, 'base64');
  assert.ok(image.source.data.length > 0);
});

test('analyzeImage includes extracted facts in the prompt when present', async () => {
  const client = stubClient(okResponse);
  await analyzeImage({
    imagePath: tempImage(),
    facts: { colors: { background: '#FAF9F7' } },
    client,
  });

  const text = client.calls[0].messages[0].content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  assert.ok(text.includes('#FAF9F7'), 'facts should be passed as ground truth');
});

test('analyzeImage throws a clear error on refusal', async () => {
  const client = stubClient({
    stop_reason: 'refusal',
    stop_details: { category: 'cyber' },
    content: [],
  });
  await assert.rejects(
    () => analyzeImage({ imagePath: tempImage(), client }),
    /declined to analyze this image \(cyber\)/
  );
});

test('analyzeImage reports truncation as truncation, not bad JSON', async () => {
  // Thinking shares the max_tokens budget, so a long think can truncate the
  // JSON. That must not be reported as malformed output.
  const client = stubClient({
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: '{"designType": "Edit' }],
  });
  await assert.rejects(
    () => analyzeImage({ imagePath: tempImage(), client }),
    /ran out of output budget/
  );
});

test('analyzeImage throws when no client is configured', async () => {
  await assert.rejects(
    () => analyzeImage({ imagePath: tempImage(), client: null }),
    /ANTHROPIC_API_KEY/
  );
});

test('analyzeImage throws a clear error on unparseable output', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'not json at all' }],
  });
  await assert.rejects(
    () => analyzeImage({ imagePath: tempImage(), client }),
    /did not return valid JSON/
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/analyze.test.js`
Expected: FAIL — `Cannot find module '.../server/lib/analyze.js'`

- [ ] **Step 4: Write the implementation**

Create `server/lib/analyze.js`:

```js
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    designType: {
      type: 'string',
      description:
        'A short design-category label, 1-3 words, title case. ' +
        'For example: Editorial, Brutalist, SaaS Landing, Portfolio, Agency.',
    },
    title: {
      type: 'string',
      description: 'A short name for this reference — the brand or site name if visible.',
    },
    brief: {
      type: 'string',
      description: 'Two or three sentences summarising what this design is and does.',
    },
    aesthetics: {
      type: 'string',
      description:
        'The concrete visual language: typography, colour, spacing, imagery, motion. ' +
        'Name specific fonts and hex values when they are known.',
    },
    reference: {
      type: 'string',
      description: 'What specifically to borrow from this design, and which parts of the page.',
    },
    intent: {
      type: 'string',
      description: 'How the site feels and what that feeling is doing for its audience.',
    },
  },
  required: ['designType', 'title', 'brief', 'aesthetics', 'reference', 'intent'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You analyse website designs for a designer's inspiration library.

Write the aesthetics, reference, and intent fields as prose that will be pasted
directly into a coding session as build instructions. Be concrete and specific:
name typefaces, hex values, spacing rhythm, and layout structure rather than
using vague adjectives. Write in the present tense and avoid hedging.

When measured facts about the page are supplied, treat them as ground truth and
use those exact values rather than estimating from the image.`;

export function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

export function mediaTypeFor(filePath) {
  const type = MEDIA_TYPES[extname(filePath).toLowerCase()];
  if (!type) throw new Error(`Unsupported image type: ${extname(filePath) || filePath}`);
  return type;
}

function factsBlock(facts) {
  if (!facts) return null;
  return {
    type: 'text',
    text:
      'Measured facts extracted from the live page (ground truth):\n' +
      '```json\n' +
      JSON.stringify(facts, null, 2) +
      '\n```',
  };
}

export async function analyzeImage({ imagePath, facts = null, client }) {
  if (!client) {
    throw new Error(
      'No Anthropic client configured. Set ANTHROPIC_API_KEY in .env to enable AI drafting.'
    );
  }

  const data = (await readFile(imagePath)).toString('base64');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: mediaTypeFor(imagePath), data } },
  ];

  const block = factsBlock(facts);
  if (block) content.push(block);

  content.push({
    type: 'text',
    text: 'Analyse this website design and fill in every field.',
  });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 24000,
    // Thinking is on by default on Opus 5 and shares the max_tokens budget with
    // the response text. Low effort suits a perception task and leaves the
    // budget comfortably clear of the JSON.
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category ?? 'unspecified';
    throw new Error(`Claude declined to analyze this image (${category}).`);
  }

  // Must precede the JSON.parse below: a truncated response is still parseable-
  // looking text, and reporting it as malformed JSON sends you debugging the
  // wrong thing.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'Analysis ran out of output budget before finishing. Retry, or raise max_tokens.'
    );
  }

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Claude did not return valid JSON for this image.');
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/analyze.test.js`
Expected: PASS — 8 tests passing

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server/lib/analyze.js tests/analyze.test.js
git commit -m "feat: claude vision analysis with structured output"
```

---

### Task 4: `capture.js` — Playwright screenshot and DOM fact extraction

**Files:**
- Create: `server/lib/capture.js`, `tests/capture.test.js`, `tests/fixtures/sample-site.html`
- Modify: `package.json` (add `playwright`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `captureSite(url, {outDir, id}) -> {imagePath, facts}` — `imagePath` is absolute
  - `EXTRACT_FACTS` — the browser-side function, exported so it can be evaluated directly in tests
  - `facts` shape: `{fonts: {heading: {family, sizePx, weight}, body: {...}}, colors: {background, text, accents: string[]}, layout: {navPattern, sectionCount, maxContentWidthPx}}`

- [ ] **Step 1: Install Playwright and its browser**

Run: `npm install playwright && npx playwright install chromium`
Expected: installs the package and downloads Chromium (~300MB, one time)

- [ ] **Step 2: Create the test fixture**

Create `tests/fixtures/sample-site.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Fixture Site</title>
    <style>
      body {
        margin: 0;
        background: #faf9f7;
        color: #111111;
        font-family: Georgia, serif;
        font-size: 16px;
      }
      nav { display: flex; gap: 24px; padding: 24px; }
      h1 { font-family: Georgia, serif; font-size: 48px; font-weight: 700; }
      main { max-width: 720px; margin: 0 auto; }
      .accent { color: #c85a3c; }
      section { padding: 80px 0; }
    </style>
  </head>
  <body>
    <nav><a href="#a">One</a><a href="#b">Two</a><a href="#c">Three</a></nav>
    <main>
      <h1>Fixture Heading</h1>
      <section><p>Body copy one.</p><p class="accent">Accent copy.</p></section>
      <section><p>Body copy two.</p></section>
      <section><p>Body copy three.</p></section>
    </main>
  </body>
</html>
```

- [ ] **Step 3: Write the failing test**

Create `tests/capture.test.js`:

```js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { captureSite, EXTRACT_FACTS } from '../server/lib/capture.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = pathToFileURL(join(here, 'fixtures', 'sample-site.html')).href;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('EXTRACT_FACTS reads real computed styles from the page', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(fixtureUrl);
  const facts = await page.evaluate(EXTRACT_FACTS);
  await page.close();

  assert.match(facts.fonts.heading.family, /Georgia/);
  assert.equal(facts.fonts.heading.sizePx, 48);
  assert.equal(facts.fonts.body.sizePx, 16);

  assert.equal(facts.colors.background, '#faf9f7');
  assert.equal(facts.colors.text, '#111111');
  assert.ok(facts.colors.accents.includes('#c85a3c'));

  assert.equal(facts.layout.navPattern, 'horizontal');
  assert.equal(facts.layout.sectionCount, 3);
  assert.equal(facts.layout.maxContentWidthPx, 720);
});

test('captureSite writes a screenshot and returns facts', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'capture-'));
  const { imagePath, facts } = await captureSite(fixtureUrl, { outDir, id: 'abc123' });

  assert.equal(imagePath, join(outDir, 'abc123.png'));
  assert.ok(existsSync(imagePath));
  assert.ok(statSync(imagePath).size > 0);
  assert.equal(facts.colors.background, '#faf9f7');
});

test('captureSite gives an actionable error for an unreachable URL', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'capture-'));
  await assert.rejects(
    () => captureSite('http://localhost:1/nope', { outDir, id: 'x', timeoutMs: 3000 }),
    /Could not load .*screenshot it yourself/s
  );
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tests/capture.test.js`
Expected: FAIL — `Cannot find module '.../server/lib/capture.js'`

- [ ] **Step 5: Write the implementation**

Create `server/lib/capture.js`:

```js
import { chromium } from 'playwright';
import { join } from 'node:path';

const VIEWPORT = { width: 1440, height: 900 };
const MAX_SCREENSHOT_HEIGHT = 6000;
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Runs inside the browser. Must be self-contained — it cannot close over
 * anything in this module. Exported so tests can evaluate it directly.
 */
export const EXTRACT_FACTS = () => {
  const toHex = (rgb) => {
    const m = rgb.match(/\d+/g);
    if (!m) return null;
    return (
      '#' +
      m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    );
  };

  const describe = (el) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      sizePx: Math.round(parseFloat(s.fontSize)),
      weight: s.fontWeight,
    };
  };

  const body = document.body;
  const bodyStyle = getComputedStyle(body);

  // Accent colours: text colours that differ from the dominant body colour.
  const dominant = toHex(bodyStyle.color);
  const counts = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const hex = toHex(getComputedStyle(el).color);
    if (!hex || hex === dominant) continue;
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const accents = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hex]) => hex);

  const nav = document.querySelector('nav, header nav, [role="navigation"]');
  let navPattern = 'none';
  if (nav) {
    const display = getComputedStyle(nav).display;
    navPattern = display === 'flex' || display === 'grid' ? 'horizontal' : 'stacked';
  }

  // Widest constrained content container on the page.
  let maxContentWidthPx = null;
  for (const el of document.querySelectorAll('main, section, div, article')) {
    const mw = getComputedStyle(el).maxWidth;
    if (mw && mw !== 'none') {
      const px = Math.round(parseFloat(mw));
      if (!Number.isNaN(px) && (maxContentWidthPx === null || px > maxContentWidthPx)) {
        maxContentWidthPx = px;
      }
    }
  }

  return {
    fonts: {
      heading: describe(document.querySelector('h1, h2')),
      body: describe(body),
    },
    colors: {
      background: toHex(bodyStyle.backgroundColor),
      text: dominant,
      accents,
    },
    layout: {
      navPattern,
      sectionCount: document.querySelectorAll('section').length,
      maxContentWidthPx,
    },
  };
};

export async function captureSite(url, { outDir, id, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (cause) {
    throw new Error(
      'Could not launch Chromium. Run `npx playwright install chromium` and try again.',
      { cause }
    );
  }

  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch (cause) {
      throw new Error(
        `Could not load ${url}. The site may be slow, offline, or blocking automated ` +
          'browsers. Try opening it and screenshot it yourself, then drop the image ' +
          'in instead.',
        { cause }
      );
    }

    const facts = await page.evaluate(EXTRACT_FACTS);

    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const imagePath = join(outDir, `${id}.png`);
    await page.screenshot({
      path: imagePath,
      clip: {
        x: 0,
        y: 0,
        width: VIEWPORT.width,
        height: Math.min(fullHeight, MAX_SCREENSHOT_HEIGHT),
      },
    });

    return { imagePath, facts };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/capture.test.js`
Expected: PASS — 3 tests passing. This test launches a real browser, so allow ~10s.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/lib/capture.js tests/capture.test.js tests/fixtures/sample-site.html
git commit -m "feat: playwright site capture with computed-style fact extraction"
```

---

### Task 5: `images.js` — saving image bytes and remote images

**Files:**
- Create: `server/lib/images.js`, `tests/images.test.js`

**Interfaces:**
- Consumes: `mediaTypeFor` from `server/lib/analyze.js`
- Produces:
  - `extensionForMediaType(mediaType) -> string` (throws on unsupported)
  - `saveImageBuffer(buffer, {outDir, id, mediaType}) -> string` (absolute path)
  - `saveImageFromUrl(url, {outDir, id, fetchImpl?}) -> string` (absolute path; throws on 403 / non-image)
  - `looksLikeImageUrl(url) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/images.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extensionForMediaType, saveImageBuffer, saveImageFromUrl, looksLikeImageUrl,
} from '../server/lib/images.js';

const outDir = () => mkdtempSync(join(tmpdir(), 'img-'));

test('extensionForMediaType maps supported types', () => {
  assert.equal(extensionForMediaType('image/png'), '.png');
  assert.equal(extensionForMediaType('image/jpeg'), '.jpg');
  assert.equal(extensionForMediaType('image/webp'), '.webp');
  assert.throws(() => extensionForMediaType('image/bmp'), /Unsupported image type/);
});

test('looksLikeImageUrl recognises image extensions only', () => {
  assert.equal(looksLikeImageUrl('https://x.com/a.png'), true);
  assert.equal(looksLikeImageUrl('https://x.com/a.JPG?v=2'), true);
  assert.equal(looksLikeImageUrl('https://stripe.com'), false);
  assert.equal(looksLikeImageUrl('https://x.com/pin/12345'), false);
});

test('saveImageBuffer writes the file with the right extension', () => {
  const dir = outDir();
  const path = saveImageBuffer(Buffer.from('bytes'), {
    outDir: dir, id: 'abc', mediaType: 'image/png',
  });
  assert.equal(path, join(dir, 'abc.png'));
  assert.equal(readFileSync(path, 'utf8'), 'bytes');
});

test('saveImageFromUrl downloads and stores the image', async () => {
  const dir = outDir();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => new TextEncoder().encode('png-bytes').buffer,
  });

  const path = await saveImageFromUrl('https://x.com/a.png', {
    outDir: dir, id: 'abc', fetchImpl,
  });
  assert.equal(path, join(dir, 'abc.png'));
});

test('saveImageFromUrl names Pinterest explicitly on a 403', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 403, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0),
  });
  await assert.rejects(
    () => saveImageFromUrl('https://i.pinimg.com/a.png', {
      outDir: outDir(), id: 'x', fetchImpl,
    }),
    /Pinterest blocks direct image links.*drag the image in instead/s
  );
});

test('saveImageFromUrl accepts an uppercase content-type', async () => {
  const dir = outDir();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'IMAGE/PNG' }),
    arrayBuffer: async () => new TextEncoder().encode('png-bytes').buffer,
  });
  const path = await saveImageFromUrl('https://x.com/a.png', {
    outDir: dir, id: 'abc', fetchImpl,
  });
  assert.equal(path, join(dir, 'abc.png'));
});

test('saveImageFromUrl rejects a non-image content-type before writing', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html' }),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  await assert.rejects(
    () => saveImageFromUrl('https://x.com/a.png', { outDir: outDir(), id: 'x', fetchImpl }),
    /did not return an image/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/images.test.js`
Expected: FAIL — `Cannot find module '.../server/lib/images.js'`

- [ ] **Step 3: Write the implementation**

Create `server/lib/images.js`:

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const IMAGE_URL_PATTERN = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;

export function extensionForMediaType(mediaType) {
  const ext = EXTENSIONS[String(mediaType).toLowerCase().split(';')[0].trim()];
  if (!ext) throw new Error(`Unsupported image type: ${mediaType}`);
  return ext;
}

export function looksLikeImageUrl(url) {
  return IMAGE_URL_PATTERN.test(url);
}

export function saveImageBuffer(buffer, { outDir, id, mediaType }) {
  const path = join(outDir, `${id}${extensionForMediaType(mediaType)}`);
  writeFileSync(path, buffer);
  return path;
}

export async function saveImageFromUrl(url, { outDir, id, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { redirect: 'follow' });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'That image URL returned 403. Pinterest blocks direct image links — ' +
          'drag the image in instead.'
      );
    }
    throw new Error(`That image URL returned ${response.status}.`);
  }

  // Media types are case-insensitive per RFC 7231 and fetch does not normalise
  // header values, so a server sending `IMAGE/JPEG` is still sending an image.
  const mediaType = (response.headers.get('content-type') || '').toLowerCase();
  if (!mediaType.startsWith('image/')) {
    throw new Error(
      `That URL did not return an image (got "${mediaType || 'no content-type'}").`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return saveImageBuffer(buffer, { outDir, id, mediaType });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/images.test.js`
Expected: PASS — 6 tests passing

- [ ] **Step 5: Commit**

```bash
git add server/lib/images.js tests/images.test.js
git commit -m "feat: image persistence for uploads and remote urls"
```

---

### Task 6: Express app and inspiration routes

**Files:**
- Create: `server/app.js`, `server/routes/inspirations.js`, `tests/routes-inspirations.test.js`
- Modify: `package.json` (add `express`)

**Interfaces:**
- Consumes: `db.js` (all query functions), `prompt.js` (`toMarkdown`)
- Produces:
  - `createApp({db, dataDir, client, captureFn, analyzeFn}) -> express.Application`
  - `GET /api/health -> {ok, hasApiKey}`
  - `GET /api/inspirations?designType= -> inspiration[]`
  - `GET /api/design-types -> [{designType, count}]`
  - `GET /api/inspirations/:id -> inspiration` (404 if missing)
  - `PATCH /api/inspirations/:id -> inspiration`
  - `DELETE /api/inspirations/:id -> 204`
  - `GET /api/inspirations/:id/prompt -> text/markdown`
  - `GET /images/<file>` — static image serving

- [ ] **Step 1: Install Express**

Run: `npm install express`
Expected: adds `express` (v5) to dependencies

- [ ] **Step 2: Write the failing test**

Create `tests/routes-inspirations.test.js`:

```js
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/routes-inspirations.test.js`
Expected: FAIL — `Cannot find module '.../server/app.js'`

- [ ] **Step 4: Write the routes**

Create `server/routes/inspirations.js`:

```js
import { Router } from 'express';
import {
  listInspirations, getInspiration, updateInspiration,
  deleteInspiration, listDesignTypes,
} from '../lib/db.js';
import { toMarkdown } from '../lib/prompt.js';

export function inspirationsRouter({ db }) {
  const router = Router();

  router.get('/inspirations', (req, res) => {
    res.json(listInspirations(db, { designType: req.query.designType }));
  });

  router.get('/design-types', (_req, res) => {
    res.json(listDesignTypes(db));
  });

  router.get('/inspirations/:id', (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.get('/inspirations/:id/prompt', (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.type('text/markdown').send(toMarkdown(row));
  });

  router.patch('/inspirations/:id', (req, res) => {
    const row = updateInspiration(db, req.params.id, req.body ?? {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.delete('/inspirations/:id', (req, res) => {
    if (!deleteInspiration(db, req.params.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 5: Write the app factory**

Create `server/app.js`:

```js
import express from 'express';
import { join } from 'node:path';
import { inspirationsRouter } from './routes/inspirations.js';

/**
 * Build the Express app from injected dependencies so tests can supply an
 * in-memory database and stubbed capture/analyze functions.
 */
export function createApp({ db, dataDir, client, captureFn, analyzeFn }) {
  const app = express();
  const deps = { db, dataDir, client, captureFn, analyzeFn };

  app.use(express.json({ limit: '2mb' }));
  app.use('/images', express.static(join(dataDir, 'images')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(client) });
  });

  app.use('/api', inspirationsRouter(deps));

  // Central error handler — every route can just throw.
  app.use((err, _req, res, _next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/routes-inspirations.test.js`
Expected: PASS — 7 tests passing

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/app.js server/routes/inspirations.js tests/routes-inspirations.test.js
git commit -m "feat: express app factory and inspiration crud routes"
```

---

### Task 7: Ingest routes and background analysis

**Files:**
- Create: `server/lib/analysis-queue.js`, `server/routes/ingest.js`, `server/routes/analyze.js`, `server/index.js`, `tests/routes-ingest.test.js`
- Modify: `server/app.js` (mount the new routers, expose `settleAnalysis`)
- Modify: `package.json` (add `concurrently`)

**Interfaces:**
- Consumes: `images.js`, `capture.js` (`captureFn`), `analyze.js` (`analyzeFn`), `db.js`
- Produces:
  - `createAnalysisQueue() -> {add(promise), settle()}` — tracks in-flight background analyses
  - `POST /api/ingest/file` — raw image body, `Content-Type` names the media type → `201` inspiration
  - `POST /api/ingest/url` — `{url}` → sniffs image-vs-site → `201` inspiration
  - `POST /api/inspirations/:id/analyze` — retry → `200` inspiration
  - `runAnalysis({db, id, client, analyzeFn}) -> Promise<void>` — exported so tests can await it
  - `app.locals.settleAnalysis() -> Promise<void>` — resolves when every background analysis has finished

**Why the queue exists:** ingest deliberately returns before analysis completes, so a test needs a way to know when the background work is done. Sleeping for a fixed interval is flaky under load. The queue makes the wait deterministic without changing app behaviour — nothing in production calls `settle()`.

- [ ] **Step 1: Install concurrently**

Run: `npm install --save-dev concurrently`
Expected: adds `concurrently` to devDependencies

- [ ] **Step 2: Write the analysis queue**

Create `server/lib/analysis-queue.js`:

```js
/**
 * Tracks in-flight background analyses so tests can await them
 * deterministically instead of sleeping. Production never calls settle().
 */
export function createAnalysisQueue() {
  const pending = new Set();

  return {
    add(promise) {
      pending.add(promise);
      promise.finally(() => pending.delete(promise));
      return promise;
    },

    async settle() {
      // Loop rather than a single allSettled: an analysis could enqueue more.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}
```

Create `tests/analysis-queue.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisQueue } from '../server/lib/analysis-queue.js';

test('settle resolves immediately when nothing is pending', async () => {
  await createAnalysisQueue().settle();
});

test('settle waits for every tracked promise', async () => {
  const queue = createAnalysisQueue();
  const done = [];

  queue.add(new Promise((r) => setTimeout(r, 10)).then(() => done.push('a')));
  queue.add(new Promise((r) => setTimeout(r, 20)).then(() => done.push('b')));

  await queue.settle();
  assert.deepEqual(done.sort(), ['a', 'b']);
});

test('settle does not reject when a tracked promise rejects', async () => {
  const queue = createAnalysisQueue();
  queue.add(Promise.reject(new Error('boom')));
  await queue.settle();
});
```

Run: `node --test tests/analysis-queue.test.js`
Expected: PASS — 3 tests passing

- [ ] **Step 3: Write the failing test**

Create `tests/routes-ingest.test.js`:

```js
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
  await new Promise((resolve) => server.close(resolve));
  db.close();
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test tests/routes-ingest.test.js`
Expected: FAIL — `Cannot find module '.../server/routes/ingest.js'`

- [ ] **Step 5: Write the analysis runner and retry route**

Create `server/routes/analyze.js`:

```js
import { Router } from 'express';
import { getInspiration, updateInspiration } from '../lib/db.js';

/**
 * Run analysis for one inspiration and write the outcome back.
 * Never throws — a failure is recorded on the row so the image survives.
 */
export async function runAnalysis({ db, id, client, analyzeFn }) {
  const row = getInspiration(db, id);
  if (!row) return;

  try {
    const result = await analyzeFn({
      imagePath: row.imagePath,
      facts: row.extractedFacts,
      client,
    });
    updateInspiration(db, id, {
      designType: result.designType ?? '',
      title: result.title ?? '',
      brief: result.brief ?? '',
      aesthetics: result.aesthetics ?? '',
      reference: result.reference ?? '',
      intent: result.intent ?? '',
      status: 'ready',
      error: null,
    });
  } catch (err) {
    updateInspiration(db, id, { status: 'failed', error: err.message });
  }
}

export function analyzeRouter({ db, client, analyzeFn }) {
  const router = Router();

  router.post('/inspirations/:id/analyze', async (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    updateInspiration(db, row.id, { status: 'analyzing', error: null });
    await runAnalysis({ db, id: row.id, client, analyzeFn });
    res.json(getInspiration(db, row.id));
  });

  return router;
}
```

- [ ] **Step 6: Write the ingest routes**

Create `server/routes/ingest.js`:

```js
import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInspiration } from '../lib/db.js';
import { saveImageBuffer, saveImageFromUrl, looksLikeImageUrl } from '../lib/images.js';
import { runAnalysis } from './analyze.js';

export function ingestRouter({ db, dataDir, client, captureFn, analyzeFn, queue }) {
  const router = Router();
  const imagesDir = join(dataDir, 'images');

  // Analysis runs detached so ingest returns as soon as the image is on disk.
  // The queue tracks the in-flight promise so tests can await completion.
  const startAnalysis = (id) => queue.add(runAnalysis({ db, id, client, analyzeFn }));

  router.post(
    '/ingest/file',
    express.raw({ type: 'image/*', limit: '25mb' }),
    (req, res) => {
      const mediaType = req.headers['content-type'] ?? '';
      if (!mediaType.startsWith('image/') || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Expected an image body.' });
      }

      const id = randomUUID();
      const imagePath = saveImageBuffer(req.body, { outDir: imagesDir, id, mediaType });
      const row = createInspiration(db, { imagePath });

      startAnalysis(row.id);
      res.status(201).json(row);
    }
  );

  router.post('/ingest/url', async (req, res, next) => {
    const url = req.body?.url;
    if (!url) return res.status(400).json({ error: 'A url is required.' });

    try {
      const id = randomUUID();
      let imagePath;
      let facts = null;

      if (looksLikeImageUrl(url)) {
        imagePath = await saveImageFromUrl(url, { outDir: imagesDir, id });
      } else {
        const captured = await captureFn(url, { outDir: imagesDir, id });
        imagePath = captured.imagePath;
        facts = captured.facts;
      }

      const row = createInspiration(db, { imagePath, sourceUrl: url, extractedFacts: facts });
      startAnalysis(row.id);
      res.status(201).json(row);
    } catch (err) {
      err.status = 400;
      next(err);
    }
  });

  return router;
}
```

- [ ] **Step 7: Mount the new routers and expose the queue**

In `server/app.js`, add these imports below the existing `inspirationsRouter` import:

```js
import { ingestRouter } from './routes/ingest.js';
import { analyzeRouter } from './routes/analyze.js';
import { createAnalysisQueue } from './lib/analysis-queue.js';
```

Replace the `const deps = { db, dataDir, client, captureFn, analyzeFn };` line with:

```js
  const queue = createAnalysisQueue();
  const deps = { db, dataDir, client, captureFn, analyzeFn, queue };

  // Tests await this to know background analysis has finished.
  app.locals.settleAnalysis = () => queue.settle();
```

Then replace the single `app.use('/api', inspirationsRouter(deps));` line with:

```js
  app.use('/api', ingestRouter(deps));
  app.use('/api', analyzeRouter(deps));
  app.use('/api', inspirationsRouter(deps));
```

- [ ] **Step 8: Write the server entry point**

Create `server/index.js`:

```js
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './lib/db.js';
import { createClient, analyzeImage } from './lib/analyze.js';
import { captureSite } from './lib/capture.js';

process.loadEnvFile?.('.env');

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');
mkdirSync(join(dataDir, 'images'), { recursive: true });

const client = createClient();
if (!client) {
  console.warn('[warn] ANTHROPIC_API_KEY is not set — AI drafting is disabled.');
}

const app = createApp({
  db: openDb(join(dataDir, 'library.db')),
  dataDir,
  client,
  captureFn: captureSite,
  analyzeFn: analyzeImage,
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Inspiration library API on http://localhost:${port}`));
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `node --test tests/routes-ingest.test.js`
Expected: PASS — 7 tests passing

- [ ] **Step 10: Run the whole suite**

Run: `npm test`
Expected: PASS — all suites green (prompt, db, analyze, capture, images, routes-inspirations, routes-ingest)

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json server/lib/analysis-queue.js server/routes/ingest.js server/routes/analyze.js server/index.js server/app.js tests/analysis-queue.test.js tests/routes-ingest.test.js
git commit -m "feat: ingest routes with non-blocking background analysis"
```

---

### Task 8: Frontend shell — Vite, API client, sidebar and grid

**Files:**
- Create: `index.html`, `vite.config.js`, `src/main.jsx`, `src/App.jsx`, `src/api.js`, `src/styles.css`, `src/components/Sidebar.jsx`, `src/components/Grid.jsx`
- Modify: `package.json` (add React and Vite)

**Interfaces:**
- Consumes: all `/api` endpoints from Tasks 6–7
- Produces:
  - `src/api.js` exports `listInspirations`, `listDesignTypes`, `getPrompt`, `updateInspiration`, `deleteInspiration`, `ingestFile`, `ingestUrl`, `retryAnalysis`, `getHealth`
  - `<Sidebar types selected onSelect />`, `<Grid items selectedId onSelect />`

- [ ] **Step 1: Install frontend dependencies**

Run: `npm install react react-dom && npm install --save-dev vite @vitejs/plugin-react`
Expected: adds React to dependencies, Vite to devDependencies

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/images': 'http://localhost:3001',
    },
  },
});
```

- [ ] **Step 3: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inspiration Library</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `src/api.js`**

```js
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
```

- [ ] **Step 5: Create `src/components/Sidebar.jsx`**

```jsx
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
```

- [ ] **Step 6: Create `src/components/Grid.jsx`**

```jsx
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
```

- [ ] **Step 7: Create `src/App.jsx`**

The `analyzing` poll is what makes background analysis visible without a websocket.

```jsx
import { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Grid } from './components/Grid.jsx';

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
```

- [ ] **Step 8: Create `src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 9: Create `src/styles.css`**

```css
:root {
  --bg: #faf9f7;
  --ink: #111111;
  --muted: #6b6b6b;
  --line: #e4e1db;
  --accent: #c85a3c;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); }

.banner {
  padding: 12px 20px;
  background: #fff8e6;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.banner.error { background: #fdecea; cursor: pointer; }
.dismiss { color: var(--muted); text-decoration: underline; margin-left: 8px; }

.layout { display: flex; height: 100vh; }

.sidebar {
  width: 220px;
  border-right: 1px solid var(--line);
  padding: 20px 12px;
  overflow-y: auto;
  flex-shrink: 0;
}
.type-row {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.type-row:hover { background: #efece6; }
.type-row.active { background: var(--ink); color: var(--bg); }
.count { color: var(--muted); }
.type-row.active .count { color: var(--bg); opacity: 0.7; }

.main { flex: 1; overflow-y: auto; padding: 20px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.card {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.card.selected { outline: 2px solid var(--accent); }
.card img { width: 100%; display: block; max-height: 320px; object-fit: cover; }
.card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.card-title { font-weight: 600; font-size: 14px; }
.badge {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}
.badge.failed { color: var(--accent); border-color: var(--accent); }

.empty { color: var(--muted); padding: 40px; text-align: center; }
```

- [ ] **Step 10: Verify the app boots**

Run: `npm run dev`
Expected: both processes start; `http://localhost:5173` shows the empty-state message and no console errors. Stop with Ctrl-C.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json index.html vite.config.js src/
git commit -m "feat: frontend shell with sidebar, grid, and analysis polling"
```

---

### Task 9: Capture bar — drop files and paste URLs

**Files:**
- Create: `src/components/CaptureBar.jsx`
- Modify: `src/App.jsx` (mount the bar), `src/styles.css` (append capture-bar styles)

**Interfaces:**
- Consumes: `api.ingestFile`, `api.ingestUrl`
- Produces: `<CaptureBar onCaptured={(inspiration) => void} onError={(message) => void} />`

- [ ] **Step 1: Create `src/components/CaptureBar.jsx`**

```jsx
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
```

- [ ] **Step 2: Append capture-bar styles to `src/styles.css`**

```css
.capture-bar {
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: #fff;
}
.capture-bar.dragging { background: #f0ece4; border-bottom-color: var(--accent); }
.capture-bar input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
  font: inherit;
  background: var(--bg);
}
.capture-bar input:focus { outline: 2px solid var(--accent); border-color: transparent; }
```

- [ ] **Step 3: Mount the capture bar in `src/App.jsx`**

Add the import beside the other component imports:

```jsx
import { CaptureBar } from './components/CaptureBar.jsx';
```

Then insert this directly above `<div className="layout">` in the returned JSX:

```jsx
      <CaptureBar
        onCaptured={(item) => { setSelectedId(item.id); refresh().catch(() => {}); }}
        onError={setError}
      />
```

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, then:
1. Drop a PNG onto the bar → a card appears immediately showing `analyzing…`
2. Paste `https://stripe.com` and press Enter → after the screenshot completes, a card appears
3. Paste a nonsense URL like `https://not-a-real-site-xyz.com` → the red error banner names the failure

Expected: capture never blocks; failures surface in the banner rather than the console.

- [ ] **Step 5: Commit**

```bash
git add src/components/CaptureBar.jsx src/App.jsx src/styles.css
git commit -m "feat: capture bar for dropped files and pasted urls"
```

---

### Task 10: Detail panel — editable fields, copy prompt, retry

**Files:**
- Create: `src/components/DetailPanel.jsx`
- Modify: `src/App.jsx` (mount the panel), `src/styles.css` (append detail styles)

**Interfaces:**
- Consumes: `api.updateInspiration`, `api.getPrompt`, `api.retryAnalysis`, `api.deleteInspiration`, `api.imageSrc`
- Produces: `<DetailPanel item knownTypes onChanged onClose onError />`

- [ ] **Step 1: Create `src/components/DetailPanel.jsx`**

Fields save on blur, so editing never fights a re-render mid-keystroke.

```jsx
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
```

- [ ] **Step 2: Append detail styles to `src/styles.css`**

```css
.detail {
  width: 420px;
  flex-shrink: 0;
  border-left: 1px solid var(--line);
  padding: 16px;
  overflow-y: auto;
  background: #fff;
}
.detail-head { display: flex; justify-content: space-between; margin-bottom: 12px; }
.detail-actions { display: flex; gap: 12px; }
.link {
  border: 0; background: none; color: var(--muted);
  font: inherit; cursor: pointer; text-decoration: underline;
}
.link.danger { color: var(--accent); }
.detail-image { width: 100%; border-radius: 8px; border: 1px solid var(--line); }
.detail-error { color: var(--accent); font-size: 13px; }
.detail-note { color: var(--muted); font-size: 13px; }

.field { display: block; margin: 14px 0; }
.field span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.field input,
.field textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 6px;
  padding: 8px 10px; font: inherit; background: var(--bg); resize: vertical;
}

.copy {
  width: 100%; padding: 12px; margin-top: 8px;
  border: 0; border-radius: 8px;
  background: var(--ink); color: var(--bg);
  font: inherit; font-weight: 600; cursor: pointer;
}
```

- [ ] **Step 3: Mount the detail panel in `src/App.jsx`**

Add the import beside the other component imports:

```jsx
import { DetailPanel } from './components/DetailPanel.jsx';
```

Then replace the whole `<div className="layout">…</div>` block with:

```jsx
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
        {selectedId && items.some((i) => i.id === selectedId) && (
          <DetailPanel
            item={items.find((i) => i.id === selectedId)}
            knownTypes={types}
            onChanged={() => refresh().catch(() => {})}
            onClose={() => setSelectedId(null)}
            onError={setError}
          />
        )}
      </div>
```

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, then:
1. Click a card → the detail panel opens with populated fields
2. Edit the brief and click away → the change persists after a refresh
3. Type a new design type → it appears in the sidebar after the next refresh
4. Click **Copy prompt** → paste elsewhere and confirm the exact structure: `# Title`, brief, `## Aesthetics`, `## Reference`, `## Intent`
5. On a `failed` card, click **retry analysis** → status flips to `ready` (with a valid API key) or shows a fresh error

Expected: all five behaviours hold.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — every suite still green

- [ ] **Step 6: Commit**

```bash
git add src/components/DetailPanel.jsx src/App.jsx src/styles.css
git commit -m "feat: detail panel with editable fields, copy prompt, and retry"
```

---

### Task 11: README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: setup instructions

- [ ] **Step 1: Write `README.md`**

````markdown
# Website Inspiration Library

Local-only library for website design inspiration. Drop in an image, paste an
image URL, or paste a live site URL; Claude drafts a brief plus an
aesthetics / reference / intent prompt you can copy straight into a Claude Code
session to build a client site.

## Setup

```bash
npm install
npx playwright install chromium   # ~300MB, one time
cp .env.example .env              # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:5173

The app runs without an API key — capture and manual editing work normally,
only AI drafting is disabled.

## Capturing

| Input | What happens |
|---|---|
| Drop a PNG/JPG/WebP | Stored locally, analyzed |
| Paste an image URL | Downloaded, stored, analyzed |
| Paste a site URL | Playwright screenshots the live page and extracts real fonts, colours, and layout, which are fed to Claude as ground truth |

Analysis runs in the background — capture several references in a row without
waiting. Anything that fails shows a **retry analysis** button; the captured
image is never lost to an analysis failure.

## Notes

- Pinterest blocks direct image links. Drag the image in instead of pasting its URL.
- Data lives in `server/data/` (SQLite + images) and is gitignored.
- Each analysis is one Claude vision call — roughly a cent or two per inspiration.

## Tests

```bash
npm test
```

The capture suite launches a real Chromium against a local fixture; everything
else runs without network access.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: setup and usage readme"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Drop file ingest | 5, 7, 9 |
| Image URL ingest | 5, 7, 9 |
| Site URL ingest with screenshot + CSS facts | 4, 7, 9 |
| AI-drafted, user-editable fields | 3, 7, 10 |
| AI-suggested free-form design types, sidebar from usage | 2, 8, 10 |
| Copy output markdown shape | 1, 6, 10 |
| Facts inform prose but stay out of copy output | 1, 3 |
| Non-blocking analysis | 7, 8 |
| No API key → app still runs, banner | 3, 6, 8 |
| Chromium missing → actionable error | 4 |
| Site timeout / bot wall | 4 |
| Image URL 403 named for Pinterest | 5 |
| Non-image content-type rejected | 5, 7 |
| Malformed JSON / refusal handling | 3 |
| Retry analysis | 7, 10 |
| Testing strategy (unit, integration, manual) | 1–7 unit/integration; 9, 10 manual |

No gaps.

**Type consistency** — `inspiration` field names are identical across `db.js`, the analysis result, route responses, and the frontend. `imagePath` is absolute on the server and converted for the browser by `api.imageSrc` in exactly one place. `status` is `'analyzing' | 'ready' | 'failed'` everywhere. `facts` / `extractedFacts` is the same object in both directions — named `extractedFacts` on the record and `facts` as a function parameter, which the interface blocks in Tasks 3, 4, and 7 state explicitly.
