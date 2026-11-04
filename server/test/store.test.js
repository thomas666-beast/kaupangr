import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestPool, truncate, teardown } from './helpers.js';
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

test('empty store pulls nothing with since:null', async () => {
  const r = await store.pull(null);
  assert.deepEqual(r.items, []);
  assert.equal(r.hasMore, false);
  assert.ok(r.since);
});

test('accept inserts and pull returns it', async () => {
  await store.accept({
    entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' },
  });
  const r = await store.pull(null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].entity, 'store');
  assert.equal(r.items[0].payload.name, 'A');
  assert.ok(r.items[0].updated_at);
  assert.equal(r.hasMore, false);
});

test('re-accepting the same (entity, id, op) updates, does not duplicate', async () => {
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } });
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'B' } });
  const r = await store.pull(null);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].payload.name, 'B');
});

test('updated_at advances monotonically', async () => {
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } });
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 2, name: 'B' } });
  const { items } = await store.pull(null);
  assert.ok(items[1].updated_at > items[0].updated_at);
});

test('pull with since only returns newer items', async () => {
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } });
  const first = await store.pull(null);
  const cutoff = first.nextSince;

  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 2, name: 'B' } });

  const r = await store.pull(cutoff);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].payload.id, 2);
});

test('invalid items are rejected by accept', async () => {
  await assert.rejects(
    () => store.accept({ entity: 'store', op: 'upsert', payload: {} }),
    /invalid item/
  );
  await assert.rejects(
    () => store.accept({ op: 'upsert', payload: { id: 1 } }),
    /invalid item/
  );
});

test('state persists across PgStore instances', async () => {
  await store.accept({ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } });

  const store2 = new PgStore(pool);
  const r = await store2.pull(null);
  assert.equal(r.items.length, 1);
});
