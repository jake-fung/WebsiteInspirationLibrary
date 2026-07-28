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
  assert.equal(params.max_tokens, 16000);
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
