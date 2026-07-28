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
