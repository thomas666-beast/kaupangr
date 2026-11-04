import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import { getDb } from '../db/index.js';

function readLanguage() {
  const row = getDb().prepare(
    `SELECT value FROM app_meta WHERE key = 'ui_language'`
  ).get();
  return { code: row ? row.value : 'en' };
}

function writeLanguage(code) {
  if (typeof code !== 'string' || !code.trim())
    return { ok: false, error: 'bad code' };
  const value = code.trim().toLowerCase().slice(0, 8);
  getDb().prepare(
    `INSERT INTO app_meta (key, value) VALUES ('ui_language', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(value);
  return { code: value };
}

export function registerUiIpc() {
  ipcMain.handle('ui:getLanguage', wrap(() => readLanguage()));
  ipcMain.handle('ui:setLanguage', wrap((code) => writeLanguage(code)));
}
