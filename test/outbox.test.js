import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import {
  createStore, updateStore, setStoreActive,
} from '../src/main/services/stores.js';
import {
  createSupplier, updateSupplier, setSupplierActive,
} from '../src/main/services/suppliers.js';
import {
  createProduct, updateProduct, setProductActive,
} from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { createReturn } from '../src/main/services/returns.js';

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

function countOutbox(entity) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM sync_queue WHERE entity = ?`
  ).get(entity).n;
}

function lastOutbox(entity) {
  return db.prepare(
    `SELECT entity, entity_id, op, payload FROM sync_queue
       WHERE entity = ? ORDER BY id DESC LIMIT 1`
  ).get(entity);
}

// ------------------------------------------------------------------
// stores
// ------------------------------------------------------------------
test('store writes enqueue one outbox row each', () => {
  const s = createStore({ name: 'Main' });
  assert.equal(countOutbox('store'), 1);
  let row = lastOutbox('store');
  assert.equal(row.entity_id, s.id);
  assert.equal(row.op, 'upsert');
  assert.equal(JSON.parse(row.payload).name, 'Main');

  updateStore(s.id, { name: 'Renamed' });
  assert.equal(countOutbox('store'), 2);
  row = lastOutbox('store');
  assert.equal(JSON.parse(row.payload).name, 'Renamed');

  setStoreActive(s.id, false);
  assert.equal(countOutbox('store'), 3);
  assert.equal(JSON.parse(lastOutbox('store').payload).is_active, 0);
});

test('a failing store update does not enqueue', () => {
  const s = createStore({ name: 'Main' });
  const before = countOutbox('store');
  try { updateStore(s.id, { name: '' }); } catch { /* expected */ }
  assert.equal(countOutbox('store'), before);
});

// ------------------------------------------------------------------
// suppliers
// ------------------------------------------------------------------
test('supplier writes enqueue one outbox row each', () => {
  const s = createSupplier({ name: 'Acme', contact: 'c', address: 'a' });
  assert.equal(countOutbox('supplier'), 1);
  let row = lastOutbox('supplier');
  assert.equal(row.entity_id, s.id);
  assert.equal(JSON.parse(row.payload).address, 'a');

  updateSupplier(s.id, { contact: 'new-c' });
  assert.equal(countOutbox('supplier'), 2);
  assert.equal(JSON.parse(lastOutbox('supplier').payload).contact, 'new-c');

  setSupplierActive(s.id, false);
  assert.equal(countOutbox('supplier'), 3);
  assert.equal(JSON.parse(lastOutbox('supplier').payload).is_active, 0);
});

// ------------------------------------------------------------------
// products
// ------------------------------------------------------------------
test('product writes enqueue one outbox row each', () => {
  const p = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 });
  assert.equal(countOutbox('product'), 1);
  let row = lastOutbox('product');
  assert.equal(row.entity_id, p.id);
  assert.equal(JSON.parse(row.payload).sku, 'A');

  updateProduct(p.id, { price_cents: 200 });
  assert.equal(countOutbox('product'), 2);
  assert.equal(JSON.parse(lastOutbox('product').payload).price_cents, 200);

  setProductActive(p.id, false);
  assert.equal(countOutbox('product'), 3);
  assert.equal(JSON.parse(lastOutbox('product').payload).is_active, 0);
});

test('a duplicate-SKU create does not enqueue', () => {
  createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 });
  const before = countOutbox('product');
  try { createProduct({ sku: 'A', name: 'Other', price_cents: 100 }); } catch { /* expected */ }
  assert.equal(countOutbox('product'), before);
});

// ------------------------------------------------------------------
// sales & returns still exactly one row
// ------------------------------------------------------------------
test('sale and return still write exactly one outbox row each', () => {
  const storeId   = createStore({ name: 'Shop' }).id;
  const productId = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 }).id;

  const saleBefore = countOutbox('sale');
  const sale = createSale({ storeId, lines: [{ productId, quantity: 2 }] });
  assert.equal(countOutbox('sale'), saleBefore + 1);
  assert.equal(lastOutbox('sale').entity_id, sale.id);

  const returnBefore = countOutbox('return');
  const ret = createReturn({
    saleId: sale.id,
    lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }],
  });
  assert.equal(countOutbox('return'), returnBefore + 1);
  assert.equal(lastOutbox('return').entity_id, ret.id);
});
