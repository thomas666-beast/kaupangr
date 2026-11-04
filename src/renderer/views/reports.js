import { esc } from '../esc.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const fmt = (c) => (c / 100).toFixed(2);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysAgoIso(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function rowsToCsv(rows, cols) {
  const head = cols.map(c => csvEscape(c.label)).join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c.key])).join(',')).join('\r\n');
  return head + (body ? '\r\n' + body : '') + '\r\n';
}

export async function renderReports(root) {
  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('reports.title')}</h2>
      <div class="searchbar">
        <label style="display:flex;align-items:center;gap:.4rem">
          <span style="font-size:.85rem;color:#555;white-space:nowrap">${t('reports.quickRange')}</span>
          <select id="f-quick">
            <option value="today">${t('reports.today')}</option>
            <option value="7" selected>${t('reports.last7')}</option>
            <option value="30">${t('reports.last30')}</option>
            <option value="all">${t('reports.allTime')}</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:.4rem">
          <span style="font-size:.85rem;color:#555">${t('reports.from')}</span>
          <input id="f-from" type="date" />
        </label>
        <label style="display:flex;align-items:center;gap:.4rem">
          <span style="font-size:.85rem;color:#555">${t('reports.to')}</span>
          <input id="f-to" type="date" />
        </label>
      </div>
      <div class="filterbar">
        <div id="f-store-wrap" class="ac-wrap"></div>
        <span class="spacer"></span>
        <button class="ghost" id="btnExport">${t('common.exportCsv')}</button>
        <button class="primary" id="btnRefresh">${t('common.refresh')}</button>
      </div>
    </div>

    <div class="datatable" style="padding:24px;overflow:auto">
      <div class="err" id="err"></div>

      <h3 style="margin:0 0 8px">${t('reports.byDay')}</h3>
      <table><thead><tr>
        <th>${t('reports.colDate')}</th><th class="num">${t('reports.colSales')}</th>
        <th class="num">${t('reports.colSalesTotal')}</th><th class="num">${t('reports.colReturns')}</th>
        <th class="num">${t('reports.colReturnsTotal')}</th><th class="num">${t('reports.colNet')}</th>
      </tr></thead><tbody id="rows-days"><tr><td colspan="6">${t('common.loading')}</td></tr></tbody></table>

      <h3 style="margin:24px 0 8px">${t('reports.byStore')}</h3>
      <table><thead><tr>
        <th>${t('reports.colStore')}</th><th class="num">${t('reports.colSales')}</th>
        <th class="num">${t('reports.colSalesTotal')}</th><th class="num">${t('reports.colReturns')}</th>
        <th class="num">${t('reports.colReturnsTotal')}</th><th class="num">${t('reports.colNet')}</th>
      </tr></thead><tbody id="rows-stores"><tr><td colspan="6">${t('common.loading')}</td></tr></tbody></table>

      <h3 style="margin:24px 0 8px">${t('reports.bySeller')}</h3>
      <table><thead><tr>
        <th>${t('reports.colSeller')}</th><th class="num">${t('reports.colSales')}</th>
        <th class="num">${t('reports.colSalesTotal')}</th><th class="num">${t('reports.colReturns')}</th>
        <th class="num">${t('reports.colReturnsTotal')}</th><th class="num">${t('reports.colNet')}</th>
      </tr></thead><tbody id="rows-sellers"><tr><td colspan="6">${t('common.loading')}</td></tr></tbody></table>

      <div style="margin:32px 0 8px;display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0">By product</h3>
        <label style="font-size:13px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
          Show
          <select id="f-top" style="height:32px;padding:0 8px;border:1px solid var(--border-strong);border-radius:6px">
            <option value="50">Top 50</option>
            <option value="100" selected>Top 100</option>
            <option value="500">Top 500</option>
          </select>
        </label>
      </div>
      <table><thead><tr>
        <th>SKU</th><th>Product</th>
        <th class="num">Sold qty</th><th class="num">Sold revenue</th>
        <th class="num">Returned</th><th class="num">Returned revenue</th>
        <th class="num">Net qty</th><th class="num">Net revenue</th>
      </tr></thead><tbody id="rows-products"><tr><td colspan="8">${t('common.loading')}</td></tr></tbody></table>

      <div style="margin:32px 0 8px;display:flex;align-items:center;justify-content:space-between">
        <h3 style="margin:0">Hourly heatmap</h3>
        <label style="font-size:13px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
          Metric
          <select id="f-heat-metric" style="height:32px;padding:0 8px;border:1px solid var(--border-strong);border-radius:6px">
            <option value="count" selected>Sales count</option>
            <option value="cents">Sales revenue</option>
          </select>
        </label>
      </div>
      <div id="heatmap" style="overflow:auto"></div>
    </div>
  `;

  const quickSel  = root.querySelector('#f-quick');
  const fromInput = root.querySelector('#f-from');
  const toInput   = root.querySelector('#f-to');
  const topSel    = root.querySelector('#f-top');
  const metricSel = root.querySelector('#f-heat-metric');
  const errEl     = root.querySelector('#err');
  const tbodyDays     = root.querySelector('#rows-days');
  const tbodyStores   = root.querySelector('#rows-stores');
  const tbodySellers  = root.querySelector('#rows-sellers');
  const tbodyProducts = root.querySelector('#rows-products');
  const heatmapEl     = root.querySelector('#heatmap');

  let storeFilter = null;
  let lastDays = [], lastStores = [], lastSellers = [], lastProducts = [], lastHeatmap = [];

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

  function applyQuickRange() {
    const v = quickSel.value;
    const today = todayIso();
    if (v === 'today') { fromInput.value = today; toInput.value = today; }
    else if (v === '7')  { fromInput.value = daysAgoIso(6); toInput.value = today; }
    else if (v === '30') { fromInput.value = daysAgoIso(29); toInput.value = today; }
    else                 { fromInput.value = ''; toInput.value = ''; }
  }

  function fmtRow(r, labelVal) {
    return `
      <tr>
        <td>${esc(labelVal)}</td>
        <td class="num">${r.sales_count}</td>
        <td class="num">${fmt(r.sales_cents)}</td>
        <td class="num">${r.returns_count}</td>
        <td class="num" style="${r.returns_count ? 'color:#b3261e' : ''}">${fmt(r.returns_cents)}</td>
        <td class="num" style="${r.net_cents < 0 ? 'color:#b3261e' : 'font-weight:600'}">${fmt(r.net_cents)}</td>
      </tr>`;
  }
  function fmtProdRow(p) {
    return `
      <tr>
        <td><code>${esc(p.sku)}</code></td>
        <td>${esc(p.name)}</td>
        <td class="num">${p.sold_qty}</td>
        <td class="num">${fmt(p.sold_cents)}</td>
        <td class="num" style="${p.returned_qty ? 'color:#b3261e' : ''}">${p.returned_qty || 0}</td>
        <td class="num" style="${p.returned_qty ? 'color:#b3261e' : ''}">${fmt(p.returned_cents || 0)}</td>
        <td class="num">${p.net_qty}</td>
        <td class="num" style="font-weight:600">${fmt(p.net_cents)}</td>
      </tr>`;
  }
  function empty(cols, msg) {
    return `<tr><td colspan="${cols}" style="text-align:center;padding:1.5rem;color:#666">${msg}</td></tr>`;
  }

  // ---- heatmap renderer ----
  function renderHeatmap() {
    if (lastHeatmap.length === 0) {
      heatmapEl.innerHTML = `<p style="text-align:center;color:#666;padding:1.5rem">No sales in this range.</p>`;
      return;
    }

    const metric = metricSel.value;   // 'count' or 'cents'
    // Build a lookup: grid[dow][hour] = value
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const r of lastHeatmap) {
      const v = metric === 'count' ? r.count : r.cents;
      grid[r.dow][r.hour] = v;
      if (v > max) max = v;
    }

    // Determine hour range to display (from first to last non-empty hour)
    let minHour = 23, maxHour = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      if (grid[d][h] > 0) {
        if (h < minHour) minHour = h;
        if (h > maxHour) maxHour = h;
      }
    }
    if (minHour > maxHour) { minHour = 0; maxHour = 23; }

    const hoursToShow = HOURS.slice(minHour, maxHour + 1);

    function cellColor(v) {
      if (v === 0) return 'transparent';
      // Ratio 0..1, but non-linear so mid-range shows up
      const ratio = Math.pow(v / max, 0.6);
      // Accent (#b3472a) with variable alpha, or a light->dark scale
      const alpha = 0.08 + ratio * 0.7;
      return `rgba(179, 71, 42, ${alpha.toFixed(3)})`;
    }
    function cellText(v) {
      if (v === 0) return '';
      return metric === 'count' ? String(v) : fmt(v);
    }

    const colHeader = DAYS.map(d => `<th style="text-align:center;padding:6px 10px;font-size:12px;color:var(--text-muted);font-weight:600">${d}</th>`).join('');
    const body = hoursToShow.map(h => `
      <tr>
        <th style="text-align:right;padding:4px 10px;font-size:12px;color:var(--text-muted);font-weight:600;white-space:nowrap">${String(h).padStart(2, '0')}:00</th>
        ${DAYS.map((_, dow) => {
          const v = grid[dow][h];
          const bg = cellColor(v);
          const txt = cellText(v);
          return `<td style="padding:8px;text-align:center;border:1px solid var(--border);font-size:12px;min-width:56px;background:${bg};color:${v > max * 0.55 ? '#fff' : 'var(--text)'}" title="${DAYS[dow]} ${String(h).padStart(2,'0')}:00 — ${v === 0 ? 'no sales' : (metric === 'count' ? v + ' sales' : fmt(v))}">${txt}</td>`;
        }).join('')}
      </tr>`).join('');

    heatmapEl.innerHTML = `
      <table style="border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <thead>
          <tr>
            <th></th>
            ${colHeader}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <p style="margin:8px 0 0;font-size:12px;color:var(--text-muted)">
        Darker = busier. Max in range: ${metric === 'count' ? max + ' sales' : fmt(max)}.
      </p>`;
  }

  async function load() {
    errEl.textContent = '';
    const opts = {};
    if (fromInput.value) opts.from = fromInput.value;
    if (toInput.value)   opts.to   = toInput.value;
    if (storeFilter)     opts.storeId = storeFilter.id;

    const topN = +topSel.value || 100;

    const [rd, rst, rse, rp, rh] = await Promise.all([
      window.kaupangr.reports.salesByDay(opts),
      window.kaupangr.reports.salesByStore(opts),
      window.kaupangr.reports.salesBySeller(opts),
      window.kaupangr.reports.salesByProduct({ ...opts, limit: topN }),
      window.kaupangr.reports.hourlyHeatmap(opts),
    ]);

    if (!rd.ok || !rst.ok || !rse.ok || !rp.ok || !rh.ok) {
      const msg = (!rd.ok && rd.error.message)
        || (!rst.ok && rst.error.message)
        || (!rse.ok && rse.error.message)
        || (!rp.ok && rp.error.message)
        || (!rh.ok && rh.error.message)
        || 'report failed';
      errEl.textContent = msg;
      return;
    }

    lastDays     = rd.data;
    lastStores   = rst.data;
    lastSellers  = rse.data;
    lastProducts = rp.data;
    lastHeatmap  = rh.data;

    tbodyDays.innerHTML = lastDays.length === 0
      ? empty(6, t('reports.noActivity'))
      : lastDays.map(r => fmtRow(r, r.day)).join('');

    tbodyStores.innerHTML = lastStores.length === 0
      ? empty(6, t('reports.noActivity'))
      : lastStores.map(r => fmtRow(r, r.store_name)).join('');

    tbodySellers.innerHTML = lastSellers.length === 0
      ? empty(6, t('reports.noActivity'))
      : lastSellers.map(r => fmtRow(r, r.user_login)).join('');

    tbodyProducts.innerHTML = lastProducts.length === 0
      ? empty(8, t('reports.noActivity'))
      : lastProducts.map(fmtProdRow).join('');

    renderHeatmap();
  }

  quickSel.addEventListener('change', () => { applyQuickRange(); load(); });
  fromInput.addEventListener('change', () => { quickSel.value = 'all'; load(); });
  toInput.addEventListener('change',   () => { quickSel.value = 'all'; load(); });
  topSel.addEventListener('change', () => load());
  metricSel.addEventListener('change', () => renderHeatmap());
  root.querySelector('#btnRefresh').addEventListener('click', load);

  root.querySelector('#btnExport').addEventListener('click', async () => {
    const from = fromInput.value || 'any';
    const to   = toInput.value   || 'any';
    const cols = [
      { key: 'label',         label: 'label' },
      { key: 'sales_count',   label: 'sales_count' },
      { key: 'sales_total',   label: 'sales_total' },
      { key: 'returns_count', label: 'returns_count' },
      { key: 'returns_total', label: 'returns_total' },
      { key: 'net_total',     label: 'net_total' },
    ];
    const prep = (rows, labelKey) => rows.map(r => ({
      label: r[labelKey],
      sales_count: r.sales_count,
      sales_total: fmt(r.sales_cents),
      returns_count: r.returns_count,
      returns_total: fmt(r.returns_cents),
      net_total: fmt(r.net_cents),
    }));

    const parts = [];
    parts.push(`# Reports  range: ${from} .. ${to}  store: ${storeFilter ? storeFilter.label : 'all'}`);
    parts.push('');
    parts.push('# By day');
    parts.push(rowsToCsv(prep(lastDays,    'day'),        cols));
    parts.push('# By store');
    parts.push(rowsToCsv(prep(lastStores,  'store_name'), cols));
    parts.push('# By seller');
    parts.push(rowsToCsv(prep(lastSellers, 'user_login'), cols));
    parts.push('# By product');
    parts.push(rowsToCsv(lastProducts.map(p => ({
      sku: p.sku, name: p.name,
      sold_qty: p.sold_qty, sold_total: fmt(p.sold_cents),
      returned_qty: p.returned_qty, returned_total: fmt(p.returned_cents),
      net_qty: p.net_qty, net_total: fmt(p.net_cents),
    })), [
      { key: 'sku',            label: 'sku' },
      { key: 'name',           label: 'product' },
      { key: 'sold_qty',       label: 'sold_qty' },
      { key: 'sold_total',     label: 'sold_total' },
      { key: 'returned_qty',   label: 'returned_qty' },
      { key: 'returned_total', label: 'returned_total' },
      { key: 'net_qty',        label: 'net_qty' },
      { key: 'net_total',      label: 'net_total' },
    ]));
    parts.push('# Hourly heatmap');
    parts.push(rowsToCsv(lastHeatmap.map(r => ({
      dow: DAYS[r.dow], hour: r.hour, count: r.count, cents: fmt(r.cents),
    })), [
      { key: 'dow',   label: 'day' },
      { key: 'hour',  label: 'hour' },
      { key: 'count', label: 'sales_count' },
      { key: 'cents', label: 'sales_revenue' },
    ]));

    const res = await window.kaupangr.exports.save({
      filename: `reports-${todayIso()}.csv`,
      content: parts.join('\r\n'),
    });
    if (!res.ok) alert(res.error.message);
  });

  applyQuickRange();
  load();
}
