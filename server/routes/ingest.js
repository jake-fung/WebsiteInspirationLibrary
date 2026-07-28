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
