import { login } from '../state/session.js';
import { t } from '../i18n/index.js';

export function renderLogin(root) {
  root.innerHTML = `
    <div class="login-shell">
      <div class="login-card">
        <div class="logo">
          <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <!-- diamond/kite background -->
            <rect x="6" y="6" width="52" height="52" rx="14" fill="#b3472a"/>
            <!-- inner bag shape -->
            <path d="M22 26h20l-2 20H24l-2-20z" fill="#fbe9e2"/>
            <!-- handle -->
            <path d="M26 26v-3a6 6 0 0 1 12 0v3" fill="none" stroke="#fbe9e2" stroke-width="2.5" stroke-linecap="round"/>
            <!-- small K monogram inside the bag -->
            <path d="M31 34v8M31 38l4-4M31 38l4 4" fill="none" stroke="#b3472a" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div class="logo-text">
            <h1>${t('login.title')}</h1>
            <p>${t('login.subtitle')}</p>
          </div>
        </div>

        <form id="login-form">
          <div class="form-row">
            <label for="login">${t('login.username')}</label>
            <input id="login" name="login" type="text" autocomplete="username" autofocus />
          </div>
          <div class="form-row">
            <label for="password">${t('login.password')}</label>
            <input id="password" name="password" type="password" autocomplete="current-password" />
          </div>
          <button class="primary" id="btnLogin" type="submit">${t('login.submit')}</button>
          <div class="err" id="err"></div>
        </form>
      </div>
    </div>
  `;

  const form   = root.querySelector('#login-form');
  const errEl  = root.querySelector('#err');
  const btn    = root.querySelector('#btnLogin');

  const doLogin = async (e) => {
    if (e) e.preventDefault();
    errEl.textContent = '';
    btn.textContent = t('login.signingIn');
    btn.disabled = true;

    const r = await login(
      root.querySelector('#login').value,
      root.querySelector('#password').value
    );

    if (!r.ok) {
      btn.textContent = t('login.submit');
      btn.disabled = false;
      errEl.textContent = r.error.message;
    }
    // success triggers a state change → router re-renders
  };

  form.addEventListener('submit', doLogin);
  root.querySelector('#login').focus();
}
