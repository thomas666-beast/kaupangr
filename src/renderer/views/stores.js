import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { emptyState } from '../empty.js';
import { sortRows, headerCell } from '../sortable.js';
import { t } from '../i18n/index.js';

const CAN_EDIT = (u) => u && (u.role === 'administrator' || u.role === 'product_manager');
const PAGE_SIZE = 50;

export async function renderStores(root) {
  const canEdit = CAN_EDIT(getState().user);
  let offset = 0;
  let q = '';
  let total = 0;
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('stores.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="Search by name or address…" />
      </div>
      <div class="filterbar">
        <span class="spacer"></span>
        ${canEdit ? `<button class="primary" id="btnNew">${t('stores.new')}</button>` : ''}
      </div>
    </div>

    <div class="datatable">
      <table>
        <thead id="head"></thead>
        <tbody id="rows"><tr><td colspan="5">${t('common.loading')}</td></tr></tbody>
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
    tbody.innerHTML = `<tr><td colspan="5">${t('common.loading')}</td></tr>`;
    const r = await window.kaupangr.stores.list({ q, offset, limit: PAGE_SIZE });
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="5" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = emptyState(5, q ? t('common.noResults') : t('stores.emptyTitle'),
        q ? 'Try a different search.' : t('stores.emptyHint'));
    } else {
      const sorted = sortRows(rows, sort.key, sort.dir);
      tbody.innerHTML = sorted.map(s => `
        <tr class="${s.is_active ? '' : 'inactive'}">
          <td>${s.id}</td>
          <td>${esc(s.name)}</td>
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
              body: 'This store will no longer be selectable in POS. Existing sales are unaffected.',
              okText: t('common.deactivate'),
              danger: true,
            });
            if (!ok) return;
          }
          await window.kaupangr.stores.setActive(id, !row.is_active);
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

  function openForm(store) {
    const dlg = root.querySelector('#dlg');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${store ? t('stores.edit') : t('stores.new')}</h3>

        <div class="dialog-body">
          <div class="form-row">
            <label>${t('stores.name')}</label>
            <input id="f-name" value="${store ? esc(store.name) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('stores.address')}</label>
            <input id="f-address" value="${store ? esc(store.address ?? '') : ''}" />
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
      const address = dlg.querySelector('#f-address').value || null;
      const r = store
        ? await window.kaupangr.stores.update(store.id, { name, address })
        : await window.kaupangr.stores.create({ name, address });
      if (!r.ok) { dlg.querySelector('#f-err').textContent = r.error.message; return; }
      dlg.close();
      load();
    });
  }

  load();
}
