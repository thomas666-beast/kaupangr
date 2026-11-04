import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { emptyState } from '../empty.js';
import { sortRows, headerCell } from '../sortable.js';
import { t } from '../i18n/index.js';

const CAN_EDIT = (u) => u && (u.role === 'administrator' || u.role === 'product_manager');
const PAGE_SIZE = 50;

export async function renderSuppliers(root) {
  const canEdit = CAN_EDIT(getState().user);
  let offset = 0;
  let q = '';
  let total = 0;
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('suppliers.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="Search by name, contact, or address…" />
      </div>
      <div class="filterbar">
        <span class="spacer"></span>
        ${canEdit ? `<button class="primary" id="btnNew">${t('suppliers.new')}</button>` : ''}
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead id="head"></thead>
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
  `;

  const thead    = root.querySelector('#head');
  const tbody    = root.querySelector('#rows');
  const qInput   = root.querySelector('#f-q');
  const pageInfo = root.querySelector('#pageInfo');
  const btnPrev  = root.querySelector('#btnPrev');
  const btnNext  = root.querySelector('#btnNext');
  let sort = { key: 'name', dir: 'asc' };

  function paintHeader() {
    thead.innerHTML = `
      <tr>
        ${headerCell('#', 'id', sort)}
        ${headerCell('Name', 'name', sort)}
        ${headerCell('Contact', 'contact', sort)}
        ${headerCell('Address', 'address', sort)}
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

  async function load() {
    tbody.innerHTML = `<tr><td colspan="6">${t('common.loading')}</td></tr>`;
    const r = await window.kaupangr.suppliers.list({ q, offset, limit: PAGE_SIZE });
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="6" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = emptyState(6, q ? t('common.noResults') : t('suppliers.emptyTitle'),
        q ? 'Try a different search.' : t('suppliers.emptyHint'));
    } else {
      const sorted = sortRows(rows, sort.key, sort.dir);
      tbody.innerHTML = sorted.map(s => `
        <tr class="${s.is_active ? '' : 'inactive'}">
          <td>${s.id}</td>
          <td>${esc(s.name)}</td>
          <td>${esc(s.contact ?? '')}</td>
          <td>${esc(s.address ?? '')}</td>
          <td>${s.is_active ? 'active' : 'inactive'}</td>
          <td>
            ${canEdit ? `
              <button class="ghost" data-edit="${s.id}">${t('common.edit')}</button>
              <button class="ghost ${s.is_active ? 'danger' : ''}" data-toggle="${s.id}">
                ${s.is_active ? t('common.deactivate') : t('common.activate')}
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
              body: 'This supplier will no longer appear in new products. Existing products are unaffected.',
              okText: t('common.deactivate'),
              danger: true,
            });
            if (!ok) return;
          }
          await window.kaupangr.suppliers.setActive(id, !row.is_active);
          load();
        }));
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

  root.querySelector('#btnNew')?.addEventListener('click', () => openForm(null));

  function openForm(sup) {
    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${sup ? t('suppliers.edit') : t('suppliers.new')}</h3>

        <div class="dialog-body">
          <div class="form-row">
            <label>${t('suppliers.name')}</label>
            <input id="f-name" value="${sup ? esc(sup.name) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('suppliers.contact')}</label>
            <input id="f-contact" value="${sup ? esc(sup.contact ?? '') : ''}" />
          </div>
          <div class="form-row">
            <label>${t('suppliers.address')}</label>
            <input id="f-address" value="${sup ? esc(sup.address ?? '') : ''}" />
          </div>
          <div class="err" id="f-err"></div>
        </div>

        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('common.save')}</button>
        </menu>
      </form>`;
    dlg.showModal();
    dlg.querySelector('#f-name').focus();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      const name = dlg.querySelector('#f-name').value;
      const contact = dlg.querySelector('#f-contact').value || null;
      const address = dlg.querySelector('#f-address').value || null;
      const r = sup
        ? await window.kaupangr.suppliers.update(sup.id, { name, contact, address })
        : await window.kaupangr.suppliers.create({ name, contact, address });
      if (!r.ok) { dlg.querySelector('#f-err').textContent = r.error.message; return; }
      dlg.close();
      load();
    });
  }

  load();
}
