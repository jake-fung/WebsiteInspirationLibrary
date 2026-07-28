import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './lib/db.js';
import { createClient, analyzeImage } from './lib/analyze.js';
import { captureSite } from './lib/capture.js';

try {
  process.loadEnvFile?.('.env');
} catch (err) {
  // A missing .env is the normal first-run state — the app is meant to boot
  // without a key and simply skip AI drafting. Anything else, such as a
  // malformed file, still deserves to be surfaced.
  if (err.code !== 'ENOENT') throw err;
}

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
