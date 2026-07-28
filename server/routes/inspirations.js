import { Router } from 'express';
import {
  listInspirations, getInspiration, updateInspiration,
  deleteInspiration, listDesignTypes,
} from '../lib/db.js';
import { toMarkdown } from '../lib/prompt.js';

export function inspirationsRouter({ db }) {
  const router = Router();

  router.get('/inspirations', (req, res) => {
    res.json(listInspirations(db, { designType: req.query.designType }));
  });

  router.get('/design-types', (_req, res) => {
    res.json(listDesignTypes(db));
  });

  router.get('/inspirations/:id', (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.get('/inspirations/:id/prompt', (req, res) => {
    const row = getInspiration(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.type('text/markdown').send(toMarkdown(row));
  });

  router.patch('/inspirations/:id', (req, res) => {
    const row = updateInspiration(db, req.params.id, req.body ?? {});
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  });

  router.delete('/inspirations/:id', (req, res) => {
    if (!deleteInspiration(db, req.params.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(204).end();
  });

  return router;
}
