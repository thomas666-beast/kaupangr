import { getState } from '../state/store.js';
import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { emptyState } from '../empty.js';
import { sortRows, headerCell } from '../sortable.js';
import { t } from '../i18n/index.js';
import { ADMINISTRATOR, ROLES } from '../../main/services/constants.js';

const PAGE_SIZE = 50;

export async function renderUsers(root) {
  const user = getState().user;
  if (user?.role !== ADMINISTRATOR) {
    root.innerHTML = `<p class="err">${t('users.adminOnly')}</p>`;
    return;
  }

  let offset = 0;
  let q = '';
  let roleFilter = '';
  let total = 0;
  let searchTimer = null;

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('users.title')}</h2>
      <div class="searchbar">
        <input id="f-q" type="text" placeholder="Search by login…" />
      </div>
      <div class="filterbar">
        <select id="f-role">
          <option value="">${t('common.new')}</option>
          ${ROLES.map(r => `<option value="${r}">${t('users.role' + r.charAt(0).toUpperCase() + r.slice(1).replace('_',''))}</option>`).join('')}
        </select>
        <span class="spacer"></span>
        <button class="primary" id="btnNew">${t('users.new')}</button>
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
  const roleSel  = root.querySelector('#f-role');
  const pageInfo = root.querySelector('#pageInfo');
  const btnPrev  = root.querySelector('#btnPrev');
  const btnNext  = root.querySelector('#btnNext');
  let sort = { key: 'login', dir: 'asc' };

  function paintHeader() {
    thead.innerHTML = `
      <tr>
        ${headerCell('#', 'id', sort)}
        ${headerCell('Login', 'login', sort)}
        ${headerCell('Role', 'role', sort)}
        ${headerCell('Status', 'is_active', sort)}
        ${headerCell('Created', 'created_at', sort)}
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
    const opts = { q, offset, limit: PAGE_SIZE };
    if (roleFilter) opts.role = roleFilter;

    const r = await window.kaupangr.users.list(opts);
    if (!r.ok) { tbody.innerHTML = `<tr><td colspan="6" class="err">${r.error.message}</td></tr>`; return; }
    const rows = r.data.rows;
    total = r.data.total;

    if (rows.length === 0) {
      tbody.innerHTML = emptyState(6, q || roleFilter ? t('common.noResults') : t('users.emptyTitle'),
        q || roleFilter ? t('inventory.noMatchHint') : t('users.emptyHint'));
    } else {
      const sorted = sortRows(rows, sort.key, sort.dir);
      tbody.innerHTML = sorted.map(u => `
        <tr class="${u.is_active ? '' : 'inactive'}">
          <td>${u.id}</td>
          <td>${esc(u.login)}</td>
          <td>${esc(u.role)}</td>
          <td>${u.is_active ? 'active' : 'inactive'}</td>
          <td>${esc(u.created_at)}</td>
          <td>
            <button class="ghost" data-edit="${u.id}">${t('common.edit')}</button>
            <button class="ghost ${u.is_active ? 'danger' : ''}" data-toggle="${u.id}">
              ${u.is_active ? t('common.deactivate') : t('common.activate')}
            </button>
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
              title: `Deactivate ${row.login}?`,
              body: 'This user will no longer be able to sign in. Existing data is unaffected.',
              okText: t('common.deactivate'),
              danger: true,
            });
            if (!ok) return;
          }
          const res = await window.kaupangr.users.setActive(id, !row.is_active);
          if (!res.ok) { alert(res.error.message); return; }
          load();
        }));
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

  roleSel.addEventListener('change', () => {
    roleFilter = roleSel.value;
    offset = 0;
    load();
  });

  btnPrev.addEventListener('click', () => { offset = Math.max(0, offset - PAGE_SIZE); load(); });
  btnNext.addEventListener('click', () => { offset += PAGE_SIZE; load(); });

  root.querySelector('#btnNew').addEventListener('click', () => openForm(null));

  function openForm(u) {
    const dlg = root.querySelector('#dlg');
    const isEdit = !!u;
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${isEdit ? t('users.edit', { login: u.login }) : t('users.newTitle')}</h3>

        <div class="dialog-body">
          <div class="form-row">
            <label>${t('users.login')}</label>
            <input id="f-login" value="${isEdit ? esc(u.login) : ''}" />
          </div>
          <div class="form-row">
            <label>${t('users.role')}</label>
            <select id="f-role-form">
              ${ROLES.map(r => `<option value="${r}" ${isEdit && u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <label>${isEdit ? t('users.newPassword') : t('users.password')}</label>
            <input id="f-password" type="password" autocomplete="new-password" />
          </div>
          <div class="err" id="f-err"></div>
        </div>

        <menu>
          <button class="ghost" value="cancel" formnovalidate>${t('common.cancel')}</button>
          <button class="primary" value="save">${t('common.save')}</button>
        </menu>
      </form>`;
    dlg.showModal();
    dlg.querySelector('#f-login').focus();

    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'save') return;
      e.preventDefault();
      const login = dlg.querySelector('#f-login').value.trim();
      const role = dlg.querySelector('#f-role-form').value;
      const password = dlg.querySelector('#f-password').value;
      const errEl = dlg.querySelector('#f-err');

      let r;
      if (isEdit) {
        const patch = { login, role };
        if (password) patch.password = password;
        r = await window.kaupangr.users.update(u.id, patch);
      } else {
        if (!password) { errEl.textContent = 'Password is required.'; return; }
        r = await window.kaupangr.users.create({ login, password, role });
      }

      if (!r.ok) { errEl.textContent = r.error.message; return; }
      dlg.close();
      load();
    });
  }

  load();
}
