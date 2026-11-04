import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestPool, teardown } from './helpers.js';
import { PgStore } from '../src/store.js';

let pool;
let store;

beforeEach(async () => {
  pool = await makeTestPool();
  store = new PgStore(pool);
});

afterEach(async () => {
  await teardown();
});

test('empty schema → empty pull', async () => {
  const r = await store.pull(null);
  assert.deepEqual(r.items, []);
  assert.equal(r.hasMore, false);
});

test('one item survives store re-instantiation', async () => {
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } });
  const store2 = new PgStore(pool);
  const r = await store2.pull(null);
  assert.equal(r.items.length, 1);
});

test('migration is idempotent', async () => {
  const { runMigrations } = await import('../src/db.js');
  await runMigrations(pool);
  await runMigrations(pool);
  const r = await store.pull(null);
  assert.deepEqual(r.items, []);
});
