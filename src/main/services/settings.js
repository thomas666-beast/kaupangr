import { getDb } from '../db/index.js';
import { requireSession } from './auth.js';

const DEFAULTS = {
  server_url: '',
  sync_enabled: '0',
  sync_auto: '1',
  sync_interval_sec: '300',
  sync_push_chunk: '100',
  sync_pull_chunk: '500',
};

function getMeta(key) {
  const row = getDb().prepare(`SELECT value FROM app_meta WHERE key = ?`).get(key);
  return row ? row.value : (DEFAULTS[key] ?? null);
}

function setMeta(key, value) {
  getDb().prepare(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function readSyncSettings() {
  const intervalRaw = Number.parseInt(getMeta('sync_interval_sec'), 10);
  const pushRaw     = Number.parseInt(getMeta('sync_push_chunk'), 10);
  const pullRaw     = Number.parseInt(getMeta('sync_pull_chunk'), 10);
  return {
    server_url: getMeta('server_url'),
    sync_enabled: getMeta('sync_enabled') === '1',
    sync_auto: getMeta('sync_auto') === '1',
    sync_interval_sec:
      Number.isFinite(intervalRaw) && intervalRaw >= 30 ? intervalRaw : 300,
    sync_push_chunk:
      Number.isFinite(pushRaw) && pushRaw >= 10 && pushRaw <= 1000 ? pushRaw : 100,
    sync_pull_chunk:
      Number.isFinite(pullRaw) && pullRaw >= 10 && pullRaw <= 1000 ? pullRaw : 500,
  };
}

// ---- admin-gated API (used by IPC / UI) ----
export function getSyncSettings() {
  requireSession('administrator');
  return readSyncSettings();
}

export function updateSyncSettings({
  server_url, sync_enabled, sync_auto, sync_interval_sec,
  sync_push_chunk, sync_pull_chunk,
}) {
  requireSession('administrator');
  if (server_url !== undefined) setMeta('server_url', String(server_url).trim());
  if (sync_enabled !== undefined) setMeta('sync_enabled', sync_enabled ? '1' : '0');
  if (sync_auto !== undefined) setMeta('sync_auto', sync_auto ? '1' : '0');
  if (sync_interval_sec !== undefined) {
    const n = Number.parseInt(sync_interval_sec, 10);
    if (Number.isFinite(n) && n >= 30) setMeta('sync_interval_sec', String(n));
  }
  if (sync_push_chunk !== undefined) {
    const n = Number.parseInt(sync_push_chunk, 10);
    if (Number.isFinite(n) && n >= 10 && n <= 1000) setMeta('sync_push_chunk', String(n));
  }
  if (sync_pull_chunk !== undefined) {
    const n = Number.parseInt(sync_pull_chunk, 10);
    if (Number.isFinite(n) && n >= 10 && n <= 1000) setMeta('sync_pull_chunk', String(n));
  }
  return readSyncSettings();
}

// ---- internal API (used by sync engine + auto-sync only, no session required) ----
export function readSyncSettingsForEngine() {
  return readSyncSettings();
}
