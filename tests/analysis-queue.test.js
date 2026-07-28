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
