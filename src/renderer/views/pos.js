import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { createSearchable } from '../searchable.js';
import { t } from '../i18n/index.js';

const fmt = (c) => (c / 100).toFixed(2);

export async function renderPos(root) {
  root.innerHTML = `
    <div class="pos-header">
      <h2>${t('pos.title')}</h2>
    </div>

    <div class="pos-bar">
      <input id="sku" class="pos-sku" placeholder="${t('pos.skuPlaceholder')}" autofocus />
      <input id="q"   class="pos-search" placeholder="${t('pos.searchPlaceholder')}" />
    </div>
    <div id="searchResults" class="pos-results"></div>

    <div class="pos-layout">
      <div class="pos-cart">
        <table>
          <thead>
            <tr>
              <th>${t('pos.skuCell')}</th>
              <th>${t('pos.productCell')}</th>
              <th class="num">${t('pos.qtyCell')}</th>
              <th class="num">${t('pos.unitCell')}</th>
              <th class="num">${t('pos.subtotalCell')}</th>
              <th class="num">${t('pos.onHand')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="cart">
            <tr>
              <td colspan="7" class="pos-empty-cell">${t('pos.addPrompt')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="pos-side">
        <label>${t('pos.storeLabel')}</label>
        <div id="store-wrap"></div>
        <div class="pos-total">
          <span>${t('pos.total')}</span>
          <strong id="total">0.00</strong>
        </div>
        <button class="primary pos-commit" id="btnCommit" disabled>${t('pos.charge')} &nbsp;(F2)</button>
        <button class="ghost" id="btnClear">${t('pos.clear')} &nbsp;(Esc)</button>
        <div class="err" id="err"></div>
      </aside>
    </div>
  `;

  const skuInput    = root.querySelector('#sku');
  const searchInput = root.querySelector('#q');
  const resultsEl   = root.querySelector('#searchResults');
  const cartBody    = root.querySelector('#cart');
  const totalEl     = root.querySelector('#total');
  const commitBtn   = root.querySelector('#btnCommit');
  const errEl       = root.querySelector('#err');

  const cart = new Map();
  let storeId = null;
  let stores = [];

  const storesRes = await window.kaupangr.stores.list({ activeOnly: true, limit: 200 });
  stores = storesRes.ok ? storesRes.data.rows : [];
  if (stores.length === 0) {
    root.querySelector('.pos-layout').innerHTML =
      `<p class="err">${t('pos.noStore')}</p>`;
    return;
  }

  const storeAC = createSearchable({
    placeholder: t('pos.storeLabel'),
    searchFn: async (needle) => {
      const ql = needle.toLowerCase();
      return {
        ok: true,
        data: stores
          .filter(s =>
            s.name.toLowerCase().includes(ql) ||
            (s.address ?? '').toLowerCase().includes(ql))
          .map(s => ({ id: s.id, label: s.name, sub: s.address ?? '' })),
      };
    },
    onChange: (sel) => { storeId = sel ? sel.id : null; paintCart(); },
  });
  root.querySelector('#store-wrap').appendChild(storeAC.el);
  storeAC.setValue({ id: stores[0].id, label: stores[0].name });
  storeId = stores[0].id;

  function addToCart(product, qty = 1) {
    if (!product || !product.is_active) { flashErr(t('pos.productInactive')); return; }
    const cur = cart.get(product.id);
    if (cur) cur.quantity += qty;
    else cart.set(product.id, { product, quantity: qty, unitPriceCents: product.price_cents });
    paintCart();
  }

  function removeLine(productId) { cart.delete(productId); paintCart(); }
  function flashErr(msg) { errEl.textContent = msg; }

  async function paintCart() {
    errEl.textContent = '';
    if (cart.size === 0) {
      cartBody.innerHTML = `<tr>
        <td colspan="7" class="pos-empty-cell">${t('pos.addPrompt')}</td>
      </tr>`;
      totalEl.textContent = '0.00';
      commitBtn.disabled = true;
      return;
    }

    const products = [...cart.values()];
    const onHands = await Promise.all(
      products.map(({ product }) =>
        storeId
          ? window.kaupangr.stock.onHand(product.id, storeId).catch(() => ({ ok: false }))
          : Promise.resolve({ ok: false }))
    );

    let total = 0;
    cartBody.innerHTML = products.map(({ product, quantity, unitPriceCents }, i) => {
      const subtotal = quantity * unitPriceCents;
      total += subtotal;
      const onHand = onHands[i].ok ? onHands[i].data : null;
      const wouldOversell = onHand != null && (onHand - quantity) < 0;
      const onHandCell = onHand == null ? '—' : onHand;
      return `
        <tr data-product-id="${product.id}" class="${wouldOversell ? 'pos-oversell' : ''}">
          <td><code>${esc(product.sku)}</code></td>
          <td>${esc(product.name)}</td>
          <td class="num">
            <input class="cart-qty" data-id="${product.id}" type="number" min="1"
                   value="${quantity}" style="width:70px;text-align:right" />
          </td>
          <td class="num">${fmt(unitPriceCents)}</td>
          <td class="num">${fmt(subtotal)}</td>
          <td class="num" style="${wouldOversell ? 'color:#b3261e;font-weight:600' : ''}">${onHandCell}</td>
          <td><button class="remove" data-id="${product.id}" title="Remove">×</button></td>
        </tr>`;
    }).join('');

    totalEl.textContent = fmt(total);
    commitBtn.disabled = !storeId;

    cartBody.querySelectorAll('.cart-qty').forEach(inp =>
      inp.addEventListener('change', () => {
        const id = +inp.dataset.id;
        const v = Math.max(1, Math.floor(+inp.value || 1));
        cart.get(id).quantity = v;
        paintCart();
      }));
    cartBody.querySelectorAll('.remove').forEach(b =>
      b.addEventListener('click', () => removeLine(+b.dataset.id)));
  }

  function clearCart() { cart.clear(); paintCart(); skuInput.focus(); }

  skuInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = skuInput.value.trim();
    if (!code) return;
    const r = await window.kaupangr.products.findBySku(code);
    if (!r.ok) { flashErr(r.error.message); return; }
    if (!r.data) { flashErr(t('pos.unknownSku', { sku: code })); return; }
    addToCart(r.data, 1);
    skuInput.value = '';
    skuInput.focus();
  });

  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      const r = await window.kaupangr.products.search(q);
      if (!r.ok) { resultsEl.innerHTML = `<div class="err">${r.error.message}</div>`; return; }
      if (r.data.length === 0) { resultsEl.innerHTML = `<div class="pos-hit-empty">${t('pos.noMatch')}</div>`; return; }
      resultsEl.innerHTML = r.data.map(p => `
        <button class="pos-hit" data-id="${p.id}">
          <code>${esc(p.sku)}</code> — ${esc(p.name)}
          <span class="pos-hit-price">${fmt(p.price_cents)}</span>
        </button>`).join('');
      resultsEl.querySelectorAll('.pos-hit').forEach(b =>
        b.addEventListener('click', () => {
          const p = r.data.find(x => x.id === +b.dataset.id);
          addToCart(p, 1);
          searchInput.value = '';
          resultsEl.innerHTML = '';
          skuInput.focus();
        }));
    }, 120);
  });

  commitBtn.addEventListener('click', commitSale);

  async function commitSale() {
    if (cart.size === 0 || !storeId) return;
    errEl.textContent = '';
    commitBtn.disabled = true;
    const lines = [...cart.values()].map(({ product, quantity, unitPriceCents }) => ({
      productId: product.id,
      quantity,
      unitPriceCents,
    }));
    const r = await window.kaupangr.sales.create({ storeId, lines });
    if (!r.ok) {
      flashErr(r.error.message);
      commitBtn.disabled = false;
      return;
    }
    cart.clear();
    paintCart();
    skuInput.focus();
    const tEl = document.createElement('div');
    tEl.className = 'pos-toast';
    tEl.textContent = t('pos.saleSaved', { id: r.data.id, total: fmt(r.data.total_cents) });
    document.body.appendChild(tEl);
    setTimeout(() => tEl.remove(), 1500);
  }

  root.querySelector('#btnClear').addEventListener('click', async () => {
    if (cart.size === 0) return;
    const ok = await confirmAction({
      title: t('pos.clearConfirmTitle'),
      body: t('pos.clearConfirmBody', { n: cart.size }),
      okText: t('pos.clear'),
      danger: true,
    });
    if (ok) clearCart();
  });

  function onKey(e) {
    if (!document.body.contains(skuInput)) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'F2') { e.preventDefault(); if (!commitBtn.disabled) commitSale(); }
    if (e.key === 'Escape') { e.preventDefault(); if (cart.size > 0) root.querySelector('#btnClear').click(); }
    if (e.key === '/' && document.activeElement !== skuInput && document.activeElement !== searchInput) {
      e.preventDefault(); skuInput.focus();
    }
  }
  document.addEventListener('keydown', onKey);

  paintCart();
  skuInput.focus();
}
