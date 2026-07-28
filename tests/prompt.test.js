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
