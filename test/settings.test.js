import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { getSyncSettings, updateSyncSettings } from '../src/main/services/settings.js';
import { AuthError, ForbiddenError } from '../src/shared/errors.js';

let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
});

afterEach(() => {
  logout();
  teardown();
});

test('settings require an administrator', () => {
  assert.throws(() => getSyncSettings(), AuthError);
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES (?, ?, 'seller')`
  ).run('seller1', db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash);
  login('seller1', 'admin');
  assert.throws(() => getSyncSettings(), ForbiddenError);
  assert.throws(() => updateSyncSettings({ server_url: 'x' }), ForbiddenError);
});

test('settings defaults are correct', () => {
  login('admin', 'admin');
  const s = getSyncSettings();
  assert.equal(s.server_url, '');
  assert.equal(s.sync_enabled, false);
  assert.equal(s.sync_auto, true);
  assert.equal(s.sync_interval_sec, 300);
  assert.equal(s.sync_push_chunk, 100);
  assert.equal(s.sync_pull_chunk, 500);
});

test('updateSyncSettings persists and round-trips', () => {
  login('admin', 'admin');
  const updated = updateSyncSettings({
    server_url: '  http://localhost:3000  ',
    sync_enabled: true,
  });
  assert.equal(updated.server_url, 'http://localhost:3000');
  assert.equal(updated.sync_enabled, true);
  assert.deepEqual(getSyncSettings(), updated);
});

test('updateSyncSettings can toggle one field without touching the other', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://a' });
  updateSyncSettings({ sync_enabled: true });
  const s = getSyncSettings();
  assert.equal(s.server_url, 'http://a');
  assert.equal(s.sync_enabled, true);
});

test('app_meta gets one row per setting', () => {
  login('admin', 'admin');
  updateSyncSettings({ server_url: 'http://x', sync_enabled: true });
  const keys = db.prepare(`SELECT key FROM app_meta ORDER BY key`).all().map(r => r.key);
  assert.ok(keys.includes('server_url'));
  assert.ok(keys.includes('sync_enabled'));
});

test('sync_push_chunk clamps to [10, 1000], defaults to 100', () => {
  login('admin', 'admin');
  assert.equal(getSyncSettings().sync_push_chunk, 100);

  updateSyncSettings({ sync_push_chunk: 5 });          // below floor
  assert.equal(getSyncSettings().sync_push_chunk, 100);

  updateSyncSettings({ sync_push_chunk: 5000 });       // above ceiling
  assert.equal(getSyncSettings().sync_push_chunk, 100);

  updateSyncSettings({ sync_push_chunk: 250 });        // valid
  assert.equal(getSyncSettings().sync_push_chunk, 250);
});

test('sync_pull_chunk clamps to [10, 1000], defaults to 500', () => {
  login('admin', 'admin');
  assert.equal(getSyncSettings().sync_pull_chunk, 500);

  updateSyncSettings({ sync_pull_chunk: 5 });          // below floor
  assert.equal(getSyncSettings().sync_pull_chunk, 500);

  updateSyncSettings({ sync_pull_chunk: 5000 });       // above ceiling
  assert.equal(getSyncSettings().sync_pull_chunk, 500);

  updateSyncSettings({ sync_pull_chunk: 200 });        // valid
  assert.equal(getSyncSettings().sync_pull_chunk, 200);
});

test('sync_interval_sec clamps to >= 30, defaults to 300', () => {
  login('admin', 'admin');
  assert.equal(getSyncSettings().sync_interval_sec, 300);

  updateSyncSettings({ sync_interval_sec: 5 });
  assert.equal(getSyncSettings().sync_interval_sec, 300);

  updateSyncSettings({ sync_interval_sec: 60 });
  assert.equal(getSyncSettings().sync_interval_sec, 60);
});
