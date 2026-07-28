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
