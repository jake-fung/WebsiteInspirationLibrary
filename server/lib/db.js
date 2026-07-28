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
