import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { emptyState } from '../empty.js';
import { sortRows, headerCell } from '../sortable.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const CAN_EDIT = (u) => u && (u.role === 'administrator' || u.role === 'product_manager');
const fmt = (c) => (c / 100).toFixed(2);
const PAGE_SIZE = 50;

export async function renderProducts(root) {
  const canEdit = CAN_EDIT(getState().user);
  let offset = 0;
  let q = '';
  let supplierFilter = null;
  let total = 0;
  let suppliers = [];
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('products.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="Search by SKU or name…" />
      </div>
      <div class="filterbar">
        <div id="f-supplier-wrap" class="ac-wrap"></div>
        <span class="spacer"></span>
        ${canEdit ? '<button class="ghost" id="btnImportCsv">Import CSV</button>' : ''}
        ${canEdit ? '<button class="ghost" id="btnBulkPrice">Bulk price</button>' : ''}
        ${canEdit ? `<button class="primary" id="btnNew">${t('products.new')}</button>` : ''}
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead id="head"></thead>
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

    <input type="file" id="csv-file" accept=".csv,text/csv" style="display:none" />
    <dialog id="dlg"></dialog>
    <dialog id="importDlg"></dialog>
  `;

  const thead     = root.querySelector('#head');
  const tbody     = root.querySelector('#rows');
  const qInput    = root.querySelector('#f-q');
  const pageInfo  = root.querySelector('#pageInfo');
  const btnPrev   = root.querySelector('#btnPrev');
  const btnNext   = root.querySelector('#btnNext');
  const fileInput = root.querySelector('#csv-file');
  let sort = { key: 'name', dir: 'asc' };

  const supplierAC = createSearchable({
    placeholder: t('products.supplier'),
    searchFn: async (needle) => {
      const matches = suppliers.filter(s =>
        s.name.toLowerCase().includes(needle.toLowerCase())
      );
      return { ok: true, data: matches.map(s => ({ id: s.id, label: s.name })) };
    },
    onChange: (sel) => { supplierFilter = sel; offset = 0; load(); },
  });
  root.querySelector('#f-supplier-wrap').appendChild(supplierAC.el);

  function paintHeader() {
    thead.innerHTML = `
      <tr>
        ${headerCell('#', 'id', sort)}
        ${headerCell('SKU', 'sku', sort)}
        ${headerCell('Name', 'name', sort)}
        ${headerCell('Price', 'price_cents', sort, 'num')}
        ${headerCell('Stock', 'stock', sort, 'num')}
        ${headerCell('Supplier', 'supplier_name', sort)}
        ${headerCell('Status', 'is_active', sort)}
        <th></th>
      </tr>`;
    thead.querySelectorAll('th[data-key]').forEach(th =>
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        sort = sort.key === k
          ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key: k, dir: 'asc' };
        paintHeader();
        load();
      }));
  }
  paintHeader();

  async function loadSuppliers() {
    const r = await window.kaupangr.suppliers.list({ limit: 200 });
    suppliers = r.ok ? r.data.rows : [];
  }

  async function load() {
    tbody.innerHTML = `<tr><td colspan="8">${t('common.loading')}</td></tr>`;
    const opts = { q, offset, limit: PAGE_SIZE };
    if (supplierFilter) opts.supplierId = supplierFilter.id;

    const r = await window.kaupangr.products.list(opts);
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="8" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = emptyState(8, q || supplierFilter ? t('common.noResults') : t('products.emptyTitle'),
        q || supplierFilter ? 'Try a different search.' : t('products.emptyHint'));
      updatePager(0);
      return;
    }

    const ids = rows.map(p => p.id);
    const bulk = await window.kaupangr.stock.onHandBulk(ids);
    const stockByProduct = bulk.ok ? bulk.data : {};

    const enriched = rows.map(p => ({ ...p, stock: stockByProduct[p.id] ?? 0 }));
    const sorted = sortRows(enriched, sort.key, sort.dir);

    tbody.innerHTML = sorted.map(p => `
      <tr class="${p.is_active ? '' : 'inactive'}">
        <td>${p.id}</td>
        <td><code>${esc(p.sku)}</code></td>
        <td>${esc(p.name)}</td>
        <td class="num">${fmt(p.price_cents)}</td>
        <td class="num" style="${p.stock <= 0 ? 'color:#b3261e' : ''}">${p.stock}</td>
        <td>${esc(p.supplier_name ?? '—')}</td>
        <td>${p.is_active ? 'active' : 'inactive'}</td>
        <td>
          ${canEdit ? `
            <button class="ghost" data-edit="${p.id}">${t('common.edit')}</button>
            <button class="ghost ${p.is_active ? 'danger' : ''}" data-toggle="${p.id}">
              ${p.is_active ? t('common.deactivate') : t('common.activate')}
            </button>` : ''}
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-edit]').forEach(b =>
      b.addEventListener('click', () => openForm(sorted.find(x => x.id === +b.dataset.edit))));
    tbody.querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = +b.dataset.toggle;
        const row = sorted.find(x => x.id === id);
        if (row.is_active) {
          const ok = await confirmAction({
            title: `Deactivate ${row.name}?`,
            body: 'This product will no longer appear in POS or new sales. Existing sales and returns are unaffected.',
            okText: t('common.deactivate'),
            danger: true,
          });
          if (!ok) return;
        }
        await window.kaupangr.products.setActive(id, !row.is_active);
        load();
      }));

    updatePager(rows.length);
  }

  function updatePager(pageLen) {
    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + pageLen, total);
    pageInfo.textContent = total === 0 ? 'no results' : `showing ${start}–${end} of ${total}`;
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

  root.querySelector('#btnNew')?.addEventListener('click', () => openForm(null));

  root.querySelector('#btnBulkPrice')?.addEventListener('click', openBulkModal);

  // ---- CSV import (unchanged) ----
  root.querySelector('#btnImportCsv')?.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showImportResult({ imported: 0, total: 0, errors: [{ row: 0, message: 'file too large (max 5 MB)' }] });
      return;
    }
    const text = await file.text();
    const r = await window.kaupangr.products.importCsv(text);
    if (!r.ok) {
      showImportResult({ imported: 0, total: 0, errors: [{ row: 0, message: r.error.message }] });
      return;
    }
    showImportResult(r.data);
    if (r.data.imported > 0) load();
  });

  function showImportResult({ imported, total, errors }) {
    const dlg = root.querySelector('#importDlg');
    const ok = errors.length === 0;
    dlg.innerHTML = `
      <div class="dialog-wrap">
        <h3>${ok ? 'Import successful' : 'Import failed'}</h3>
        <div class="dialog-body">
          <p style="color:${ok ? 'var(--success)' : 'var(--danger)'};font-weight:500">
            ${ok
              ? `Imported ${imported} of ${total} products.`
              : `0 imported — ${errors.length} error${errors.length === 1 ? '' : 's'}. Fix the file and try again.`}
          </p>
          ${errors.length ? `
            <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-family:var(--font-mono);font-size:12px;line-height:1.5;white-space:pre-wrap;background:var(--surface-alt)">
              ${errors.map(e => `row ${e.row}: ${esc(e.message)}`).join('\n')}
            </div>
          ` : ''}
        </div>
        <menu>
          <button class="primary" value="close">${t('common.close')}</button>
        </menu>
      </div>`;
    dlg.showModal();
  }

  // ---- form (new / edit) ----
  function openForm(p) {
    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${p ? t('products.edit') : t('products.new')}</h3>

        <div class="dialog-body">
          <div class="form-row">
            <label>${t('products.sku')}</label>
            <input id="f-sku" value="${p ? esc(p.sku) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('products.name')}</label>
            <input id="f-name" value="${p ? esc(p.name) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('products.price')}</label>
            <input id="f-price" type="number" step="0.01" min="0"
                   value="${p ? (p.price_cents / 100).toFixed(2) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('products.supplier')} ${t('common.optional')}</label>
            <div id="f-supplier-wrap-in"></div>
          </div>
          <div class="form-row">
            <label>Reorder at (0 = no reorder point)</label>
            <input id="f-reorder" type="number" min="0" step="1"
                   value="${p ? p.reorder_at : 0}" />
          </div>
          <div class="err" id="f-err"></div>
        </div>

        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('common.save')}</button>
        </menu>
      </form>`;

    const supplierACForm = createSearchable({
      placeholder: t('products.supplier'),
      searchFn: async (needle) => {
        const matches = suppliers.filter(s =>
          s.name.toLowerCase().includes(needle.toLowerCase())
        );
        return { ok: true, data: matches.map(s => ({ id: s.id, label: s.name })) };
      },
    });
    dlg.querySelector('#f-supplier-wrap-in').appendChild(supplierACForm.el);
    if (p?.supplier_id) {
      const found = suppliers.find(s => s.id === p.supplier_id);
      if (found) supplierACForm.setValue({ id: found.id, label: found.name });
    }

    dlg.showModal();
    dlg.querySelector('#f-sku').focus();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      const price = Math.round(parseFloat(dlg.querySelector('#f-price').value) * 100);
      const supplierPick = supplierACForm.get();
      const reorderAt = Number.parseInt(dlg.querySelector('#f-reorder').value, 10);
      const data = {
        sku: dlg.querySelector('#f-sku').value,
        name: dlg.querySelector('#f-name').value,
        price_cents: Number.isFinite(price) ? price : -1,
        supplier_id: supplierPick ? supplierPick.id : null,
        reorder_at: Number.isFinite(reorderAt) && reorderAt >= 0 ? reorderAt : 0,
      };
      const r = p
        ? await window.kaupangr.products.update(p.id, data)
        : await window.kaupangr.products.create(data);
      if (!r.ok) { dlg.querySelector('#f-err').textContent = r.error.message; return; }
      dlg.close();
      load();
    });
  }

  function openBulkModal() {
  const dlg = root.querySelector('#dlg');
  dlg.innerHTML = `
    <form method="dialog">
      <h3>Bulk price update</h3>
      <div class="dialog-body">
        <div class="form-row">
          <label>Apply to</label>
          <select id="f-bulk-scope">
            <option value="all">All products</option>
            <option value="supplier">Products of a specific supplier</option>
          </select>
        </div>
        <div class="form-row" id="f-bulk-supplier-wrap" hidden>
          <label>Supplier</label>
          <div id="f-bulk-supplier"></div>
        </div>
        <div class="form-row">
          <label>Operation</label>
          <select id="f-bulk-op">
            <option value="pct">Change by % (e.g. +10 or -5)</option>
            <option value="add">Add / subtract fixed amount (e.g. 0.50 or -0.20)</option>
            <option value="set">Set to fixed price</option>
          </select>
        </div>
        <div class="form-row">
          <label>Value</label>
          <input id="f-bulk-value" type="number" step="0.01" value="0" />
        </div>
        <div class="err" id="f-bulk-err"></div>
        <div id="f-bulk-preview"></div>
      </div>
      <menu>
        <button class="ghost" value="cancel" formnovalidate>Cancel</button>
        <button type="button" class="primary" id="f-bulk-apply" disabled>Apply</button>
        <button type="button" class="ghost" id="f-bulk-preview-btn">Preview</button>
      </menu>
    </form>`;

  const scopeSel  = dlg.querySelector('#f-bulk-scope');
  const supWrap   = dlg.querySelector('#f-bulk-supplier-wrap');
  const opSel     = dlg.querySelector('#f-bulk-op');
  const valInput  = dlg.querySelector('#f-bulk-value');
  const errEl     = dlg.querySelector('#f-bulk-err');
  const previewEl = dlg.querySelector('#f-bulk-preview');
  const applyBtn  = dlg.querySelector('#f-bulk-apply');
  const previewBtn = dlg.querySelector('#f-bulk-preview-btn');

  let supplierPick = null;
  const supplierAC = createSearchable({
    placeholder: 'Search supplier…',
    searchFn: async (needle) => {
      const matches = suppliers.filter(s =>
        s.name.toLowerCase().includes(needle.toLowerCase())
      );
      return { ok: true, data: matches.map(s => ({ id: s.id, label: s.name })) };
    },
    onChange: (sel) => { supplierPick = sel; },
  });
  dlg.querySelector('#f-bulk-supplier').appendChild(supplierAC.el);

  scopeSel.addEventListener('change', () => {
    supWrap.hidden = scopeSel.value !== 'supplier';
  });

  function readOpts() {
    return {
      supplierId: scopeSel.value === 'supplier' && supplierPick ? supplierPick.id : null,
      operation: opSel.value,
      value: Number.parseFloat(valInput.value) || 0,
    };
  }

  async function doPreview() {
    errEl.textContent = '';
    applyBtn.disabled = true;
    const opts = readOpts();
    const r = await window.kaupangr.products.bulkPreview(opts);
    if (!r.ok) { errEl.textContent = r.error.message; return; }
    const { total_matched, total_affected, delta_cents, items } = r.data;

    if (total_matched === 0) {
      previewEl.innerHTML = `<p style="color:var(--text-muted)">No products match this filter.</p>`;
      return;
    }

    const deltaSign = delta_cents >= 0 ? '+' : '−';
    previewEl.innerHTML = `
      <div style="background:var(--surface-alt);border-radius:8px;padding:12px 16px;margin:8px 0;font-size:14px">
        <strong>${total_affected}</strong> of ${total_matched} products will change price.
        Total price delta: <strong style="color:${delta_cents >= 0 ? 'var(--success)' : 'var(--danger)'}">
          ${deltaSign}${(Math.abs(delta_cents) / 100).toFixed(2)}
        </strong>
      </div>
      <div style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--surface-alt)">
              <th style="text-align:left;padding:8px 12px">SKU</th>
              <th style="text-align:left;padding:8px 12px">Name</th>
              <th style="text-align:right;padding:8px 12px">Now</th>
              <th style="text-align:right;padding:8px 12px">New</th>
              <th style="text-align:right;padding:8px 12px">Δ</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(i => {
              const d = i.new_price_cents - i.old_price_cents;
              const dStr = (d >= 0 ? '+' : '−') + (Math.abs(d) / 100).toFixed(2);
              const color = d === 0 ? 'var(--text-soft)' : d > 0 ? 'var(--success)' : 'var(--danger)';
              return `<tr style="border-top:1px solid var(--border)">
                <td style="padding:6px 12px"><code>${esc(i.sku)}</code></td>
                <td style="padding:6px 12px">${esc(i.name)}</td>
                <td style="text-align:right;padding:6px 12px;font-variant-numeric:tabular-nums">${(i.old_price_cents/100).toFixed(2)}</td>
                <td style="text-align:right;padding:6px 12px;font-variant-numeric:tabular-nums">${(i.new_price_cents/100).toFixed(2)}</td>
                <td style="text-align:right;padding:6px 12px;font-variant-numeric:tabular-nums;color:${color}">${dStr}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    applyBtn.disabled = total_affected === 0;
  }

  previewBtn.addEventListener('click', doPreview);

  applyBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const r = await window.kaupangr.products.bulkApply(readOpts());
    if (!r.ok) { errEl.textContent = r.error.message; return; }
    if (r.data.applied) {
      dlg.close();
      load();
    } else {
      errEl.textContent = 'Nothing changed.';
    }
  });

  dlg.showModal();
}

  await loadSuppliers();
  await load();
}
