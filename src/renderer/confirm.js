import { t } from './i18n/index.js';

/**
 * Show a modal confirmation dialog.
 * Returns a Promise that resolves to true (confirm) or false (cancel).
 */
export function confirmAction({ title, body, okText, danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <form method="dialog">
        <h3>${escapeHtml(title ?? t('common.confirm'))}</h3>

        <div class="dialog-body">
          <p>${escapeHtml(body ?? '')}</p>
        </div>

        <menu>
          <button class="ghost" value="cancel" formnovalidate>${escapeHtml(t('common.cancel'))}</button>
          <button class="${danger ? 'ghost danger' : 'primary'}" value="ok">${escapeHtml(okText ?? t('common.confirm'))}</button>
        </menu>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    dlg.showModal();
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
