import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { updateSyncSettings } from '../src/main/services/settings.js';
import { createStore } from '../src/main/services/stores.js';
import { listPending } from '../src/main/services/sync-queue.js';
import {
  runAutoSyncOnce, canRunNow, stopAutoSync, _resetAutoSyncForTests,
} from '../src/main/services/auto-sync.js';

const realFetch = globalThis.fetch;
let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  _resetAutoSyncForTests();
});

afterEach(() => {
  logout();
  _resetAutoSyncForTests();
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

// ------------------------------------------------------------------
// canRunNow — every skip reason
// ------------------------------------------------------------------
test('skip: not signed in', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });
  logout();

  assert.deepEqual(canRunNow(), { ok: false, reason: 'no-session' });
});

test('skip: sync disabled', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: false, sync_auto: true });

  assert.deepEqual(canRunNow(), { ok: false, reason: 'sync-disabled' });
});

test('skip: auto disabled', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: false });

  assert.deepEqual(canRunNow(), { ok: false, reason: 'auto-disabled' });
});

test('skip: no URL', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: '', sync_enabled: true, sync_auto: true });

  assert.deepEqual(canRunNow(), { ok: false, reason: 'no-url' });
});

test('ok: all conditions met', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });

  assert.deepEqual(canRunNow(), { ok: true });
});

// ------------------------------------------------------------------
// runAutoSyncOnce — skips quietly
// ------------------------------------------------------------------
test('runAutoSyncOnce returns { skipped } when disabled', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: false });

  const r = await runAutoSyncOnce();
  assert.equal(r.skipped, 'sync-disabled');
});

test('runAutoSyncOnce makes no HTTP call when skipped', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });
  logout();          // force no-session

  const calls = fakeFetch(() => jsonResponse(200, {}));
  const r = await runAutoSyncOnce();
  assert.equal(r.skipped, 'no-session');
  assert.equal(calls.length, 0);
});

// ------------------------------------------------------------------
// runAutoSyncOnce — happy path
// ------------------------------------------------------------------
test('runAutoSyncOnce pushes pending rows and pulls remote items', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });
  createStore({ name: 'Local Shop' });
  const pending = listPending();
  assert.equal(pending.length, 1);

  const calls = fakeFetch((url) => {
    if (url.endsWith('/sync/push'))
      return jsonResponse(200, { accepted: pending.map(p => p.id), rejected: [] });
    return jsonResponse(200, {
      items: [{ entity: 'store', op: 'upsert', payload: { id: 700, name: 'Remote Shop' } }],
      since: '2026-01-01T00:00:00.000Z',
    });
  });

  const r = await runAutoSyncOnce();
  assert.equal(r.ok, true);
  assert.equal(r.push.accepted, 1);
  assert.equal(r.pull.applied, 1);
  assert.equal(calls.length, 2);
  assert.equal(listPending().length, 0);
});

// ------------------------------------------------------------------
// runAutoSyncOnce — failures don't throw
// ------------------------------------------------------------------
test('runAutoSyncOnce returns ok:false on HTTP failure, does not throw', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });
  createStore({ name: 'Local Shop' });

  fakeFetch(() => jsonResponse(500, { error: 'boom' }));

  const r = await runAutoSyncOnce();
  assert.equal(r.ok, false);
  assert.equal(listPending().length, 1);   // outbox untouched
});

test('runAutoSyncOnce catches unexpected exceptions', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });

  globalThis.fetch = async () => { throw new Error('kaboom'); };

  const r = await runAutoSyncOnce();
  // sync-engine converts network errors into a failure, not a throw — so ok:false.
  assert.equal(r.ok, false);
});

// ------------------------------------------------------------------
// onTick callback
// ------------------------------------------------------------------
test('runAutoSyncOnce invokes onTick with the result', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });

  globalThis.fetch = async (url) => {
    if (url.endsWith('/sync/push')) return jsonResponse(200, { accepted: [], rejected: [] });
    return jsonResponse(200, { items: [], since: '2026-01-01T00:00:00.000Z' });
  };

  let seen = null;
  await runAutoSyncOnce((r) => { seen = r; });
  assert.ok(seen);
  assert.equal(seen.ok, true);
  assert.ok(seen.at);
});

// ------------------------------------------------------------------
// overlap protection
// ------------------------------------------------------------------
test('canRunNow returns in-flight while a run is in progress', async () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true, sync_auto: true });

  // Fake fetch that never resolves — keeps inFlight = true.
  globalThis.fetch = () => new Promise(() => { /* never */ });

  const first = runAutoSyncOnce();        // in flight, no await
  // Let microtasks settle so inFlight is set.
  await new Promise(r => setTimeout(r, 0));

  assert.deepEqual(canRunNow(), { ok: false, reason: 'in-flight' });

  // Second call must skip without making a second fetch.
  const second = await runAutoSyncOnce();
  assert.equal(second.skipped, 'in-flight');

  // Don't leave a hanging timer.
  stopAutoSync();
  // `first` is still pending; we don't await it in tests.
  void first;
});
