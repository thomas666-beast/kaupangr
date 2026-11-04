import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import {
  ensureBootstrapAdmin,
  login, logout, whoami, requireSession,
} from '../src/main/services/auth.js';
import { AuthError, ForbiddenError } from '../src/shared/errors.js';

let db;

beforeEach(() => {
  db = makeTestDb();
});

afterEach(() => {
  logout();
  teardown();
});

test('ensureBootstrapAdmin creates one administrator and is idempotent', () => {
  ensureBootstrapAdmin();
  const users = db.prepare('SELECT login, role FROM users').all();
  assert.equal(users.length, 1);
  assert.equal(users[0].login, 'admin');
  assert.equal(users[0].role, 'administrator');
  ensureBootstrapAdmin();
  const after = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  assert.equal(after, 1);
});

test('login returns the session user and opens one active session row', () => {
  ensureBootstrapAdmin();
  const u = login('admin', 'admin');
  assert.equal(u.login, 'admin');
  assert.equal(u.role, 'administrator');
  const rows = db.prepare(`SELECT user_id, ended_at FROM sessions`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ended_at, null);
  assert.deepEqual(whoami(), { userId: u.userId, login: 'admin', role: 'administrator' });
});

test('login with wrong password throws AuthError and opens no session', () => {
  ensureBootstrapAdmin();
  assert.throws(() => login('admin', 'nope'), AuthError);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get().n, 0);
  assert.equal(whoami(), null);
});

test('login with unknown user throws AuthError', () => {
  ensureBootstrapAdmin();
  assert.throws(() => login('ghost', 'whatever'), AuthError);
});

test('inactive user cannot log in even with the right password', () => {
  ensureBootstrapAdmin();
  db.prepare(`UPDATE users SET is_active = 0 WHERE login = 'admin'`).run();
  assert.throws(() => login('admin', 'admin'), AuthError);
});

test('a second login ends the first session — only one active at a time', () => {
  ensureBootstrapAdmin();
  login('admin', 'admin');
  login('admin', 'admin');
  const rows = db.prepare(`SELECT ended_at FROM sessions ORDER BY id`).all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ended_at == null, false);
  assert.equal(rows[1].ended_at, null);
  const active = db.prepare(
    `SELECT COUNT(*) AS n FROM sessions
      WHERE ended_at IS NULL AND user_id = (SELECT id FROM users WHERE login='admin')`
  ).get().n;
  assert.equal(active, 1);
});

test('logout closes the session and clears whoami', () => {
  ensureBootstrapAdmin();
  login('admin', 'admin');
  logout();
  const active = db.prepare(
    `SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NULL`
  ).get().n;
  assert.equal(active, 0);
  assert.equal(whoami(), null);
});

test('logout when signed out is a no-op', () => {
  logout();
  assert.equal(whoami(), null);
});

test('requireSession throws AuthError when signed out', () => {
  assert.throws(() => requireSession(), AuthError);
  assert.throws(() => requireSession('administrator'), AuthError);
});

test('requireSession throws ForbiddenError on wrong role', () => {
  ensureBootstrapAdmin();
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES (?, ?, 'seller')`
  ).run('seller1', db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash);
  login('seller1', 'admin');
  assert.throws(() => requireSession('administrator'), ForbiddenError);
  assert.throws(() => requireSession('product_manager'), ForbiddenError);
  const me = requireSession('seller');
  assert.equal(me.role, 'seller');
});

test('requireSession with no roles allows any signed-in user', () => {
  ensureBootstrapAdmin();
  login('admin', 'admin');
  const me = requireSession();
  assert.equal(me.login, 'admin');
});
