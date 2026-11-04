import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import {
  listSuppliers, createSupplier, updateSupplier, setSupplierActive,
} from '../src/main/services/suppliers.js';
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

test('listSuppliers requires a signed-in user', () => {
  assert.throws(() => listSuppliers(), AuthError);
});

test('listSuppliers returns { rows, total } for sellers', () => {
  login('admin', 'admin');
  createSupplier({ name: 'Acme', contact: 'orders@acme', address: '1 Acme Way' });
  logout();
  loginAsSeller();
  const r = listSuppliers();
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].name, 'Acme');
  assert.equal(r.rows[0].address, '1 Acme Way');
});

test('listSuppliers paginates', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) createSupplier({ name: `Sup ${i}` });
  const p1 = listSuppliers({ offset: 0, limit: 2 });
  const p2 = listSuppliers({ offset: 2, limit: 2 });
  const p3 = listSuppliers({ offset: 4, limit: 2 });
  assert.equal(p1.total, 5);
  assert.equal(p1.rows.length, 2);
  assert.equal(p3.rows.length, 1);
});

test('listSuppliers q matches name / contact / address', () => {
  login('admin', 'admin');
  createSupplier({ name: 'Acme',  contact: 'orders@acme', address: 'Industrial Park' });
  createSupplier({ name: 'Bravo', contact: 'sales@bravo', address: 'Main Road' });

  assert.equal(listSuppliers({ q: 'acme' }).total, 1);
  assert.equal(listSuppliers({ q: 'main' }).total, 1);
  assert.equal(listSuppliers({ q: 'orders' }).total, 1);
});

test('listSuppliers activeOnly', () => {
  login('admin', 'admin');
  const a = createSupplier({ name: 'On' });
  const b = createSupplier({ name: 'Off' });
  setSupplierActive(b.id, false);
  assert.equal(listSuppliers({ activeOnly: true }).total, 1);
  assert.equal(listSuppliers({ activeOnly: true }).rows[0].name, 'On');
});

test('createSupplier requires name', () => {
  login('admin', 'admin');
  assert.throws(() => createSupplier({ name: '' }), ValidationError);
  assert.throws(() => createSupplier({}), ValidationError);
});

test('createSupplier persists name, contact and address', () => {
  login('admin', 'admin');
  const s = createSupplier({ name: '  Acme  ', contact: 'c', address: 'a' });
  assert.equal(s.name, 'Acme');
  assert.equal(s.contact, 'c');
  assert.equal(s.address, 'a');
});

test('createSupplier defaults contact and address to null', () => {
  login('admin', 'admin');
  const s = createSupplier({ name: 'Bare' });
  assert.equal(s.contact, null);
  assert.equal(s.address, null);
});

test('createSupplier is forbidden for sellers', () => {
  loginAsSeller();
  assert.throws(() => createSupplier({ name: 'X' }), ForbiddenError);
});

test('updateSupplier changes only the fields provided', () => {
  login('admin', 'admin');
  const s = createSupplier({ name: 'Old', contact: 'c1', address: 'A1' });
  const u1 = updateSupplier(s.id, { name: 'New' });
  assert.equal(u1.contact, 'c1');
  assert.equal(u1.address, 'A1');
  const u3 = updateSupplier(s.id, { address: 'A2' });
  assert.equal(u3.address, 'A2');
});

test('updateSupplier rejects empty name and unknown id', () => {
  login('admin', 'admin');
  const s = createSupplier({ name: 'X' });
  assert.throws(() => updateSupplier(s.id, { name: '  ' }), ValidationError);
  assert.throws(() => updateSupplier(9999, { name: 'y' }), ValidationError);
});

test('setSupplierActive toggles', () => {
  login('admin', 'admin');
  const s = createSupplier({ name: 'X' });
  assert.equal(setSupplierActive(s.id, false).is_active, 0);
  assert.equal(setSupplierActive(s.id, true).is_active, 1);
});
