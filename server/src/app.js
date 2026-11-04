import express from 'express';
import { PgStore } from './store.js';

export function createApp({ pool }) {
  if (!pool) throw new Error('pool is required');
  const store = new PgStore(pool);
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/sync/push', async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items))
      return res.status(400).json({ error: 'items must be an array' });

    const accepted = [];
    const rejected = [];

    for (const item of items) {
      try {
        await store.accept(item);
        accepted.push(item.id);
      } catch (e) {
        rejected.push({ id: item?.id ?? null, reason: e?.message || 'invalid' });
      }
    }
    res.json({ accepted, rejected });
  });

  app.get('/sync/pull', async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const limit = Number.parseInt(String(req.query.limit ?? ''), 10);
    try {
      const r = await store.pull(since, Number.isFinite(limit) ? limit : 500);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e?.message || 'pull failed' });
    }
  });

  return app;
}
