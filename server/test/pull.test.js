import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestPool, teardown } from './helpers.js';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let pool;

beforeEach(async () => {
  pool = await makeTestPool();
  const app = createApp({ pool });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise(r => server.close(r));
  await teardown();
});

async function push(items) {
  const res = await fetch(`${baseUrl}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  return res.json();
}

async function pull(since, limit) {
  const qs = [];
  if (since) qs.push(`since=${encodeURIComponent(since)}`);
  if (limit) qs.push(`limit=${limit}`);
  const res = await fetch(`${baseUrl}/sync/pull${qs.length ? '?' + qs.join('&') : ''}`);
  return { status: res.status, json: await res.json() };
}

test('empty server returns no items and hasMore:false', async () => {
  const { status, json } = await pull(null);
  assert.equal(status, 200);
  assert.deepEqual(json.items, []);
  assert.equal(json.hasMore, false);
});

test('after push, pull returns the item', async () => {
  await push([{ id: 1, entity: 'store', entity_id: 1, op: 'upsert', payload: { id: 1, name: 'A' } }]);
  const { json } = await pull(null);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].entity, 'store');
  assert.equal(json.items[0].payload.name, 'A');
});

test('pull since filters and returns new clock', async () => {
  await push([{ id: 1, entity: 'store', entity_id: 1, op: 'upsert', payload: { id: 1, name: 'A' } }]);
  const t1 = (await pull(null)).json.since;

  await push([{ id: 2, entity: 'store', entity_id: 2, op: 'upsert', payload: { id: 2, name: 'B' } }]);
  const { json } = await pull(t1);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].payload.id, 2);
});

test('pull returns items sorted by updated_at ascending', async () => {
  await push([{ id: 1, entity: 'store', entity_id: 1, op: 'upsert', payload: { id: 1, name: 'A' } }]);
  await push([{ id: 2, entity: 'store', entity_id: 2, op: 'upsert', payload: { id: 2, name: 'B' } }]);
  const { json } = await pull(null);
  assert.ok(json.items[0].updated_at <= json.items[1].updated_at);
});

test('pull respects limit and sets hasMore / nextSince', async () => {
  const items = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1, entity: 'store', entity_id: i + 1, op: 'upsert',
    payload: { id: i + 1, name: `S${i + 1}` },
  }));
  await push(items);

  const r1 = await pull(null, 10);
  assert.equal(r1.json.items.length, 10);
  assert.equal(r1.json.hasMore, true);
  assert.equal(r1.json.nextSince, r1.json.items[9].updated_at);

  const r2 = await pull(r1.json.nextSince, 10);
  assert.equal(r2.json.items.length, 10);
  assert.equal(r2.json.hasMore, true);

  const r3 = await pull(r2.json.nextSince, 10);
  assert.equal(r3.json.items.length, 5);
  assert.equal(r3.json.hasMore, false);
});

test('pull with exactly limit items reports hasMore:false', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: i + 1, entity: 'store', entity_id: i + 1, op: 'upsert',
    payload: { id: i + 1, name: `S${i + 1}` },
  }));
  await push(items);
  const r = await pull(null, 10);
  assert.equal(r.json.items.length, 10);
  assert.equal(r.json.hasMore, false);
});
