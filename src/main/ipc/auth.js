import { ipcMain } from 'electron';
import { login, logout, whoami } from '../services/auth.js';
import { wrap } from './wrap.js';

export function registerAuthIpc() {
  ipcMain.handle('auth:login',  wrap((l, p) => login(l, p)));
  ipcMain.handle('auth:logout', wrap(() => { logout(); return { ok: true }; }));
  ipcMain.handle('auth:whoami', wrap(() => whoami()));
}

