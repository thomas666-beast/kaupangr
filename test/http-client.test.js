import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pushItems, pullItems } from '../src/main/services/http-client.js';

const realFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = realFetch; });

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
// URL building
// ------------------------------------------------------------------
test('pushItems POSTs JSON to /sync/push', async () => {
  const calls = fakeFetch(() => jsonResponse(200, { accepted: [1, 2], rejected: [] }));
  const items = [{ id: 1, entity: 'sale', entity_id: 5, op: 'upsert', payload: {}, created_at: 'x' }];

  const r = await pushItems('http://localhost:3000', items);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { accepted: [1, 2], rejected: [] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:3000/sync/push');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(sentBody, { items });
});

test('base URL trailing slashes are collapsed', async () => {
  const calls = fakeFetch(() => jsonResponse(200, {}));
  await pushItems('http://h:1///', []);
  assert.equal(calls[0].url, 'http://h:1/sync/push');
});

test('pullItems GETs /sync/pull without since', async () => {
  const calls = fakeFetch(() => jsonResponse(200, { items: [], since: null }));
  const r = await pullItems('http://h:1', null);
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'http://h:1/sync/pull');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
});

test('pullItems URL-encodes since', async () => {
  const calls = fakeFetch(() => jsonResponse(200, { items: [], since: '2026-01-01T00:00:00.000Z' }));
  await pullItems('http://h:1', '2026-01-01T00:00:00.000Z');
  assert.equal(
    calls[0].url,
    'http://h:1/sync/pull?since=2026-01-01T00%3A00%3A00.000Z'
  );
});

// ------------------------------------------------------------------
// HTTP error handling
// ------------------------------------------------------------------
test('non-2xx with { error } produces HTTP_<status> and message', async () => {
  fakeFetch(() => jsonResponse(500, { error: 'db down' }));
  const r = await pushItems('http://h:1', []);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'HTTP_500');
  assert.equal(r.error.status, 500);
  assert.equal(r.error.message, 'db down');
});

test('non-2xx with { message } uses it', async () => {
  fakeFetch(() => jsonResponse(400, { message: 'bad payload' }));
  const r = await pushItems('http://h:1', []);
  assert.equal(r.error.message, 'bad payload');
});

test('non-2xx with a plain body falls back to "HTTP <status>"', async () => {
  fakeFetch(() => jsonResponse(502, 'gateway is dead'));
  const r = await pushItems('http://h:1', []);
  assert.equal(r.error.message, 'HTTP 502');
});

test('non-2xx with malformed JSON in the error body still produces a clean error', async () => {
  fakeFetch(() => jsonResponse(500, 'not-json'));
  const r = await pushItems('http://h:1', []);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'HTTP_500');
});

// ------------------------------------------------------------------
// transport-level failures
// ------------------------------------------------------------------
test('network error becomes NETWORK', async () => {
  fakeFetch(() => { throw new Error('ECONNREFUSED'); });
  const r = await pullItems('http://h:1', null);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NETWORK');
  assert.match(r.error.message, /ECONNREFUSED/);
});

test('timeout becomes TIMEOUT', async () => {
  // fakeFetch returns a promise that only rejects when the abort signal fires.
  fakeFetch((_url, init) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      rej(err);
    });
  }));
  const r = await pullItems('http://h:1', null, { timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'TIMEOUT');
});

test('missing fetch returns NO_FETCH', async () => {
  globalThis.fetch = undefined;
  const r = await pushItems('http://h:1', []);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NO_FETCH');
});

// ------------------------------------------------------------------
// body parsing
// ------------------------------------------------------------------
test('2xx with invalid JSON becomes BAD_JSON', async () => {
  fakeFetch(() => jsonResponse(200, '<html>not json</html>'));
  const r = await pullItems('http://h:1', null);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'BAD_JSON');
});

test('2xx with empty body returns data:null', async () => {
  fakeFetch(() => jsonResponse(200, ''));
  const r = await pushItems('http://h:1', []);
  assert.equal(r.ok, true);
  assert.equal(r.data, null);
});

// ------------------------------------------------------------------
// caller bug: missing baseUrl
// ------------------------------------------------------------------
test('missing baseUrl throws synchronously (caller bug)', async () => {
  await assert.rejects(pushItems(null, []), /baseUrl is required/);
});
