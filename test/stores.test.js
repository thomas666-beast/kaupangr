import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import {
  listStores, createStore, updateStore, setStoreActive,
} from '../src/main/services/stores.js';
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

function ensureUser(login_, role) {
  const exists = db.prepare(`SELECT id FROM users WHERE login = ?`).get(login_);
  if (exists) return;
  const hash = db.prepare(`SELECT password_hash FROM users WHERE login='admin'`).get().password_hash;
  db.prepare(`INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)`).run(login_, hash, role);
}
function loginAsSeller() { ensureUser('seller1', 'seller'); login('seller1', 'admin'); }
function loginAsPM()     { ensureUser('pm1', 'product_manager'); login('pm1', 'admin'); }

test('listStores requires a signed-in user', () => {
  assert.throws(() => listStores(), AuthError);
});

test('listStores returns { rows, total } for any signed-in role', () => {
  loginAsSeller();
  assert.deepEqual(listStores(), { rows: [], total: 0 });

  logout();
  login('admin', 'admin');
  createStore({ name: 'Main Shop' });
  logout();
  loginAsSeller();
  const r = listStores();
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].name, 'Main Shop');
});

test('listStores paginates', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) createStore({ name: `Store ${i}` });
  const p1 = listStores({ offset: 0, limit: 2 });
  const p2 = listStores({ offset: 2, limit: 2 });
  const p3 = listStores({ offset: 4, limit: 2 });

  assert.equal(p1.total, 5);
  assert.equal(p1.rows.length, 2);
  assert.equal(p2.rows.length, 2);
  assert.equal(p3.rows.length, 1);
});

test('listStores q matches name or address', () => {
  login('admin', 'admin');
  createStore({ name: 'Alpha Shop', address: 'High Street' });
  createStore({ name: 'Bravo',      address: 'Alpha Road' });

  assert.equal(listStores({ q: 'alpha' }).total, 2);
  assert.equal(listStores({ q: 'high' }).total, 1);
});

test('listStores activeOnly', () => {
  login('admin', 'admin');
  const a = createStore({ name: 'Active' });
  const b = createStore({ name: 'Inactive' });
  setStoreActive(b.id, false);

  assert.equal(listStores({ activeOnly: true }).total, 1);
  assert.equal(listStores({ activeOnly: true }).rows[0].name, 'Active');
  assert.equal(listStores({}).total, 2);
});

test('createStore requires name', () => {
  login('admin', 'admin');
  assert.throws(() => createStore({ name: '' }), ValidationError);
  assert.throws(() => createStore({ name: '   ' }), ValidationError);
  assert.throws(() => createStore({}), ValidationError);
});

test('createStore trims the name and returns the row', () => {
  login('admin', 'admin');
  const s = createStore({ name: '  Main Shop  ', address: '1 High St' });
  assert.equal(s.name, 'Main Shop');
  assert.equal(s.address, '1 High St');
  assert.equal(s.is_active, 1);
});

test('createStore is forbidden for sellers; allowed for PM', () => {
  loginAsSeller();
  assert.throws(() => createStore({ name: 'X' }), ForbiddenError);
  logout();
  loginAsPM();
  assert.ok(createStore({ name: 'PM Shop' }));
});

test('updateStore changes only the fields provided', () => {
  login('admin', 'admin');
  const s = createStore({ name: 'Old', address: 'Old St' });
  const updated = updateStore(s.id, { name: 'New' });
  assert.equal(updated.name, 'New');
  assert.equal(updated.address, 'Old St');
  const updated2 = updateStore(s.id, { address: 'New St' });
  assert.equal(updated2.name, 'New');
  assert.equal(updated2.address, 'New St');
});

test('updateStore rejects empty name and unknown id', () => {
  login('admin', 'admin');
  const s = createStore({ name: 'Shop' });
  assert.throws(() => updateStore(s.id, { name: '' }), ValidationError);
  assert.throws(() => updateStore(9999, { name: 'x' }), ValidationError);
});

test('updateStore is forbidden for sellers', () => {
  login('admin', 'admin');
  const s = createStore({ name: 'Shop' });
  logout();
  loginAsSeller();
  assert.throws(() => updateStore(s.id, { name: 'X' }), ForbiddenError);
});

test('setStoreActive toggles and returns the row', () => {
  login('admin', 'admin');
  const s = createStore({ name: 'Shop' });
  assert.equal(setStoreActive(s.id, false).is_active, 0);
  assert.equal(setStoreActive(s.id, true).is_active, 1);
});
