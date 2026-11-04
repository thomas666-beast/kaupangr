import { getPool } from './db.js';

/**
 * Postgres-backed sync store.
 *
 * Public API is the same as the JSON store:
 *   - accept(item)         → { entity, entity_id, op, payload, updated_at }
 *   - pull(since, limit)   → { items, since, hasMore, nextSince }
 *
 * Semantics:
 *   - accept is a true upsert on (entity, entity_id, op).
 *   - Each accept assigns a fresh `updated_at` that is strictly greater than
 *     every existing row's `updated_at`, so pagination by `updated_at` never
 *     misses or reorders.
 *   - pull(since, limit): returns at most `limit` items strictly newer than
 *     `since`, sorted ascending. `hasMore` tells the client to call again with
 *     `nextSince = items[last].updated_at`. When done, `nextSince = since` (the
 *     current server clock).
 */
export class PgStore {
  constructor(pool) {
    this.pool = pool || getPool();
  }

  async accept(item) {
    const { entity, op, payload } = item;
    if (!entity || !payload || !Number.isInteger(payload.id) || !op) {
      throw new Error('invalid item');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updatedAt = await nextClock(client);
      await client.query(
        `INSERT INTO sync_items (entity, entity_id, op, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entity, entity_id, op)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [entity, payload.id, op, payload, updatedAt]
      );
      await client.query('COMMIT');
      return { entity, entity_id: payload.id, op, payload, updated_at: updatedAt };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async pull(since, limit = 500) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 500));
    const client = await this.pool.connect();
    try {
      const sinceClause = since
        ? `WHERE updated_at > $2::timestamptz`
        : '';
      const args = since ? [n + 1, since] : [n + 1];

      const { rows } = await client.query(
        `SELECT entity, entity_id, op, payload, updated_at
           FROM sync_items
           ${sinceClause}
          ORDER BY updated_at ASC
          LIMIT $1`,
        args
      );

      const hasMore = rows.length > n;
      const batch = hasMore ? rows.slice(0, n) : rows;
      const nextSince = hasMore
        ? batch[batch.length - 1].updated_at.toISOString()
        : (await currentClock(client)).toISOString();

      return {
        items: batch.map(r => ({
          entity: r.entity,
          op: r.op,
          payload: r.payload,
          updated_at: r.updated_at.toISOString(),
        })),
        since: (await currentClock(client)).toISOString(),
        hasMore,
        nextSince,
      };
    } finally {
      client.release();
    }
  }
}

// ------------------------------------------------------------------
// clock helpers
// ------------------------------------------------------------------
async function currentClock(client) {
  const { rows } = await client.query(`SELECT clock FROM sync_clock WHERE id = 1`);
  return new Date(rows[0].clock);
}

/**
 * Return `GREATEST(now(), clock + 1 microsecond)` as a JS Date, and persist
 * the new clock. This guarantees strictly monotone updated_at values.
 */
async function nextClock(client) {
  const { rows } = await client.query(
    `UPDATE sync_clock
        SET clock = GREATEST(now(), clock + INTERVAL '1 microsecond')
      WHERE id = 1
      RETURNING clock`
  );
  return new Date(rows[0].clock);
}
