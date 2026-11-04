import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import {
  listUsers, createUser, updateUser, setActive,
} from '../src/main/services/users.js';
import { AuthError, ForbiddenError, ValidationError } from '../src/shared/errors.js';

let db;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
});

afterEach(() => {
  logout();
  teardown();
});

function loginAsSeller() {
  db.prepare(
    `INSERT INTO users (login, password_hash, role) VALUES (?, ?, 'seller')`
  ).run('seller1', db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash);
  login('seller1', 'admin');
}

test('users service requires an administrator', () => {
  assert.throws(() => listUsers(), AuthError);
  loginAsSeller();
  assert.throws(() => listUsers(), ForbiddenError);
});

test('listUsers returns { rows, total }', () => {
  login('admin', 'admin');
  createUser({ login: 'alice', password: 'x', role: 'seller' });
  const r = listUsers();
  assert.equal(r.total, 2);
  assert.equal(r.rows.length, 2);
});

test('listUsers paginates', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) createUser({ login: `u${i}`, password: 'x', role: 'seller' });
  const p1 = listUsers({ offset: 0, limit: 2 });
  const p2 = listUsers({ offset: 2, limit: 2 });
  const p3 = listUsers({ offset: 4, limit: 2 });
  assert.equal(p1.total, 6);   // 5 + admin
  assert.equal(p1.rows.length, 2);
  assert.equal(p3.rows.length, 2);
});

test('listUsers q matches login', () => {
  login('admin', 'admin');
  createUser({ login: 'alice', password: 'x', role: 'seller' });
  createUser({ login: 'bob',   password: 'x', role: 'seller' });
  assert.equal(listUsers({ q: 'ali' }).total, 1);
});

test('listUsers role filter', () => {
  login('admin', 'admin');
  createUser({ login: 'alice', password: 'x', role: 'seller' });
  createUser({ login: 'bob',   password: 'x', role: 'product_manager' });
  assert.equal(listUsers({ role: 'seller' }).total, 1);
  assert.equal(listUsers({ role: 'product_manager' }).total, 1);
  assert.equal(listUsers({ role: 'administrator' }).total, 1);
});

test('listUsers activeOnly', () => {
  login('admin', 'admin');
  const u = createUser({ login: 'alice', password: 'x', role: 'seller' });
  createUser({ login: 'bob', password: 'x', role: 'seller' });
  setActive(u.id, false);
  assert.equal(listUsers({ activeOnly: true }).total, 2);   // admin + bob
});

test('createUser validates fields', () => {
  login('admin', 'admin');
  assert.throws(() => createUser({ login: '', password: 'p', role: 'seller' }), ValidationError);
  assert.throws(() => createUser({ login: 'x', password: '', role: 'seller' }), ValidationError);
  assert.throws(() => createUser({ login: 'x', password: 'p', role: 'boss' }), ValidationError);
});

test('createUser inserts and returns the row (no password_hash)', () => {
  login('admin', 'admin');
  const u = createUser({ login: 'alice', password: 'secret', role: 'seller' });
  assert.ok(Number.isInteger(u.id));
  assert.equal(u.login, 'alice');
  assert.equal(u.password_hash, undefined);
});

test('createUser rejects duplicate login', () => {
  login('admin', 'admin');
  createUser({ login: 'alice', password: 'x', role: 'seller' });
  assert.throws(() => createUser({ login: 'alice', password: 'y', role: 'seller' }), ValidationError);
});

test('updateUser can change login, role, password', () => {
  login('admin', 'admin');
  const u = createUser({ login: 'alice', password: 'old', role: 'seller' });
  const byLogin = updateUser(u.id, { login: 'alice2' });
  assert.equal(byLogin.login, 'alice2');
  updateUser(u.id, { password: 'new' });
  logout();
  const me = login('alice2', 'new');
  assert.equal(me.role, 'seller');
});

test('updateUser rejects unknown id and duplicate login', () => {
  login('admin', 'admin');
  const a = createUser({ login: 'a', password: 'x', role: 'seller' });
  const b = createUser({ login: 'b', password: 'x', role: 'seller' });
  assert.throws(() => updateUser(9999, { login: 'z' }), ValidationError);
  assert.throws(() => updateUser(b.id, { login: 'a' }), ValidationError);
});

test('cannot demote or deactivate the last administrator', () => {
  login('admin', 'admin');
  const admin = db.prepare(`SELECT id FROM users WHERE login='admin'`).get();
  assert.throws(() => updateUser(admin.id, { role: 'seller' }), ValidationError);
  assert.throws(() => updateUser(admin.id, { is_active: false }), ValidationError);
});

test('setActive toggles', () => {
  login('admin', 'admin');
  const u = createUser({ login: 'bob', password: 'x', role: 'seller' });
  assert.equal(setActive(u.id, false).is_active, 0);
  assert.equal(setActive(u.id, true).is_active, 1);
});

test('an inactive user cannot log in', () => {
  login('admin', 'admin');
  createUser({ login: 'bob', password: 'x', role: 'seller' });
  const id = db.prepare(`SELECT login FROM users WHERE login='bob'`).get();
  const uid = db.prepare(`SELECT id FROM users WHERE login='bob'`).get().id;
  setActive(uid, false);
  logout();
  assert.throws(() => login('bob', 'x'), AuthError);
});
