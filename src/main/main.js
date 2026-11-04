import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, setUserDataDirProvider } from './db/index.js';
import { ensureBootstrapAdmin } from './services/auth.js';
import { backfillIfNeeded } from './services/daily-totals.js';
import { readSyncSettingsForEngine } from './services/settings.js';
import { startAutoSync, stopAutoSync } from './services/auto-sync.js';
import { registerAuthIpc }      from './ipc/auth.js';
import { registerStoresIpc }    from './ipc/stores.js';
import { registerSuppliersIpc } from './ipc/suppliers.js';
import { registerProductsIpc }  from './ipc/products.js';
import { registerSalesIpc }     from './ipc/sales.js';
import { registerReturnsIpc }   from './ipc/returns.js';
import { registerSyncIpc }      from './ipc/sync.js';
import { registerUsersIpc }     from './ipc/users.js';
import { registerStockIpc }     from './ipc/stock.js';
import { registerReportsIpc }   from './ipc/reports.js';
import { registerExportsIpc }   from './ipc/exports.js';
import { registerUiIpc }        from './ipc/ui.js';
import { registerReceiptsIpc }  from './ipc/receipts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  setUserDataDirProvider(() => app.getPath('userData'));
  getDb();
  ensureBootstrapAdmin();

  // Populate daily_totals from existing sales/returns (one-time).
  try { backfillIfNeeded(); }
  catch (e) { console.error('[daily-totals] backfill failed:', e.message); }

  registerAuthIpc();
  registerStoresIpc();
  registerSuppliersIpc();
  registerProductsIpc();
  registerSalesIpc();
  registerReturnsIpc();
  registerSyncIpc();
  registerUsersIpc();
  registerStockIpc();
  registerReportsIpc();
  registerExportsIpc();
  registerUiIpc();
  registerReceiptsIpc();

  const s = readSyncSettingsForEngine();
  startAutoSync({ intervalSec: s.sync_interval_sec });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopAutoSync();
  closeDb();
});
