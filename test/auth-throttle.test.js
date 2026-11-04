import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import {
  ensureBootstrapAdmin, login, logout,
} from '../src/main/services/auth.js';
import { AuthError } from '../src/shared/errors.js';

let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
});

afterEach(() => {
  logout();
  teardown();
});

// helper: rewrite attempted_at on login_attempts to simulate elapsed time
function backdateAttempts(login_, seconds) {
  db.prepare(
    `UPDATE login_attempts
        SET attempted_at = datetime(attempted_at, ?)
      WHERE login = ?`
  ).run(`-${seconds} seconds`, login_);
}

// ------------------------------------------------------------------
// Basic throttle
// ------------------------------------------------------------------
test('after 5 failed attempts, login is throttled', () => {
  for (let i = 0; i < 5; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  // 6th attempt — throttled message, no password check.
  assert.throws(() => login('admin', 'admin'), /Too many attempts/);
});

test('successful login clears the counter', () => {
  // 3 wrong attempts
  for (let i = 0; i < 3; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  // correct password resets everything
  login('admin', 'admin');
  logout();

  // 5 fresh wrong attempts should not trigger cooldown yet — the counter
  // had been cleared by the successful login.
  for (let i = 0; i < 4; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  // 5th wrong attempt still allowed (returns "Invalid credentials", not throttled)
  assert.throws(() => login('admin', 'wrong'), /Invalid credentials/);
  // 6th is now throttled
  assert.throws(() => login('admin', 'admin'), /Too many attempts/);
});

// ------------------------------------------------------------------
// Window expiry
// ------------------------------------------------------------------
test('attempts older than the 5-minute window do not count', () => {
  for (let i = 0; i < 5; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  assert.throws(() => login('admin', 'admin'), /Too many attempts/);

  // Pretend 6 minutes have passed since every attempt.
  backdateAttempts('admin', 6 * 60);

  // Now the attempt should succeed — the count was pruned.
  const u = login('admin', 'admin');
  assert.equal(u.login, 'admin');
});

test('attempts inside the window but past the cooldown are retried', () => {
  for (let i = 0; i < 5; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  assert.throws(() => login('admin', 'admin'), /Too many attempts/);

  // Just past the 60-second cooldown, but still within the 5-minute window.
  backdateAttempts('admin', 61);

  // The throttled message is gone, but the wrong password still fails.
  assert.throws(() => login('admin', 'wrong'), /Invalid credentials/);
});

// ------------------------------------------------------------------
// Per-login isolation
// ------------------------------------------------------------------
test('throttle is per login string — locking one does not affect another', () => {
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES ('seller1', (
       SELECT password_hash FROM users WHERE login='admin'
     ), 'seller')`
  ).run();

  for (let i = 0; i < 5; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  assert.throws(() => login('admin', 'admin'), /Too many attempts/);

  // Different login is unaffected.
  const u = login('seller1', 'admin');
  assert.equal(u.login, 'seller1');
});

// ------------------------------------------------------------------
// Unknown login is throttled the same way
// ------------------------------------------------------------------
test('unknown login is throttled the same way (no user enumeration)', () => {
  for (let i = 0; i < 5; i++) {
    assert.throws(() => login('ghost', 'whatever'), AuthError);
  }
  // Both wrong-user and wrong-password paths share the same message when throttled.
  assert.throws(() => login('ghost', 'whatever'), /Too many attempts/);
});

// ------------------------------------------------------------------
// Success right before the counter is full
// ------------------------------------------------------------------
test('four failures then a success on the fifth try works', () => {
  for (let i = 0; i < 4; i++) {
    assert.throws(() => login('admin', 'wrong'), AuthError);
  }
  // 5th attempt is the correct password — accepted.
  const u = login('admin', 'admin');
  assert.equal(u.login, 'admin');
});
