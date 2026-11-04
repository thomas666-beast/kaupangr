import { esc } from '../esc.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const fmt = (c) => (c / 100).toFixed(2);
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

export async function renderSales(root) {
  let offset = 0;
  let q = '';
  let total = 0;
  let lastRows = [];
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('sales.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="${t('sales.searchPlaceholder')}" />
      </div>
      <div class="filterbar">
        <span class="spacer"></span>
        <button class="ghost" id="btnExport">${t('common.exportCsv')}</button>
        <button class="primary" id="btnNew">${t('sales.new')}</button>
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead>
          <tr><th>#</th><th>${t('sales.colDate')}</th><th>${t('sales.colStore')}</th>
              <th>${t('sales.colSeller')}</th>
              <th class="num">${t('sales.colTotal')}</th><th></th></tr>
        </thead>
        <tbody id="rows"><tr><td colspan="6">${t('common.loading')}</td></tr></tbody>
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
    <dialog id="detailDlg"></dialog>
  `;

  const tbody    = root.querySelector('#rows');
  const qInput   = root.querySelector('#f-q');
  const pageInfo = root.querySelector('#pageInfo');
  const btnPrev  = root.querySelector('#btnPrev');
  const btnNext  = root.querySelector('#btnNext');

  async function load() {
    tbody.innerHTML = `<tr><td colspan="6">${t('common.loading')}</td></tr>`;
    const r = await window.kaupangr.sales.list({ q, offset, limit: PAGE_SIZE });
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="6" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    lastRows = rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="6" class="empty" style="text-align:center;padding:2rem 1rem;color:#666">
          <strong style="display:block;color:#333;margin-bottom:.25rem">${q ? t('common.noResults') : t('sales.emptyTitle')}</strong>
          <div class="hint">${q ? 'Try a different search.' : t('sales.emptyHint')}</div>
        </td></tr>`;
    } else {
      tbody.innerHTML = rows.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>${esc(s.created_at)}</td>
          <td>${esc(s.store_name)}</td>
          <td>${esc(s.seller_login)}</td>
          <td class="num">${fmt(s.total_cents)}</td>
          <td>
            <button class="ghost" data-view="${s.id}">${t('sales.view')}</button>
            <button class="ghost" data-return="${s.id}">${t('sales.return')}</button>
          </td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-view]').forEach(b =>
        b.addEventListener('click', () => showDetail(+b.dataset.view)));
      tbody.querySelectorAll('[data-return]').forEach(b =>
        b.addEventListener('click', () => openReturn(+b.dataset.return)));
    }

    const start = total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + rows.length, total);
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

  root.querySelector('#btnExport').addEventListener('click', async () => {
    if (lastRows.length === 0) { alert(t('sales.nothingToExport')); return; }
    const friendly = lastRows.map(r => ({ ...r, total: fmt(r.total_cents) }));
    const csv = rowsToCsv(friendly, [
      { key: 'id',           label: 'id' },
      { key: 'created_at',   label: 'created_at' },
      { key: 'store_name',   label: 'store' },
      { key: 'seller_login', label: 'seller' },
      { key: 'total',        label: 'total' },
      { key: 'client_uuid',  label: 'client_uuid' },
    ]);
    const res = await window.kaupangr.exports.save({
      filename: `sales-${todayIso()}.csv`,
      content: csv,
    });
    if (!res.ok) alert(res.error.message);
  });

  root.querySelector('#btnNew').addEventListener('click', openNewSale);

  async function openNewSale() {
    const rs = await window.kaupangr.stores.list({ activeOnly: true, limit: 200 });
    const stores = rs.ok ? rs.data.rows : [];
    if (stores.length === 0) { alert(t('sales.createStoreFirst')); return; }

    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${t('sales.newTitle')}</h3>
        <div class="dialog-body">
          <div class="form-row">
            <label>${t('pos.storeLabel')}</label>
            <select id="f-store">
              ${stores.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="sale-section">${t('sales.lines')}</div>
          <div id="lines" style="display:flex;flex-direction:column;gap:8px"></div>
          <button type="button" class="ghost" id="btnAddLine">${t('sales.addLine')}</button>
          <div class="sale-total">
            <span>${t('pos.total')}</span>
            <strong id="total">0.00</strong>
          </div>
          <div class="err" id="f-err"></div>
        </div>
        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('sales.saveSale')}</button>
        </menu>
      </form>`;

    const linesEl = dlg.querySelector('#lines');
    const lines = [];

    function recalc() {
      let total = 0;
      for (const ln of lines) {
        const q_ = +ln.els.qty.value || 0;
        const u = Math.round((+ln.els.unit.value || 0) * 100);
        total += q_ * u;
      }
      dlg.querySelector('#total').textContent = fmt(total);
    }

    function addLine() {
      const row = document.createElement('div');
      row.className = 'line-row';
      row.innerHTML = `
        <div class="ac-wrap" style="min-width:0"></div>
        <input class="qty" type="number" min="1" value="1" aria-label="${t('pos.qtyCell')}" />
        <input class="unit" type="number" step="0.01" min="0" value="0.00" aria-label="${t('pos.unitCell')}" />
        <button type="button" class="remove" title="Remove">×</button>`;

      const acEl = row.querySelector('.ac-wrap');
      const qty  = row.querySelector('.qty');
      const unit = row.querySelector('.unit');

      const ac = createSearchable({
        placeholder: 'Search product…',
        searchFn: async (needle) => {
          const r = await window.kaupangr.products.search(needle);
          return {
            ok: r.ok,
            data: r.ok
              ? r.data.map(p => ({ id: p.id, label: `${p.sku} — ${p.name}`, sub: fmt(p.price_cents) }))
              : [],
          };
        },
        onChange: (sel) => {
          if (sel) {
            window.kaupangr.products.findBySku(sel.label.split(' — ')[0]).then(rr => {
              if (rr.ok && rr.data) unit.value = (rr.data.price_cents / 100).toFixed(2);
              recalc();
            });
          }
        },
      });
      acEl.appendChild(ac.el);

      qty.addEventListener('input', recalc);
      unit.addEventListener('input', recalc);
      row.querySelector('.remove').addEventListener('click', () => {
        const i = lines.findIndex(l => l.row === row);
        if (i >= 0) lines.splice(i, 1);
        row.remove();
        recalc();
      });

      const ln = { row, ac, qty, unit, els: { qty, unit } };
      lines.push(ln);
      linesEl.appendChild(row);
      ac.focus();
      recalc();
    }

    dlg.querySelector('#btnAddLine').addEventListener('click', addLine);
    addLine();
    dlg.showModal();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();

      const payload = [];
      for (const ln of lines) {
        const pick = ln.ac.get();
        if (!pick) continue;
        payload.push({
          productId: pick.id,
          quantity: +ln.els.qty.value || 0,
          unitPriceCents: Math.round((+ln.els.unit.value || 0) * 100),
        });
      }
      if (payload.length === 0) {
        dlg.querySelector('#f-err').textContent = t('sales.pickAtLeastOne');
        return;
      }
      const storeId = +dlg.querySelector('#f-store').value;
      const res = await window.kaupangr.sales.create({ storeId, lines: payload });
      if (!res.ok) { dlg.querySelector('#f-err').textContent = res.error.message; return; }
      dlg.close();
      offset = 0;
      load();
    });
  }

  async function openReturn(saleId) {
    const [rs, rr] = await Promise.all([
      window.kaupangr.sales.get(saleId),
      window.kaupangr.returns.listBySale(saleId),
    ]);
    if (!rs.ok) { alert(rs.error.message); return; }
    const sale = rs.data;
    const priorReturns = rr.ok ? rr.data : [];
    const returnedBySaleLine = {};
    for (const ret of priorReturns) {
      const det = await window.kaupangr.returns.get(ret.id);
      if (!det.ok) continue;
      for (const l of det.data.lines) {
        returnedBySaleLine[l.sale_line_id] = (returnedBySaleLine[l.sale_line_id] || 0) + l.quantity;
      }
    }

    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${t('sales.returnTitle', { id: sale.id })}</h3>
        <div class="dialog-body">
          <div id="lines" style="display:flex;flex-direction:column;gap:8px">
            ${sale.lines.map(l => {
              const already = returnedBySaleLine[l.id] || 0;
              const remaining = l.quantity - already;
              return `
                <div class="return-row" data-line="${l.id}">
                  <div style="min-width:0">
                    <strong>${esc(l.sku)}</strong> — ${esc(l.product_name)}<br/>
                    <small style="color:var(--text-muted)">${t('sales.soldReturnedRemaining', { sold: l.quantity, returned: already, remaining })}</small>
                  </div>
                  <div class="unit">@ ${fmt(l.unit_price_cents)}</div>
                  <input class="qty" type="number" min="0" max="${remaining}" value="0"
                         ${remaining === 0 ? 'disabled' : ''} />
                </div>`;
            }).join('')}
          </div>
          <div class="err" id="f-err"></div>
        </div>
        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('sales.saveReturn')}</button>
        </menu>
      </form>`;
    dlg.showModal();
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      const lines = [...dlg.querySelectorAll('.return-row')].map(r => ({
        saleLineId: +r.dataset.line,
        quantity: +r.querySelector('.qty').value || 0,
      })).filter(l => l.quantity > 0);
      if (lines.length === 0) { dlg.querySelector('#f-err').textContent = t('sales.pickAtLeastOne'); return; }
      const res = await window.kaupangr.returns.create({ saleId, lines });
      if (!res.ok) { dlg.querySelector('#f-err').textContent = res.error.message; return; }
      dlg.close();
      load();
    });
  }

  // ------------------------------------------------------------------
  // Sale detail — form method="dialog" so Close/Cancel work
  // ------------------------------------------------------------------
  async function showDetail(saleId) {
    const [rs, rr] = await Promise.all([
      window.kaupangr.sales.get(saleId),
      window.kaupangr.returns.listBySale(saleId),
    ]);
    if (!rs.ok) { alert(rs.error.message); return; }
    const sale = rs.data;
    const returns = rr.ok ? rr.data : [];
    const dlg = root.querySelector('#detailDlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${t('sales.detailTitle', { id: sale.id })}</h3>
        <div class="dialog-body">
          <p style="margin:0 0 16px;color:var(--text-muted)">
            ${esc(sale.created_at)} · ${esc(sale.store_name)} · ${esc(sale.seller_login)}
          </p>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px 0;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">${t('pos.skuCell')}</th>
                <th style="text-align:left;padding:8px 0;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">${t('pos.productCell')}</th>
                <th style="text-align:right;padding:8px 0;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">${t('pos.qtyCell')}</th>
                <th style="text-align:right;padding:8px 0;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">${t('pos.unitCell')}</th>
                <th style="text-align:right;padding:8px 0;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)">${t('pos.subtotalCell')}</th>
              </tr>
            </thead>
            <tbody>
              ${sale.lines.map(l => `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid var(--border)"><code>${esc(l.sku)}</code></td>
                  <td style="padding:10px 0;border-bottom:1px solid var(--border)">${esc(l.product_name)}</td>
                  <td style="padding:10px 0;border-bottom:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums">${l.quantity}</td>
                  <td style="padding:10px 0;border-bottom:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums">${fmt(l.unit_price_cents)}</td>
                  <td style="padding:10px 0;border-bottom:1px solid var(--border);text-align:right;font-variant-numeric:tabular-nums">${fmt(l.quantity * l.unit_price_cents)}</td>
                </tr>`).join('')}
              <tr>
                <td colspan="4" style="text-align:right;padding:12px 0 0;font-weight:600">${t('pos.total')}</td>
                <td style="text-align:right;padding:12px 0 0;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums">${fmt(sale.total_cents)}</td>
              </tr>
            </tbody>
          </table>
          ${returns.length ? `
            <h4 style="margin:24px 0 8px;font-size:14px">${t('sales.returnsHeader')}</h4>
            <ul style="margin:0;padding-left:20px">
              ${returns.map(r => `<li style="padding:4px 0">#${r.id} — ${esc(r.created_at)} — <strong>${fmt(r.total_cents)}</strong></li>`).join('')}
            </ul>
          ` : ''}
          <div class="err" id="print-err" style="margin-top:12px"></div>
        </div>
        <menu>
          <button type="button" class="ghost" id="btnPrint">Print receipt</button>
          <button class="ghost" value="close">${t('common.close')}</button>
        </menu>
      </form>`;

    dlg.querySelector('#btnPrint').addEventListener('click', async () => {
      const errEl = dlg.querySelector('#print-err');
      errEl.textContent = '';
      const r = await window.kaupangr.receipts.print(saleId);
      if (!r.ok) { errEl.textContent = r.error.message; return; }
      errEl.style.color = 'var(--success)';
      errEl.textContent = 'Sent to printer.';
    });
    dlg.showModal();
  }

  load();
}
