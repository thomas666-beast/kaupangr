import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createSupplier } from '../src/main/services/suppliers.js';
import {
  listProducts, createProduct, updateProduct, setProductActive,
  findBySku, searchProducts,
} from '../src/main/services/products.js';
import { AuthError, ForbiddenError, ValidationError } from '../src/shared/errors.js';

let db;
let supplierId;
let supplierB;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  supplierId = createSupplier({ name: 'Acme' }).id;
  supplierB  = createSupplier({ name: 'Bravo' }).id;
  logout();
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

// ------------------------------------------------------------------
// list — new shape
// ------------------------------------------------------------------
test('listProducts requires a signed-in user', () => {
  assert.throws(() => listProducts(), AuthError);
});

test('listProducts returns { rows, total } and joins supplier_name', () => {
  login('admin', 'admin');
  createProduct({ sku: 'SKU-1', name: 'Widget', price_cents: 499, supplier_id: supplierId });
  logout();

  loginAsSeller();
  const r = listProducts();
  assert.equal(r.total, 1);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].sku, 'SKU-1');
  assert.equal(r.rows[0].supplier_name, 'Acme');
});

test('listProducts default limit is 50', () => {
  login('admin', 'admin');
  for (let i = 0; i < 60; i++) {
    createProduct({ sku: `SKU-${i}`, name: `Item ${i}`, price_cents: 100 });
  }
  const r = listProducts();
  assert.equal(r.total, 60);
  assert.equal(r.rows.length, 50);
});

test('listProducts paginates with offset and limit', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) {
    createProduct({ sku: `SKU-${i}`, name: `Item ${i}`, price_cents: 100 });
  }
  const p1 = listProducts({ offset: 0, limit: 2 });
  const p2 = listProducts({ offset: 2, limit: 2 });
  const p3 = listProducts({ offset: 4, limit: 2 });

  assert.equal(p1.total, 5);
  assert.equal(p1.rows.length, 2);
  assert.equal(p2.rows.length, 2);
  assert.equal(p3.rows.length, 1);

  const ids = [...p1.rows, ...p2.rows, ...p3.rows].map(r => r.id);
  assert.equal(new Set(ids).size, 5);
});

test('listProducts clamps limit to 200 and defaults invalid offset to 0', () => {
  login('admin', 'admin');
  for (let i = 0; i < 220; i++) {
    createProduct({ sku: `SKU-${i}`, name: `Item ${i}`, price_cents: 100 });
  }
  const r = listProducts({ limit: 5000 });
  assert.ok(r.rows.length <= 200);

  const r2 = listProducts({ offset: -5, limit: 10 });
  assert.ok(r2.rows.length <= 10);
});

test('listProducts q matches sku or name, case-insensitive', () => {
  login('admin', 'admin');
  createProduct({ sku: 'WID-1', name: 'Blue Widget', price_cents: 100 });
  createProduct({ sku: 'GAD-9', name: 'Red Gadget',   price_cents: 200 });

  const bySku  = listProducts({ q: 'wid' });
  assert.equal(bySku.total, 1);
  assert.equal(bySku.rows[0].sku, 'WID-1');

  const byName = listProducts({ q: 'gadget' });
  assert.equal(byName.total, 1);
  assert.equal(byName.rows[0].sku, 'GAD-9');
});

test('listProducts supplierId filters', () => {
  login('admin', 'admin');
  createProduct({ sku: 'A', name: 'From A', price_cents: 100, supplier_id: supplierId });
  createProduct({ sku: 'B', name: 'From B', price_cents: 100, supplier_id: supplierB });
  createProduct({ sku: 'C', name: 'No supplier', price_cents: 100 });

  assert.equal(listProducts({ supplierId }).total, 1);
  assert.equal(listProducts({ supplierId: supplierB }).total, 1);
  assert.equal(listProducts({}).total, 3);
});

test('listProducts activeOnly=true returns only active', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: 'A', name: 'A', price_cents: 100 });
  createProduct({ sku: 'B', name: 'B', price_cents: 100 });
  setProductActive(p.id, false);

  assert.equal(listProducts({ activeOnly: true }).total, 1);
  assert.equal(listProducts({ activeOnly: true }).rows[0].sku, 'B');
  assert.equal(listProducts({}).total, 2);
});

// ------------------------------------------------------------------
// create / update / setActive (unchanged behavior; update to use .rows where needed)
// ------------------------------------------------------------------
test('createProduct validates sku, name, price_cents', () => {
  login('admin', 'admin');
  assert.throws(() => createProduct({ sku: '', name: 'X', price_cents: 1 }), ValidationError);
  assert.throws(() => createProduct({ sku: 'S', name: '', price_cents: 1 }), ValidationError);
  assert.throws(() => createProduct({ sku: 'S', name: 'X', price_cents: -1 }), ValidationError);
  assert.throws(() => createProduct({ sku: 'S', name: 'X', price_cents: 1.5 }), ValidationError);
  assert.throws(() => createProduct({ sku: 'S', name: 'X' }), ValidationError);
});

test('createProduct rejects unknown supplier_id', () => {
  login('admin', 'admin');
  assert.throws(
    () => createProduct({ sku: 'S', name: 'X', price_cents: 100, supplier_id: 9999 }),
    ValidationError
  );
});

test('createProduct trims sku and name', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: '  SKU-1  ', name: '  Widget  ', price_cents: 499, supplier_id: supplierId });
  assert.equal(p.sku, 'SKU-1');
  assert.equal(p.name, 'Widget');
});

test('createProduct enforces sku uniqueness', () => {
  login('admin', 'admin');
  createProduct({ sku: 'DUP', name: 'A', price_cents: 100 });
  assert.throws(() => createProduct({ sku: 'DUP', name: 'B', price_cents: 100 }), ValidationError);
});

test('createProduct is forbidden for sellers; allowed for PM', () => {
  loginAsSeller();
  assert.throws(() => createProduct({ sku: 'X', name: 'X', price_cents: 100 }), ForbiddenError);
  logout();
  loginAsPM();
  const p = createProduct({ sku: 'PM-1', name: 'PM thing', price_cents: 999 });
  assert.equal(p.sku, 'PM-1');
});

test('updateProduct changes only the fields provided', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: 'SKU-1', name: 'Old', price_cents: 100, supplier_id: supplierId });
  const u1 = updateProduct(p.id, { name: 'New' });
  assert.equal(u1.name, 'New');
  assert.equal(u1.sku, 'SKU-1');
  const u2 = updateProduct(p.id, { price_cents: 250 });
  assert.equal(u2.price_cents, 250);
  const u3 = updateProduct(p.id, { supplier_id: null });
  assert.equal(u3.supplier_id, null);
});

test('updateProduct enforces sku uniqueness', () => {
  login('admin', 'admin');
  createProduct({ sku: 'A', name: 'A', price_cents: 100 });
  const b = createProduct({ sku: 'B', name: 'B', price_cents: 100 });
  assert.throws(() => updateProduct(b.id, { sku: 'A' }), ValidationError);
});

test('updateProduct is forbidden for sellers', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: 'SKU-1', name: 'X', price_cents: 100 });
  logout();
  loginAsSeller();
  assert.throws(() => updateProduct(p.id, { name: 'Y' }), ForbiddenError);
});

test('setProductActive toggles', () => {
  login('admin', 'admin');
  const p = createProduct({ sku: 'SKU-1', name: 'X', price_cents: 100 });
  assert.equal(setProductActive(p.id, false).is_active, 0);
  assert.equal(setProductActive(p.id, true).is_active, 1);
});

// ------------------------------------------------------------------
// findBySku / searchProducts (unchanged)
// ------------------------------------------------------------------
test('findBySku requires a signed-in user, is case-insensitive, returns null on miss', () => {
  assert.throws(() => findBySku('SKU-1'), AuthError);
  login('admin', 'admin');
  assert.equal(findBySku('NOPE'), null);
  createProduct({ sku: 'SKU-1', name: 'Widget', price_cents: 499 });
  assert.equal(findBySku('sku-1').sku, 'SKU-1');
  assert.throws(() => findBySku(''), ValidationError);
});

test('searchProducts requires a signed-in user and skips inactive', () => {
  assert.throws(() => searchProducts('x'), AuthError);
  login('admin', 'admin');
  const p = createProduct({ sku: 'SKU-1', name: 'Widget', price_cents: 100 });
  setProductActive(p.id, false);
  assert.deepEqual(searchProducts('widget'), []);
});

test('searchProducts matches sku or name, case-insensitive, caps at 20', () => {
  login('admin', 'admin');
  createProduct({ sku: 'WID-1', name: 'Blue Widget', price_cents: 100 });
  createProduct({ sku: 'GAD-9', name: 'Red Gadget',   price_cents: 200 });
  assert.equal(searchProducts('wid')[0].sku, 'WID-1');
  assert.equal(searchProducts('gadget')[0].sku, 'GAD-9');

  for (let i = 0; i < 30; i++) {
    createProduct({ sku: `X-${i}`, name: `Widget ${i}`, price_cents: 100 });
  }
  assert.ok(searchProducts('Widget').length <= 20);
});
