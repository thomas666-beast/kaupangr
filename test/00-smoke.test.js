import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';

test('test harness: DB boots with all tables', () => {
  const db = makeTestDb();
  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all().map(r => r.name);

  for (const t of [
    'app_meta', 'products', 'return_lines', 'returns',
    'sales', 'sales_lines', 'schema_migrations',
    'sessions', 'stores', 'suppliers', 'sync_queue', 'users',
  ]) {
    assert.ok(tables.includes(t), `missing table: ${t}`);
  }

  const applied = db.prepare(
    `SELECT name FROM schema_migrations ORDER BY id`
  ).all().map(r => r.name);
  assert.ok(applied.length >= 3, 'expected at least 3 migrations applied');
  assert.equal(applied[0], '0001_init.sql');
  assert.equal(applied[1], '0002_core.sql');
  assert.ok(applied.includes('0003_supplier_address.sql'));

  teardown();
});
