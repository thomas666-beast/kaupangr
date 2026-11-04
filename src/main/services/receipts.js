import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';
import { ValidationError } from '../../shared/errors.js';

/**
 * Build a printable receipt HTML string for a sale.
 * Returns a complete HTML document — no external resources.
 */
export function buildReceiptHtml(saleId) {
  requireSession('seller', 'product_manager', 'administrator');
  if (!Number.isInteger(saleId)) throw new ValidationError('saleId required');

  const db = getDb();
  const sale = db.prepare(
    `SELECT s.id, s.created_at, s.total_cents,
            st.name AS store_name, st.address AS store_address,
            u.login AS seller_login,
            s.client_uuid
       FROM sales s
       JOIN stores st ON st.id = s.store_id
       JOIN users  u  ON u.id  = s.seller_id
      WHERE s.id = ?`
  ).get(saleId);
  if (!sale) throw new ValidationError('sale not found');

  const lines = db.prepare(
    `SELECT sl.quantity, sl.unit_price_cents,
            p.sku, p.name
       FROM sales_lines sl
       JOIN products p ON p.id = sl.product_id
      WHERE sl.sale_id = ?
      ORDER BY sl.id`
  ).all(saleId);

  const returns = db.prepare(
    `SELECT SUM(total_cents) AS cents FROM returns WHERE sale_id = ?`
  ).get(saleId).cents || 0;

  const fmt = (c) => (c / 100).toFixed(2);
  const date = new Date(sale.created_at.replace(' ', 'T')).toLocaleString();

  const lineRows = lines.map(l => `
    <tr>
      <td colspan="2">${escapeHtml(l.name)}<br><small>${escapeHtml(l.sku)}</small></td>
      <td class="right">${l.quantity} × ${fmt(l.unit_price_cents)}</td>
      <td class="right">${fmt(l.quantity * l.unit_price_cents)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt #${sale.id}</title>
<style>
  @page { margin: 6mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Courier New", ui-monospace, monospace;
    font-size: 12px;
    color: #000;
    margin: 0;
    padding: 6mm;
    max-width: 80mm;
  }
  h1 { font-size: 16px; margin: 0 0 2px; letter-spacing: .02em; text-align: center; }
  .sub { text-align: center; font-size: 11px; margin: 0 0 10px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 2px 0; vertical-align: top; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .total { font-size: 15px; font-weight: 700; }
  .small { font-size: 10px; color: #333; }
  .center { text-align: center; }
</style>
</head>
<body>
  <h1>${escapeHtml(sale.store_name)}</h1>
  <p class="sub">${escapeHtml(sale.store_address ?? '')}</p>
  <hr>
  <table>
    <thead>
      <tr><th colspan="2">Item</th><th class="right">Qty × Unit</th><th class="right">Subtotal</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
    <tfoot>
      <tr><td colspan="3" class="right"><strong class="total">Total</strong></td>
          <td class="right"><strong class="total">${fmt(sale.total_cents)}</strong></td></tr>
      ${returns > 0 ? `
        <tr><td colspan="3" class="right small">Returned</td>
            <td class="right small">-${fmt(returns)}</td></tr>
        <tr><td colspan="3" class="right"><strong>Net</strong></td>
            <td class="right"><strong>${fmt(sale.total_cents - returns)}</strong></td></tr>
      ` : ''}
    </tfoot>
  </table>
  <hr>
  <p class="small">
    Sale #${sale.id}<br>
    ${escapeHtml(date)}<br>
    Served by ${escapeHtml(sale.seller_login)}
  </p>
  <hr>
  <p class="center small">Thank you!</p>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
