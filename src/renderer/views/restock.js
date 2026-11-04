import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { emptyState } from '../empty.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const CAN_EDIT = (u) => u && (u.role === 'administrator' || u.role === 'product_manager');
const PAGE_SIZE = 100;

export async function renderRestock(root) {
  const canEdit = CAN_EDIT(getState().user);
  let storeFilter = null;
  let stores = [];

  root.innerHTML = `
    <div class="pageheader">
      <h2>Restock</h2>
      <p style="margin:0;color:var(--text-muted);font-size:13px">
        Products at or below their reorder point. Set a reorder point on a product
        (Products → Edit → Reorder at) to include it here.
      </p>
      <div class="filterbar">
        <div id="f-store-wrap" class="ac-wrap"></div>
        <span class="spacer"></span>
        <button class="ghost" id="btnRefresh">Refresh</button>
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            <th>Supplier</th>
            <th class="num">On hand</th>
            <th class="num">Reorder at</th>
            <th class="num">Suggested order</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows"><tr><td colspan="7">${t('common.loading')}</td></tr></tbody>
      </table>
    </div>

    <dialog id="dlg"></dialog>
  `;

  const tbody = root.querySelector('#rows');

  // ---- store filter ----
  const storeAC = createSearchable({
    placeholder: 'All stores',
    searchFn: async (needle) => {
      const r = await window.kaupangr.stores.list({ q: needle, limit: 5 });
      return {
        ok: r.ok,
        data: r.ok ? r.data.rows.map(s => ({ id: s.id, label: s.name })) : [],
      };
    },
    onChange: (sel) => { storeFilter = sel; load(); },
  });
  root.querySelector('#f-store-wrap').appendChild(storeAC.el);

  async function loadLookups() {
    const rs = await window.kaupangr.stores.list({ limit: 200 });
    stores = rs.ok ? rs.data.rows : [];
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="7">${t('common.loading')}</td></tr>`;
    const opts = { limit: PAGE_SIZE };
    if (storeFilter) opts.storeId = storeFilter.id;

    const r = await window.kaupangr.stock.lowStock(opts);
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="7" class="err">${r.error.message}</td></tr>`; return; }

    if (r.data.length === 0) {
      tbody.innerHTML = emptyState(7, 'Nothing to restock',
        'All products are above their reorder point, or no reorder points are set.');
      return;
    }

    tbody.innerHTML = r.data.map(p => {
      const suggested = Math.max(1, Math.ceil(p.reorder_at * 2 - p.on_hand));
      return `
        <tr>
          <td><code>${esc(p.sku)}</code></td>
          <td>${esc(p.name)}</td>
          <td>${esc(p.supplier_name ?? '—')}</td>
          <td class="num" style="${p.on_hand < 0 ? 'color:#b3261e' : ''}">${p.on_hand}</td>
          <td class="num">${p.reorder_at}</td>
          <td class="num" style="font-weight:600">${suggested}</td>
          <td>${canEdit ? `<button class="primary" data-restock="${p.id}" data-suggest="${suggested}">Create purchase</button>` : ''}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-restock]').forEach(b =>
      b.addEventListener('click', () => {
        const id = +b.dataset.restock;
        const suggest = +b.dataset.suggest;
        openPurchaseModal(id, suggest, r.data.find(x => x.id === id));
      }));
  }

  function openPurchaseModal(productId, suggestedQty, product) {
    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>Create purchase</h3>
        <div class="dialog-body">
          <div class="form-row">
            <label>Product</label>
            <input value="${esc(product.sku)} — ${esc(product.name)}" disabled />
          </div>
          <div class="form-row">
            <label>Store</label>
            <select id="f-store">
              ${stores.map(s => `<option value="${s.id}" ${storeFilter && storeFilter.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>Quantity to order</label>
            <input id="f-qty" type="number" min="1" value="${suggestedQty}" />
          </div>
          <div class="form-row">
            <label>Note (optional)</label>
            <input id="f-note" value="Restock: ${esc(product.sku)}" />
          </div>
          <div class="err" id="f-err"></div>
        </div>
        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">Save</button>
        </menu>
      </form>`;
    dlg.showModal();
    dlg.querySelector('#f-qty').focus();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();

      const qty = Number.parseInt(dlg.querySelector('#f-qty').value, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        dlg.querySelector('#f-err').textContent = 'Quantity must be a positive integer.';
        return;
      }
      const storeId = +dlg.querySelector('#f-store').value;
      const note = dlg.querySelector('#f-note').value || null;

      const r = await window.kaupangr.stock.addMovement({
        productId, storeId, kind: 'purchase', quantity: qty, note,
      });
      if (!r.ok) { dlg.querySelector('#f-err').textContent = r.error.message; return; }
      dlg.close();
      load();
    });
  }

  root.querySelector('#btnRefresh').addEventListener('click', load);

  await loadLookups();
  await load();
}
