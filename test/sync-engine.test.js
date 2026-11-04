import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { updateSyncSettings } from '../src/main/services/settings.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { listPending } from '../src/main/services/sync-queue.js';
import { pushNow, pullNow, syncNow } from '../src/main/services/sync-engine.js';

const realFetch = globalThis.fetch;
let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
});

afterEach(() => {
  logout();
  teardown();
  globalThis.fetch = realFetch;
});

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function setServer(url = 'http://server.test') {
  updateSyncSettings({ server_url: url, sync_enabled: true });
}

// ------------------------------------------------------------------
// PUSH (unchanged from step 22)
// ------------------------------------------------------------------
test('pushNow returns NO_URL when no server is configured', async () => {
  const r = await pushNow();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_URL');
});

test('pullNow returns NO_URL when no server is configured', async () => {
  const r = await pullNow();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NO_URL');
});

test('pushNow short-circuits when outbox is empty', async () => {
  setServer();
  const calls = fakeFetch(() => jsonResponse(200, { accepted: [], rejected: [] }));
  const r = await pushNow();
  assert.equal(r.ok, true);
  assert.equal(r.pushed, 0);
  assert.equal(calls.length, 0);
});

test('pushNow sends in chunks of 100 by default', async () => {
  setServer();
  for (let i = 0; i < 250; i++) createStore({ name: `S${i}` });
  const sizes = [];
  fakeFetch((_u, init) => {
    const body = JSON.parse(init.body);
    sizes.push(body.items.length);
    return jsonResponse(200, { accepted: body.items.map(i => i.id), rejected: [] });
  });
  const r = await pushNow();
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(r.pushed, 250);
  assert.equal(listPending().length, 0);
});

test('pushNow stops on HTTP failure leaving the rest pending', async () => {
  setServer();
  for (let i = 0; i < 250; i++) createStore({ name: `S${i}` });
  let call = 0;
  fakeFetch((_u, init) => {
    call++;
    if (call === 2) return jsonResponse(500, { error: 'boom' });
    const body = JSON.parse(init.body);
    return jsonResponse(200, { accepted: body.items.map(i => i.id), rejected: [] });
  });
  const r = await pushNow();
  assert.equal(r.ok, false);
  assert.equal(r.pushed, 100);
  assert.equal(listPending().length, 150);
});

// ------------------------------------------------------------------
// PULL — chunking (new)
// ------------------------------------------------------------------
test('pullNow loops until hasMore is false and commits the cursor at the end', async () => {
  setServer();

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return jsonResponse(200, {
        items: [
          { entity: 'store', op: 'upsert', payload: { id: 101, name: 'A' }, updated_at: '2026-01-01T00:00:01.000Z' },
          { entity: 'store', op: 'upsert', payload: { id: 102, name: 'B' }, updated_at: '2026-01-01T00:00:02.000Z' },
        ],
        since: '2026-01-01T00:00:02.000Z',
        hasMore: true,
        nextSince: '2026-01-01T00:00:02.000Z',
      });
    }
    return jsonResponse(200, {
      items: [
        { entity: 'store', op: 'upsert', payload: { id: 103, name: 'C' }, updated_at: '2026-01-01T00:00:03.000Z' },
      ],
      since: '2026-01-01T00:00:03.000Z',
      hasMore: false,
      nextSince: '2026-01-01T00:00:03.000Z',
    });
  };

  const r = await pullNow();
  assert.equal(r.ok, true);
  assert.equal(r.applied, 3);
  assert.equal(calls.length, 2);

  // Second call must include ?since=... from nextSince of the first.
  assert.ok(calls[1].includes('since=2026-01-01T00%3A00%3A02.000Z'));

  // Cursor committed only after the last batch.
  const row = db.prepare(`SELECT value FROM app_meta WHERE key='sync_last_pull'`).get();
  assert.equal(row.value, '2026-01-01T00:00:03.000Z');
});

test('pullNow stops mid-chain on HTTP failure and does not advance the cursor', async () => {
  setServer();

  globalThis.fetch = async (url) => {
    if (url.includes('since=') === false) {
      // First call returns hasMore:true
      return jsonResponse(200, {
        items: [{ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' }, updated_at: '2026-01-01T00:00:01.000Z' }],
        since: '2026-01-01T00:00:01.000Z',
        hasMore: true,
        nextSince: '2026-01-01T00:00:01.000Z',
      });
    }
    // Second call explodes
    return jsonResponse(500, { error: 'boom' });
  };

  const r = await pullNow();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'HTTP_500');
  assert.equal(r.applied, 1);               // first batch was applied

  // Cursor is NOT committed.
  const row = db.prepare(`SELECT value FROM app_meta WHERE key='sync_last_pull'`).get();
  assert.equal(row, undefined);
});

test('pullNow handles a hasMore:true response with no nextSince without infinite looping', async () => {
  setServer();

  globalThis.fetch = async () => jsonResponse(200, {
    items: [{ entity: 'store', op: 'upsert', payload: { id: 1, name: 'A' }, updated_at: '2026-01-01T00:00:01.000Z' }],
    since: '2026-01-01T00:00:01.000Z',
    hasMore: true,
    // deliberately missing nextSince
  });

  const r = await pullNow();
  assert.equal(r.ok, true);
  assert.ok(r.errors.length >= 1);
  assert.match(r.errors[r.errors.length - 1].message, /hasMore without a nextSince/);
});

// ------------------------------------------------------------------
// syncNow round-trip (unchanged)
// ------------------------------------------------------------------
test('syncNow pushes local outbox and then pulls remote items', async () => {
  setServer();
  createStore({ name: 'Local Only' });
  const pending = listPending();
  globalThis.fetch = async (url) => {
    if (url.endsWith('/sync/push'))
      return jsonResponse(200, { accepted: pending.map(p => p.id), rejected: [] });
    return jsonResponse(200, {
      items: [{ entity: 'store', op: 'upsert', payload: { id: 777, name: 'Remote Shop' }, updated_at: '2026-02-02T00:00:00.000Z' }],
      since: '2026-02-02T00:00:00.000Z',
      hasMore: false,
      nextSince: '2026-02-02T00:00:00.000Z',
    });
  };
  const r = await syncNow();
  assert.equal(r.push.ok, true);
  assert.equal(r.pull.ok, true);
  assert.equal(r.pull.applied, 1);
  assert.equal(listPending().length, 0);
});

test('pulled sale reduces local on-hand', async () => {
  setServer();
  login('admin', 'admin');

  // Seed the local product/store so the pulled sale's FKs resolve.
  db.prepare(`INSERT INTO stores (id, name) VALUES (1, 'Shop')`).run();
  db.prepare(
    `INSERT INTO products (id, sku, name, price_cents) VALUES (1, 'SKU-1', 'Alpha', 100)`
  ).run();

  fakeFetch(() => jsonResponse(200, {
    items: [
      { entity: 'sale', op: 'upsert', payload: {
        id: 500, store_id: 1, seller_id: 1, total_cents: 300,
        client_uuid: 'uuid-sale-Y',
        lines: [{ product_id: 1, quantity: 3, unit_price_cents: 100 }],
      }},
    ],
    since: '2026-01-01T00:00:00.000Z',
    hasMore: false,
    nextSince: '2026-01-01T00:00:00.000Z',
  }));

  const r = await pullNow();
  assert.equal(r.ok, true);
  assert.equal(r.applied, 1);

  const { onHand } = await import('../src/main/services/stock.js');
  assert.equal(onHand(1, 1), -3);
});

