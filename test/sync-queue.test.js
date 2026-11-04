import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import {
  listPending, markSynced, pendingCount, lastSyncedAt,
} from '../src/main/services/sync-queue.js';

let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
});

afterEach(() => {
  logout();
  teardown();
});

function seed(n) {
  const insert = db.prepare(
    `INSERT INTO sync_queue (entity, entity_id, op, payload)
     VALUES ('sale', ?, 'upsert', '{}')`
  );
  for (let i = 1; i <= n; i++) insert.run(i);
}

test('listPending returns only unsynced rows, oldest first', () => {
  seed(3);
  markSynced([2]);
  const rows = listPending();
  assert.deepEqual(rows.map(r => r.id), [1, 3]);
});

test('listPending respects the limit', () => {
  seed(10);
  const rows = listPending({ limit: 4 });
  assert.equal(rows.length, 4);
});

test('markSynced sets synced_at and is idempotent', () => {
  seed(3);
  const r1 = markSynced([1, 2]);
  assert.deepEqual(r1, { marked: 2 });

  const r2 = markSynced([1, 2]);
  assert.deepEqual(r2, { marked: 0 });

  assert.equal(pendingCount(), 1);
});

test('markSynced([]) is a no-op', () => {
  seed(2);
  assert.deepEqual(markSynced([]), { marked: 0 });
  assert.equal(pendingCount(), 2);
});

test('pendingCount and lastSyncedAt', () => {
  seed(2);
  assert.equal(pendingCount(), 2);
  assert.equal(lastSyncedAt(), null);

  markSynced([1, 2]);
  assert.equal(pendingCount(), 0);
  assert.ok(lastSyncedAt());
});
