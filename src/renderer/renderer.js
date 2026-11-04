import { getState, subscribe } from './state/store.js';
import { refreshSession, logout } from './state/session.js';
import { refreshSyncDot } from './state/sync-dot.js';
import { loadLanguage, onLanguageChange } from './state/language.js';
import { t } from './i18n/index.js';
import { renderLogin } from './views/login.js';
import { renderStores } from './views/stores.js';
import { renderSuppliers } from './views/suppliers.js';
import { renderProducts } from './views/products.js';
import { renderSales } from './views/sales.js';
import { renderReturns } from './views/returns.js';
import { renderPos } from './views/pos.js';
import { renderSettings } from './views/settings.js';
import { renderUsers } from './views/users.js';
import { renderInventory } from './views/inventory.js';
import { renderReports } from './views/reports.js';
import { renderRestock } from './views/restock.js';
import { toggleCheatsheet } from './cheatsheet.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const who = $('who');
const badge = $('roleBadge');
const btnLogout = $('btnLogout');

const TABS = [
  { key: 'pos',       labelKey: 'tabs.pos',       roles: ['administrator','product_manager','seller'], render: renderPos },
  { key: 'sales',     labelKey: 'tabs.sales',     roles: ['administrator','product_manager','seller'], render: renderSales },
  { key: 'returns',   labelKey: 'tabs.returns',   roles: ['administrator','product_manager','seller'], render: renderReturns },
  { key: 'reports',   labelKey: 'tabs.reports',   roles: ['administrator','product_manager','seller'], render: renderReports },
  { key: 'products',  labelKey: 'tabs.products',  roles: ['administrator','product_manager','seller'], render: renderProducts },
  { key: 'inventory', labelKey: 'tabs.inventory', roles: ['administrator','product_manager','seller'], render: renderInventory },
  { key: 'restock',   labelKey: 'Restock',        roles: ['administrator','product_manager'],           render: renderRestock },
  { key: 'suppliers', labelKey: 'tabs.suppliers', roles: ['administrator','product_manager','seller'], render: renderSuppliers },
  { key: 'stores',    labelKey: 'tabs.stores',    roles: ['administrator','product_manager','seller'], render: renderStores },
  { key: 'users',     labelKey: 'tabs.users',     roles: ['administrator'], render: renderUsers },
  { key: 'settings',  labelKey: 'tabs.settings',  roles: ['administrator'], render: renderSettings },
];

let activeTab = 'pos';
let lastUserId = null;

function paint() {
  const user = getState().user;

  if (!user) {
    who.textContent = '';
    badge.hidden = true;
    btnLogout.hidden = true;
    app.innerHTML = '';
    renderLogin(app);
    return;
  }

  if (lastUserId !== user.userId) {
    lastUserId = user.userId;
    activeTab = 'pos';
  }

  who.textContent = user.login;
  badge.textContent = user.role;
  badge.className = `role-badge ${user.role}`;
  badge.hidden = false;
  btnLogout.hidden = false;
  btnLogout.textContent = t('topbar.signOut');

  const tabs = TABS.filter(tb => tb.roles.includes(user.role));
  app.innerHTML = `
    <nav class="tabs">
      ${tabs.map(tb =>
        `<button data-tab="${tb.key}" class="${tb.key === activeTab ? 'active' : ''}">${t(tb.labelKey)}</button>`
      ).join('')}
    </nav>
    <div id="view"></div>
  `;
  app.querySelectorAll('[data-tab]').forEach(b =>
    b.addEventListener('click', () => { activeTab = b.dataset.tab; paint(); }));

  const current = tabs.find(tb => tb.key === activeTab);
  if (current) current.render($('view'));

  refreshSyncDot();
}

btnLogout.addEventListener('click', async () => { await logout(); });
subscribe(paint);

document.addEventListener('keydown', (e) => {
  const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if (e.key === '?' && !inField) {
    e.preventDefault();
    toggleCheatsheet();
  }
});

setInterval(() => { if (getState().user) refreshSyncDot(); }, 15000);

(async () => {
  await loadLanguage();
  onLanguageChange(() => paint());
  refreshSession();
})();
