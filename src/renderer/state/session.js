import { getState, setState } from './store.js';

export async function refreshSession() {
  const r = await window.kaupangr.auth.whoami();
  setState({ user: r.ok ? r.data : null });
}

export async function login(login, password) {
  const r = await window.kaupangr.auth.login(login, password);
  if (!r.ok) return r;
  await refreshSession();
  return r;
}

export async function logout() {
  const r = await window.kaupangr.auth.logout();
  await refreshSession();
  return r;
}
