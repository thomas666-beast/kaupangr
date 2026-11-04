import pg from 'pg';
import { runMigrations } from '../src/db.js';

const { Pool } = pg;

let pool = null;
let schemaName = null;

function baseUrl() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL (or DATABASE_URL) is required for server tests.\n' +
      'Example: TEST_DATABASE_URL=postgres://kaupangr:kaupangr@localhost:5432/kaupangr_test'
    );
  }
  return url;
}

/**
 * Create an isolated schema for one test file, run migrations into it,
 * and return a Pool whose connections use that schema.
 */
export async function makeTestPool() {
  if (pool) throw new Error('makeTestPool called twice — call teardown() first');

  schemaName = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const adminUrl = baseUrl();

  // Create the schema via a temporary connection to the base DB.
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`CREATE SCHEMA ${schemaName}`);
  } finally {
    await admin.end();
  }

  // Connect with search_path pointing at our schema only.
  pool = new Pool({
    connectionString: adminUrl,
    options: `-c search_path=${schemaName}`,
  });

  await runMigrations(pool);
  return pool;
}

export async function truncate(pool) {
  await pool.query(`TRUNCATE sync_items`);
  await pool.query(`UPDATE sync_clock SET clock = now() WHERE id = 1`);
}

export async function teardown() {
  if (!pool) return;
  const p = pool;
  const s = schemaName;
  pool = null;
  schemaName = null;

  try { await p.end(); } catch { /* ignore */ }

  const admin = new Pool({ connectionString: baseUrl() });
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  } finally {
    await admin.end();
  }
}
