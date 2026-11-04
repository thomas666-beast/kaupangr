import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { enqueue } from './outbox.js';
import { ValidationError } from '../../shared/errors.js';

/**
 * Import products from a CSV string.
 *
 * Columns (header required, case-insensitive):
 *   sku, name, price, supplier
 *
 * - price is decimal (e.g. "4.99") → stored as price_cents
 * - supplier is matched by name against existing suppliers (optional)
 * - whole file is one transaction; if any row fails, nothing is inserted
 * - duplicate SKUs (in CSV or against existing) are rejected
 *
 * @returns {{ imported: number, total: number, errors: Array<{row:number,message:string}> }}
 */
export function importProductsCsv(csvText) {
  requireSession('administrator', 'product_manager');
  if (typeof csvText !== 'string') throw new ValidationError('csv text required');
  if (csvText.length > 5 * 1024 * 1024) throw new ValidationError('file too large (max 5 MB)');

  const parsed = parseCsv(csvText);
  if (parsed.length === 0) throw new ValidationError('empty file');

  const header = parsed[0].map(h => h.trim().toLowerCase());
  const colIndex = {
    sku:      header.indexOf('sku'),
    name:     header.indexOf('name'),
    price:    header.indexOf('price'),
    supplier: header.indexOf('supplier'),
  };
  if (colIndex.sku < 0 || colIndex.name < 0 || colIndex.price < 0) {
    throw new ValidationError('CSV must have columns: sku, name, price[, supplier]');
  }

  const db = getDb();
  const supplierByName = new Map(
    db.prepare(`SELECT id, name FROM suppliers`).all()
      .map(s => [s.name.toLowerCase(), s.id])
  );
  const existingSkus = new Set(
    db.prepare(`SELECT sku FROM products`).all().map(r => r.sku.toLowerCase())
  );

  const total = parsed.length - 1;
  const errors = [];
  const valid = [];
  const seenSkus = new Set();

  for (let i = 1; i < parsed.length; i++) {
    const row = parsed[i];
    const rowNumber = i + 1;  // 1-based, header is row 1

    const sku      = (row[colIndex.sku]      ?? '').trim();
    const name     = (row[colIndex.name]     ?? '').trim();
    const priceStr = (row[colIndex.price]    ?? '').trim();
    const supplierName = colIndex.supplier >= 0
      ? (row[colIndex.supplier] ?? '').trim()
      : '';

    // Validate each field, collecting all errors for this row at once.
    const rowErrors = [];
    if (!sku)  rowErrors.push('sku is required');
    if (!name) rowErrors.push('name is required');

    let priceCents = null;
    if (!priceStr) {
      rowErrors.push('price is required');
    } else {
      const price = Number.parseFloat(priceStr);
      if (!Number.isFinite(price) || price < 0) {
        rowErrors.push(`price "${priceStr}" is not a non-negative number`);
      } else {
        priceCents = Math.round(price * 100);
      }
    }

    let supplierId = null;
    if (supplierName) {
      const found = supplierByName.get(supplierName.toLowerCase());
      if (found === undefined) {
        rowErrors.push(`supplier "${supplierName}" not found`);
      } else {
        supplierId = found;
      }
    }

    if (sku) {
      const key = sku.toLowerCase();
      if (seenSkus.has(key)) {
        rowErrors.push(`duplicate sku in file: ${sku}`);
      } else if (existingSkus.has(key)) {
        rowErrors.push(`sku already exists: ${sku}`);
      }
      seenSkus.add(key);
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join('; ') });
    } else {
      valid.push({ sku, name, priceCents, supplierId });
    }
  }

  // Atomic: any error rejects the whole batch.
  if (errors.length > 0) {
    return { imported: 0, total, errors };
  }

  const tx = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO products (sku, name, price_cents, supplier_id)
       VALUES (?, ?, ?, ?)`
    );
    for (const p of valid) {
      const info = ins.run(p.sku, p.name, p.priceCents, p.supplierId);
      const id = Number(info.lastInsertRowid);
      const row = db.prepare(
        `SELECT p.id, p.sku, p.name, p.price_cents, p.supplier_id, p.is_active,
                p.created_at, s.name AS supplier_name
           FROM products p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE p.id = ?`
      ).get(id);
      enqueue(db, 'product', id, 'upsert', row);
    }
  });
  tx();

  return { imported: valid.length, total, errors: [] };
}

// ------------------------------------------------------------------
// Minimal RFC-4180 CSV parser.
// Handles: quoted fields, escaped quotes, embedded newlines, CRLF.
// ------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
