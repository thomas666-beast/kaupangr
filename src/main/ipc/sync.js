import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import { listPending, markSynced, pendingCount, lastSyncedAt } from '../services/sync-queue.js';
import { getSyncSettings, updateSyncSettings } from '../services/settings.js';
import { syncNow } from '../services/sync-engine.js';

export function registerSyncIpc() {
  ipcMain.handle('sync:pending',    wrap(() => listPending()));
  ipcMain.handle('sync:markSynced', wrap((ids) => markSynced(ids)));
  ipcMain.handle('sync:status',     wrap(() => ({
    pendingCount: pendingCount(),
    lastSyncedAt: lastSyncedAt(),
  })));
  ipcMain.handle('sync:now',        wrap(() => syncNow()));
  ipcMain.handle('settings:get',    wrap(() => getSyncSettings()));
  ipcMain.handle('settings:update', wrap((patch) => updateSyncSettings(patch)));
}
