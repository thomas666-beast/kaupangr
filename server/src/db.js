import pg from 'pg';

const { Pool } = pg;

let pool = null;

/**
 * Resolve the connection string from env. Fails clearly if it's missing —
 * we do NOT want the server to silently connect to a default database.
 */
function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required. Example:\n' +
      '  DATABASE_URL=postgres://kaupangr:kaupangr@localhost:5432/kaupangr_dev npm start'
    );
  }
  return url;
}

export function getPool() {
  if (pool) return pool;
  pool = new Pool({ connectionString: connectionString() });
  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  return pool;
}

/** The store's schema. Idempotent. Run once on boot and in each test. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_clock (
  id           INT PRIMARY KEY CHECK (id = 1),
  clock        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_clock (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_items (
  entity      TEXT    NOT NULL,
  entity_id   BIGINT  NOT NULL,
  op          TEXT    NOT NULL,
  payload     JSONB   NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, op)
);

CREATE INDEX IF NOT EXISTS ix_sync_items_updated_at ON sync_items(updated_at);
`;

/**
 * Run the schema against the pool. Safe to call multiple times —
 * uses IF NOT EXISTS everywhere.
 */
export async function runMigrations(client) {
  const c = client || getPool();
  await c.query(SCHEMA_SQL);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
