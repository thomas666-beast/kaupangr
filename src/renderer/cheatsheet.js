import { t } from './i18n/index.js';
const SECTIONS = [
  { title: t('tabs.pos'), items: [
    ['/', t('cheatsheet.focusBarcode')],
    ['Enter', t('cheatsheet.enterLookup')],
    ['F2', t('cheatsheet.f2Charge')],
    ['Esc', t('cheatsheet.escClear')],
  ]},
  { title: t('cheatsheet.globalSection'), items: [
    ['?', t('cheatsheet.qHelp')],
    ['Ctrl+Shift+I', t('cheatsheet.devtools')],
  ]},
];

let open = false;

export function toggleCheatsheet() {
  if (open) return;
  open = true;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `
    <form method="dialog" style="min-width:420px">
      <h3>Keyboard shortcuts</h3>
      ${SECTIONS.map(s => `
        <h4 style="margin:.8rem 0 .3rem;font-size:.9rem">${s.title}</h4>
        <table style="width:100%">${s.items.map(([k, d]) => `
          <tr><td style="width:120px"><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('')}
        </table>`).join('')}
      <menu style="display:flex;justify-content:flex-end">
        <button class="primary" value="ok">Close</button>
      </menu>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { open = false; dlg.remove(); });
  dlg.showModal();
}
