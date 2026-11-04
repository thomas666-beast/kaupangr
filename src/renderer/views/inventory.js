import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { emptyState } from '../empty.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const CAN_EDIT = (u) => u && (u.role === 'administrator' || u.role === 'product_manager');
const PAGE_SIZE = 50;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function rowsToCsv(rows, cols) {
  const head = cols.map(c => csvEscape(c.label)).join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c.key])).join(',')).join('\r\n');
  return head + '\r\n' + body + '\r\n';
}

export async function renderInventory(root) {
  const canEdit = CAN_EDIT(getState().user);

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('inventory.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="Search note, sku, name, or #ref" />
      </div>
      <div class="filterbar">
        <div id="f-product-wrap" class="ac-wrap"></div>
        <select id="f-store"><option value="">${t('inventory.allStores')}</option></select>
        <select id="f-kind">
          <option value="">${t('inventory.allKinds')}</option>
          <option value="purchase">${t('inventory.kindPurchase')}</option>
          <option value="sale">${t('inventory.kindSale')}</option>
          <option value="return">${t('inventory.kindReturn')}</option>
          <option value="adjust">${t('inventory.kindAdjust')}</option>
        </select>
        <span class="spacer"></span>
        <button class="ghost" id="btnExport">${t('common.exportCsv')}</button>
        ${canEdit ? `<button class="primary" id="btnNew">${t('inventory.new')}</button>` : ''}
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead>
          <tr><th>#</th><th>${t('inventory.colDate')}</th><th>${t('inventory.colProduct')}</th>
              <th>${t('inventory.colStore')}</th><th>${t('inventory.colKind')}</th>
              <th class="num">${t('inventory.colQty')}</th>
              <th>${t('inventory.colRef')}</th><th>${t('inventory.colNote')}</th></tr>
        </thead>
        <tbody id="rows"><tr><td colspan="8">${t('common.loading')}</td></tr></tbody>
      </table>
    </div>

    <div class="pager">
      <button class="ghost" id="btnPrev">${t('common.prev')}</button>
      <span class="spacer"></span>
      <span id="pageInfo" style="color:#555"></span>
      <span class="spacer"></span>
      <button class="ghost" id="btnNext">${t('common.next')}</button>
    </div>

    <dialog id="dlg"></dialog>
  `;

  const storeSel = root.querySelector('#f-store');
  const kindSel  = root.querySelector('#f-kind');
  const qInput   = root.querySelector('#f-q');
  const tbody    = root.querySelector('#rows');
  const pageInfo = root.querySelector('#pageInfo');
  const btnPrev  = root.querySelector('#btnPrev');
  const btnNext  = root.querySelector('#btnNext');

  let stores = [];
  let offset = 0;
  let q = '';
  let total = 0;
  let lastRows = [];
  let productFilter = null;
  let searchTimer = null;

  const productAC = createSearchable({
    placeholder: t('inventory.product'),
    searchFn: async (needle) => {
      const r = await window.kaupangr.products.search(needle);
      return {
        ok: r.ok,
        data: r.ok ? r.data.map(p => ({ id: p.id, label: `${p.sku} — ${p.name}` })) : [],
      };
    },
    onChange: (sel) => { productFilter = sel; offset = 0; load(); },
  });
  root.querySelector('#f-product-wrap').appendChild(productAC.el);

  async function loadLookups() {
    const rs = await window.kaupangr.stores.list({ limit: 200 });
    stores = rs.ok ? rs.data.rows : [];
    storeSel.innerHTML = `<option value="">${t('inventory.allStores')}</option>` +
      stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="8">${t('common.loading')}</td></tr>`;
    const opts = { q, offset, limit: PAGE_SIZE };
    if (productFilter)   opts.productId = productFilter.id;
    if (storeSel.value)  opts.storeId   = +storeSel.value;
    if (kindSel.value)   opts.kind      = kindSel.value;

    const r = await window.kaupangr.stock.listMovements(opts);
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="8" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    lastRows = rows;
    total = r.data.total;

    const hasFilter = !!(productFilter || storeSel.value || kindSel.value);
    if (rows.length === 0) {
      tbody.innerHTML = emptyState(8, q || hasFilter ? t('common.noResults') : t('inventory.emptyTitle'),
        q || hasFilter ? t('inventory.noMatchHint') : t('inventory.emptyHint'));
    } else {
      tbody.innerHTML = rows.map(m => `
        <tr>
          <td>${m.id}</td>
          <td>${esc(m.created_at)}</td>
          <td><code>${esc(m.sku)}</code> — ${esc(m.product_name)}</td>
          <td>${esc(m.store_name ?? '—')}</td>
          <td>${esc(m.kind)}</td>
          <td class="num" style="${m.quantity < 0 ? 'color:#b3261e' : ''}">${m.quantity > 0 ? '+' : ''}${m.quantity}</td>
          <td>${m.ref_type ? `${esc(m.ref_type)} #${m.ref_id}` : '—'}</td>
          <td>${esc(m.note ?? '')}</td>
        </tr>`).join('');
    }

    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + rows.length, total);
    pageInfo.textContent = total === 0 ? 'no results' : `showing ${start}–${end} of ${total}`;
    btnPrev.disabled = offset === 0;
    btnNext.disabled = offset + PAGE_SIZE >= total;
  }

  storeSel.addEventListener('change', () => { offset = 0; load(); });
  kindSel.addEventListener('change',  () => { offset = 0; load(); });

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

  root.querySelector('#btnExport').addEventListener('click', async () => {
    if (lastRows.length === 0) { alert(t('sales.nothingToExport')); return; }
    const csv = rowsToCsv(lastRows, [
      { key: 'id',           label: 'id' },
      { key: 'created_at',   label: 'created_at' },
      { key: 'sku',          label: 'sku' },
      { key: 'product_name', label: 'product' },
      { key: 'store_name',   label: 'store' },
      { key: 'kind',         label: 'kind' },
      { key: 'quantity',     label: 'quantity' },
      { key: 'ref_type',     label: 'ref_type' },
      { key: 'ref_id',       label: 'ref_id' },
      { key: 'note',         label: 'note' },
      { key: 'client_uuid',  label: 'client_uuid' },
    ]);
    const res = await window.kaupangr.exports.save({
      filename: `inventory-${todayIso()}.csv`,
      content: csv,
    });
    if (!res.ok) alert(res.error.message);
  });

  root.querySelector('#btnNew')?.addEventListener('click', openForm);

  function openForm() {
    if (stores.length === 0) { alert(t('inventory.createStoreFirst')); return; }

    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${t('inventory.addTitle')}</h3>

        <div class="dialog-body">
          <div class="form-row">
            <label>${t('inventory.product')}</label>
            <div id="f-prod-wrap"></div>
          </div>
          <div class="form-row">
            <label>${t('inventory.store')}</label>
            <select id="f-store2">
              ${stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>${t('inventory.kind')}</label>
            <select id="f-kind2">
              <option value="purchase">${t('inventory.kindPurchaseLabel')}</option>
              <option value="adjust">${t('inventory.kindAdjustLabel')}</option>
            </select>
          </div>
          <div class="form-row" id="f-dir-row" hidden>
            <label>${t('inventory.direction')}</label>
            <select id="f-dir">
              <option value="+">${t('inventory.dirAdd')}</option>
              <option value="-">${t('inventory.dirRemove')}</option>
            </select>
          </div>
          <div class="form-row">
            <label>${t('inventory.quantity')}</label>
            <input id="f-qty" type="number" min="1" value="1" />
          </div>
          <div class="form-row">
            <label>${t('inventory.note')}</label>
            <input id="f-note" />
          </div>
          <div class="err" id="f-err"></div>
        </div>

        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('common.save')}</button>
        </menu>
      </form>`;

    const productACForm = createSearchable({
      placeholder: 'Search product…',
      searchFn: async (needle) => {
        const r = await window.kaupangr.products.search(needle);
        return {
          ok: r.ok,
          data: r.ok ? r.data.map(p => ({ id: p.id, label: `${p.sku} — ${p.name}` })) : [],
        };
      },
    });
    dlg.querySelector('#f-prod-wrap').appendChild(productACForm.el);

    const kindInput = dlg.querySelector('#f-kind2');
    const dirRow    = dlg.querySelector('#f-dir-row');
    function syncDirectional() { dirRow.hidden = kindInput.value !== 'adjust'; }
    kindInput.addEventListener('change', syncDirectional);
    syncDirectional();

    dlg.showModal();
    productACForm.focus();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();

      const pick = productACForm.get();
      if (!pick) { dlg.querySelector('#f-err').textContent = 'Select a product.'; return; }

      const kind = kindInput.value;
      const dir  = dlg.querySelector('#f-dir').value;
      let quantity = Number.parseInt(dlg.querySelector('#f-qty').value, 10);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        dlg.querySelector('#f-err').textContent = t('inventory.quantityPositive');
        return;
      }
      if (kind === 'adjust' && dir === '-') quantity = -quantity;

      const r = await window.kaupangr.stock.addMovement({
        productId: pick.id,
        storeId:   +dlg.querySelector('#f-store2').value,
        kind,
        quantity,
        note: dlg.querySelector('#f-note').value || null,
      });
      if (!r.ok) { dlg.querySelector('#f-err').textContent = r.error.message; return; }
      dlg.close();
      offset = 0;
      load();
    });
  }

  await loadLookups();
  await load();
}
