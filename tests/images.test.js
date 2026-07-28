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
