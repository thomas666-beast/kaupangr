import { esc } from '../esc.js';
import { t } from '../i18n/index.js';

const fmt = (c) => (c / 100).toFixed(2);
const PAGE_SIZE = 50;

export async function renderReturns(root) {
  let offset = 0;
  let q = '';
  let total = 0;
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>Returns</h2>
      <p style="color:#666;margin:0">Returns are created from the Sales screen (open a sale → Return).</p>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder=t('returns.searchPlaceholder') />
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead>
          <tr><th>#</th><th>Date</th><th>Sale</th><th>Store</th><th>User</th>
              <th class="num">Total</th><th></th></tr>
        </thead>
        <tbody id="rows"><tr><td colspan="7">Loading…</td></tr></tbody>
      </table>
    </div>

    <div class="pager">
      <button class="ghost" id="btnPrev">← Prev</button>
      <span class="spacer"></span>
      <span id="pageInfo" style="color:#555"></span>
      <span class="spacer"></span>
      <button class="ghost" id="btnNext">Next →</button>
    </div>

    <dialog id="dlg"></dialog>
  `;

  const tbody    = root.querySelector('#rows');
  const qInput   = root.querySelector('#f-q');
  const pageInfo = root.querySelector('#pageInfo');
  const btnPrev  = root.querySelector('#btnPrev');
  const btnNext  = root.querySelector('#btnNext');
  const dlg      = root.querySelector('#dlg');

  async function load() {
    tbody.innerHTML = `<tr><td colspan="7">Loading…</td></tr>`;
    const r = await window.kaupangr.returns.listAll({ q, offset, limit: PAGE_SIZE });
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="7" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="7" class="empty" style="text-align:center;padding:2rem 1rem;color:#666">
          <strong style="display:block;color:#333;margin-bottom:.25rem">${q ? t('common.noResults') : t('returns.emptyTitle')}</strong>
          <div class="hint">${q ? 'Try a different search.' : t('returns.emptyHint')}</div>
        </td></tr>`;
    } else {
      tbody.innerHTML = rows.map(rr => `
        <tr>
          <td>${rr.id}</td>
          <td>${esc(rr.created_at)}</td>
          <td>#${rr.sale_id}</td>
          <td>${esc(rr.store_name)}</td>
          <td>${esc(rr.user_login)}</td>
          <td class="num">${fmt(rr.total_cents)}</td>
          <td><button class="ghost" data-view="${rr.id}">View</button></td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-view]').forEach(b =>
        b.addEventListener('click', () => showDetail(+b.dataset.view)));
    }

    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + rows.length, total);
    pageInfo.textContent = total === 0 ? t('common.noResultsLower') : `showing ${start}–${end} of ${total}`;
    btnPrev.disabled = offset === 0;
    btnNext.disabled = offset + PAGE_SIZE >= total;
  }

  qInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      q = qInput.value.trim();
      offset = 0;
      load();
    }, 200);
  });

  btnPrev.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); load(); });
  btnNext.addEventListener('click', () => { offset += PAGE_SIZE; load(); });

  async function showDetail(id) {
    const r = await window.kaupangr.returns.get(id);
    if (!r.ok) { alert(r.error.message); return; }
    const ret = r.data;
    dlg.innerHTML = `
      <div style="min-width:520px">
        <h3>Return #${ret.id} — sale #${ret.sale_id}</h3>
        <p>${esc(ret.created_at)} · by ${esc(ret.user_login)}</p>
        <table>
          <thead><tr><th>SKU</th><th>Product</th><th class="num">Qty</th>
                     <th class="num">Unit</th><th class="num">Subtotal</th></tr></thead>
          <tbody>
            ${ret.lines.map(l => `
              <tr><td><code>${esc(l.sku)}</code></td><td>${esc(l.product_name)}</td>
                  <td class="num">${l.quantity}</td>
                  <td class="num">${fmt(l.unit_price_cents)}</td>
                  <td class="num">${fmt(l.quantity * l.unit_price_cents)}</td></tr>`).join('')}
            <tr><td colspan="4" style="text-align:right"><strong>Total</strong></td>
                <td class="num"><strong>${fmt(ret.total_cents)}</strong></td></tr>
          </tbody>
        </table>
        <menu style="display:flex;justify-content:flex-end">
          <button class="ghost" id="closeDetail">Close</button>
        </menu>
      </div>`;
    dlg.querySelector('#closeDetail').addEventListener('click', () => dlg.close());
    dlg.showModal();
  }

  load();
}
