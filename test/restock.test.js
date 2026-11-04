import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct, updateProduct } from '../src/main/services/products.js';
import { createSale } from '../src/main/services/sales.js';
import { addMovement, lowStock } from '../src/main/services/stock.js';
import { AuthError, ValidationError } from '../src/shared/errors.js';

let db, storeId, productId;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  storeId   = createStore({ name: 'Shop' }).id;
  productId = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100, reorder_at: 10 }).id;
});

afterEach(() => {
  logout();
  teardown();
});

test('reorder_at defaults to 0 and rejects negatives', () => {
  const p = createProduct({ sku: 'B', name: 'Bravo', price_cents: 100 });
  assert.equal(p.reorder_at, 0);
  assert.throws(
    () => createProduct({ sku: 'C', name: 'Charlie', price_cents: 100, reorder_at: -1 }),
    ValidationError
  );
});

test('updateProduct can change reorder_at', () => {
  updateProduct(productId, { reorder_at: 20 });
  const p = db.prepare(`SELECT reorder_at FROM products WHERE id = ?`).get(productId);
  assert.equal(p.reorder_at, 20);
});

test('lowStock is empty when on-hand is above the reorder point', () => {
  addMovement({ productId, storeId, kind: 'purchase', quantity: 50 });
  assert.equal(lowStock({}).length, 0);
});

test('lowStock lists products at or below the reorder point', () => {
  addMovement({ productId, storeId, kind: 'purchase', quantity: 15 });
  const sale = createSale({ storeId, lines: [{ productId, quantity: 10 }] });   // on_hand = 5 < 10
  const r = lowStock({});
  assert.equal(r.length, 1);
  assert.equal(r[0].id, productId);
  assert.equal(r[0].on_hand, 5);
  assert.equal(r[0].reorder_at, 10);
});

test('products with reorder_at = 0 are never listed', () => {
  const p = createProduct({ sku: 'Z', name: 'Zero', price_cents: 100 });   // reorder_at default 0
  addMovement({ productId: p.id, storeId, kind: 'purchase', quantity: 1 });

  const r = lowStock({});
  // A (created in beforeEach, reorder_at 10, no stock) is legitimately low-stock.
  // Z has reorder_at 0 and must not appear.
  assert.ok(!r.some(x => x.sku === 'Z'));
});

test('lowStock sorts by the biggest shortage first', () => {
  const p2 = createProduct({ sku: 'B', name: 'Bravo', price_cents: 100, reorder_at: 20 }).id;
  // A: 10 - 8 = 2 missing, B: 20 - 0 = 20 missing
  addMovement({ productId, storeId, kind: 'purchase', quantity: 8 });
  const r = lowStock({});
  assert.equal(r[0].sku, 'B');
  assert.equal(r[1].sku, 'A');
});

test('lowStock respects storeId filter', () => {
  const storeB = createStore({ name: 'Other' }).id;
  addMovement({ productId, storeId, kind: 'purchase', quantity: 3 });
  addMovement({ productId, storeId: storeB, kind: 'purchase', quantity: 20 });

  const onlyA = lowStock({ storeId });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].on_hand, 3);

  const onlyB = lowStock({ storeId: storeB });
  assert.equal(onlyB.length, 0);   // on-hand 20 ≥ reorder_at 10
});

test('lowStock requires a signed-in user', () => {
  logout();
  assert.throws(() => lowStock({}), AuthError);
});
