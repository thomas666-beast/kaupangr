import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb, teardown } from './helpers.js';
import { ensureBootstrapAdmin, login, logout } from '../src/main/services/auth.js';
import { createSupplier } from '../src/main/services/suppliers.js';
import { createProduct, listProducts } from '../src/main/services/products.js';
import { importProductsCsv } from '../src/main/services/products-csv.js';
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

// ------------------------------------------------------------------
// guards
// ------------------------------------------------------------------
test('importProductsCsv requires a signed-in user', () => {
  assert.throws(() => importProductsCsv('sku,name,price\nA,X,1.00'), AuthError);
});

test('importProductsCsv is forbidden for sellers', () => {
  loginAsSeller();
  assert.throws(
    () => importProductsCsv('sku,name,price\nA,X,1.00'),
    ForbiddenError
  );
});

test('importProductsCsv rejects empty input and missing header', () => {
  login('admin', 'admin');
  assert.throws(() => importProductsCsv(''), ValidationError);
  assert.throws(() => importProductsCsv('a,b,c\n1,2,3'), ValidationError);
});

// ------------------------------------------------------------------
// happy path
// ------------------------------------------------------------------
test('imports a well-formed CSV', () => {
  login('admin', 'admin');
  const acmeId = createSupplier({ name: 'Acme' }).id;
  logout();

  login('admin', 'admin');
  const csv = [
    'sku,name,price,supplier',
    'SKU-1,Widget,4.99,Acme',
    'SKU-2,Gadget,12.50,',
    'SKU-3,"Comma, Name",0.10,Acme',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 3);
  assert.equal(r.total, 3);
  assert.deepEqual(r.errors, []);

  const list = listProducts({ limit: 10 });
  assert.equal(list.total, 3);
  const bySku = Object.fromEntries(list.rows.map(p => [p.sku, p]));
  assert.equal(bySku['SKU-1'].price_cents, 499);
  assert.equal(bySku['SKU-1'].supplier_id, acmeId);
  assert.equal(bySku['SKU-2'].supplier_id, null);
  assert.equal(bySku['SKU-3'].name, 'Comma, Name');
  assert.equal(bySku['SKU-3'].price_cents, 10);
});

test('CSV columns are case-insensitive and reorderable', () => {
  login('admin', 'admin');
  const csv = [
    'NAME,Price,SKU',
    'Widget,4.99,SKU-1',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 1);
});

// ------------------------------------------------------------------
// validation: whole file rejected on any error
// ------------------------------------------------------------------
test('any bad row rolls back the entire batch', () => {
  login('admin', 'admin');
  const csv = [
    'sku,name,price',
    'SKU-1,Good,1.00',
    'SKU-2,Bad Price,not-a-number',
    'SKU-3,Good,2.00',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 0);
  assert.equal(r.total, 3);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 3);
  assert.match(r.errors[0].message, /price/);

  // Nothing was inserted.
  assert.equal(listProducts({ limit: 10 }).total, 0);
});

test('duplicate sku in file is rejected', () => {
  login('admin', 'admin');
  const csv = [
    'sku,name,price',
    'SKU-1,A,1.00',
    'SKU-1,B,2.00',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /duplicate sku/i);
});

test('sku already existing is rejected', () => {
  login('admin', 'admin');
  createProduct({ sku: 'SKU-1', name: 'Existing', price_cents: 100 });
  const csv = [
    'sku,name,price',
    'SKU-1,New,1.00',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /already exists/);
});

test('unknown supplier is rejected', () => {
  login('admin', 'admin');
  const csv = [
    'sku,name,price,supplier',
    'SKU-1,A,1.00,Unknown Supplier',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 0);
  assert.match(r.errors[0].message, /supplier .* not found/);
});

test('missing sku / name / price each produce a specific error', () => {
  login('admin', 'admin');
  const csv = [
    'sku,name,price',
    ',Missing sku,1.00',
    'SKU-2,,2.00',
    'SKU-3,Missing price,',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 0);
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some(e => /sku is required/.test(e.message)));
  assert.ok(r.errors.some(e => /name is required/.test(e.message)));
  assert.ok(r.errors.some(e => /price is required/.test(e.message)));
});

// ------------------------------------------------------------------
// quoting
// ------------------------------------------------------------------
test('quoted fields with commas and quotes work', () => {
  login('admin', 'admin');
  const csv = [
    'sku,name,price',
    'SKU-1,"Comma, Name",1.00',
    'SKU-2,"Quote "" Inside",2.00',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 2);
  const list = listProducts({ limit: 10 });
  const names = list.rows.map(p => p.name).sort();
  assert.deepEqual(names, ['Comma, Name', 'Quote " Inside']);
});

// ------------------------------------------------------------------
// outbox
// ------------------------------------------------------------------
test('each imported product enqueues exactly one outbox row', () => {
  login('admin', 'admin');
  const before = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE entity='product'`).get().n;
  const csv = [
    'sku,name,price',
    'A,A,1.00',
    'B,B,2.00',
    'C,C,3.00',
  ].join('\n');
  const r = importProductsCsv(csv);
  assert.equal(r.imported, 3);
  const after = db.prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE entity='product'`).get().n;
  assert.equal(after, before + 3);
});
