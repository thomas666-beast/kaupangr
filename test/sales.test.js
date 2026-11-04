import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createStore } from '../src/main/services/stores.js';
import { createProduct } from '../src/main/services/products.js';
import { createSale, listSales, getSale } from '../src/main/services/sales.js';
import { AuthError, ValidationError } from '../src/shared/errors.js';

let db;
let storeId;
let productA;
let productB;

beforeEach(() => {
  db = makeTestDb();
  ensureBootstrapAdmin();
  login('admin', 'admin');
  storeId  = createStore({ name: 'Main Shop' }).id;
  productA = createProduct({ sku: 'A', name: 'Alpha', price_cents: 100 }).id;
  productB = createProduct({ sku: 'B', name: 'Bravo', price_cents: 250 }).id;
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

// ---- createSale (unchanged) ----
test('createSale requires a signed-in user', () => {
  assert.throws(
    () => createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] }),
    AuthError
  );
});

test('createSale computes total from lines and ignores caller-supplied totals', () => {
  login('admin', 'admin');
  const sale = createSale({
    storeId,
    lines: [
      { productId: productA, quantity: 2 },
      { productId: productB, quantity: 1, unitPriceCents: 300 },
    ],
    total_cents: 999999,
  });
  assert.equal(sale.total_cents, 500);
});

test('createSale rejects empty lines / bad storeId', () => {
  login('admin', 'admin');
  assert.throws(() => createSale({ storeId, lines: [] }), ValidationError);
  assert.throws(() => createSale({ storeId: 9999, lines: [{ productId: productA, quantity: 1 }] }), ValidationError);
});

test('createSale enqueues exactly one outbox row', () => {
  login('admin', 'admin');
  const sale = createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });
  const rows = db.prepare(`SELECT * FROM sync_queue WHERE entity='sale'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, sale.id);
});

test('a seller can create a sale', () => {
  loginAsSeller();
  const sale = createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });
  assert.equal(sale.total_cents, 100);
  assert.equal(sale.seller_login, 'seller1');
});

// ---- listSales: new shape ----
test('listSales returns { rows, total } newest first', () => {
  login('admin', 'admin');
  const s1 = createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });
  const s2 = createSale({ storeId, lines: [{ productId: productB, quantity: 2 }] });
  const r = listSales();
  assert.equal(r.total, 2);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].id, s2.id);
  assert.equal(r.rows[1].id, s1.id);
});

test('listSales paginates: offset + limit', () => {
  login('admin', 'admin');
  for (let i = 0; i < 5; i++) {
    createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });
  }
  const page1 = listSales({ offset: 0, limit: 2 });
  const page2 = listSales({ offset: 2, limit: 2 });
  const page3 = listSales({ offset: 4, limit: 2 });

  assert.equal(page1.total, 5);
  assert.equal(page1.rows.length, 2);
  assert.equal(page2.rows.length, 2);
  assert.equal(page3.rows.length, 1);

  // No overlaps between pages.
  const ids = [...page1.rows, ...page2.rows, ...page3.rows].map(r => r.id);
  assert.equal(new Set(ids).size, 5);
});

test('listSales search: matches seller login, store name, uuid, #id', () => {
  login('admin', 'admin');
  const sA = createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });

  logout();
  loginAsSeller();
  const sB = createSale({ storeId, lines: [{ productId: productA, quantity: 1 }] });

  logout();
  login('admin', 'admin');

  // Seller login
  const bySeller = listSales({ q: 'seller1' });
  assert.equal(bySeller.total, 1);
  assert.equal(bySeller.rows[0].id, sB.id);

  // Store name
  const byStore = listSales({ q: 'main' });
  assert.equal(byStore.total, 2);

  // client_uuid
  const byUuid = listSales({ q: sA.client_uuid });
  assert.equal(byUuid.total, 1);
  assert.equal(byUuid.rows[0].id, sA.id);

  // #id
  const byId = listSales({ q: `#${sA.id}` });
  assert.equal(byId.total, 1);
  assert.equal(byId.rows[0].id, sA.id);

  // No match
  const none = listSales({ q: 'zzz' });
  assert.equal(none.total, 0);
  assert.equal(none.rows.length, 0);
});

test('listSales clamps limit and defaults to 50', () => {
  login('admin', 'admin');
  const r1 = listSales({ limit: 5000 });          // clamped to 200
  const r2 = listSales({ limit: 0 });             // falls back to 50
  const r3 = listSales({ offset: -5, limit: 10 });// offset clamped to 0
  assert.ok(r1.rows.length <= 200);
  assert.ok(r2.rows.length <= 50);
  assert.ok(r3.rows.length <= 10);
});

// ---- getSale ----
test('getSale returns header + lines and throws for unknown id', () => {
  login('admin', 'admin');
  const s = createSale({
    storeId,
    lines: [{ productId: productA, quantity: 1 }, { productId: productB, quantity: 2 }],
  });
  const got = getSale(s.id);
  assert.equal(got.id, s.id);
  assert.equal(got.lines.length, 2);
  assert.throws(() => getSale(9999), ValidationError);
});

test('listSales requires a signed-in user', () => {
  assert.throws(() => listSales(), AuthError);
});
