import { Router } from 'express';
import { getInspiration, updateInspiration } from '../lib/db.js';

/**
 * Run analysis for one inspiration and write the outcome back.
 * Never throws — a failure is recorded on the row so the image survives.
 */
export async function runAnalysis({ db, id, client, analyzeFn }) {
  const row = getInspiration(db, id);
  if (!row) return;

  try {
    const result = await analyzeFn({
      imagePath: row.imagePath,
      facts: row.extractedFacts,
      client,
    });
    updateInspiration(db, id, {
      designType: result.designType ?? '',
      title: result.title ?? '',
      brief: result.brief ?? '',
      aesthetics: result.aesthetics ?? '',
      reference: result.reference ?? '',
      intent: result.intent ?? '',
      status: 'ready',
      error: null,
    });
  } catch (err) {
    updateInspiration(db, id, { status: 'failed', error: err.message });
  }
}

export function analyzeRouter({ db, client, analyzeFn }) {
  const router = Router();

  router.post('/inspirations/:id/analyze', async (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    updateInspiration(db, row.id, { status: 'analyzing', error: null });
    await runAnalysis({ db, id: row.id, client, analyzeFn });
    res.json(getInspiration(db, row.id));
  });

  return router;
}
