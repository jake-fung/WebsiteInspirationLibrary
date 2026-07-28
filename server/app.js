import express from 'express';
import { join } from 'node:path';
import { inspirationsRouter } from './routes/inspirations.js';
import { ingestRouter } from './routes/ingest.js';
import { analyzeRouter } from './routes/analyze.js';
import { createAnalysisQueue } from './lib/analysis-queue.js';

/**
 * Build the Express app from injected dependencies so tests can supply an
 * in-memory database and stubbed capture/analyze functions.
 */
export function createApp({ db, dataDir, client, captureFn, analyzeFn }) {
  const app = express();
  const queue = createAnalysisQueue();
  const deps = { db, dataDir, client, captureFn, analyzeFn, queue };

  // Tests await this to know background analysis has finished.
  app.locals.settleAnalysis = () => queue.settle();

  app.use(express.json({ limit: '2mb' }));
  app.use('/images', express.static(join(dataDir, 'images')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, hasApiKey: Boolean(client) });
  });

  app.use('/api', ingestRouter(deps));
  app.use('/api', analyzeRouter(deps));
  app.use('/api', inspirationsRouter(deps));

  // Central error handler — every route can just throw.
  app.use((err, _req, res, _next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}
