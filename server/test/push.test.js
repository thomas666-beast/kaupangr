import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestPool, truncate, teardown } from './helpers.js';
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

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST /sync/push accepts valid items and echoes accepted ids', async () => {
  const { status, json } = await postJson(`${baseUrl}/sync/push`, {
    items: [
      { id: 1, entity: 'store',    entity_id: 1, op: 'upsert', payload: { id: 1, name: 'A' } },
      { id: 2, entity: 'supplier', entity_id: 1, op: 'upsert', payload: { id: 1, name: 'S' } },
    ],
  });
  assert.equal(status, 200);
  assert.deepEqual(json.accepted, [1, 2]);
  assert.deepEqual(json.rejected, []);
});

test('POST /sync/push rejects an invalid payload but accepts the rest', async () => {
  const { status, json } = await postJson(`${baseUrl}/sync/push`, {
    items: [
      { id: 1, entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' } },
      { id: 2, entity: 'store', op: 'upsert', payload: {} },
    ],
  });
  assert.equal(status, 200);
  assert.deepEqual(json.accepted, [1]);
  assert.equal(json.rejected.length, 1);
  assert.equal(json.rejected[0].id, 2);
});

test('POST /sync/push with non-array body returns 400', async () => {
  const { status, json } = await postJson(`${baseUrl}/sync/push`, { items: 'nope' });
  assert.equal(status, 400);
  assert.match(json.error, /array/);
});

test('POST /sync/push is idempotent', async () => {
  const body = { items: [
    { id: 1, entity: 'store', entity_id: 1, op: 'upsert', payload: { id: 1, name: 'A' } },
  ]};
  await postJson(`${baseUrl}/sync/push`, body);
  await postJson(`${baseUrl}/sync/push`, body);

  const res = await fetch(`${baseUrl}/sync/pull`);
  const { items } = await res.json();
  assert.equal(items.length, 1);
});

test('GET /health is up', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
