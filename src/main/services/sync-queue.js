import { getDb } from '../db/index.js';

export function listPending({ limit = 500 } = {}) {
  return getDb().prepare(
    `SELECT id, entity, entity_id, op, payload, created_at
       FROM sync_queue
      WHERE synced_at IS NULL
      ORDER BY id
      LIMIT ?`
  ).all(limit);
}

export function markSynced(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { marked: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const info = getDb().prepare(
    `UPDATE sync_queue SET synced_at = datetime('now')
      WHERE id IN (${placeholders}) AND synced_at IS NULL`
  ).run(...ids);
  return { marked: info.changes };
}

export function pendingCount() {
  return getDb().prepare(
    `SELECT COUNT(*) AS n FROM sync_queue WHERE synced_at IS NULL`
  ).get().n;
}

export function lastSyncedAt() {
  return getDb().prepare(
    `SELECT MAX(synced_at) AS t FROM sync_queue`
  ).get().t;
}
