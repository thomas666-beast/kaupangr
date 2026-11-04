import { ipcMain, BrowserWindow } from 'electron';
import { wrap } from './wrap.js';
import { buildReceiptHtml } from '../services/receipts.js';

/**
 * Print a receipt to the OS default printer.
 * Opens a hidden BrowserWindow, loads the receipt HTML, calls print(),
 * then closes the window. Never opens a dialog — the OS printer (or its
 * default dialog) handles the rest.
 */
async function printReceiptHtml(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((resolve, reject) => {
      win.webContents.print(
        { silent: true, printBackground: true, margins: { marginType: 'default' } },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'print failed'));
        }
      );
    });
    return { printed: true };
  } finally {
    win.destroy();
  }
}

export function registerReceiptsIpc() {
  ipcMain.handle('receipts:getHtml', wrap((saleId) => ({ html: buildReceiptHtml(saleId) })));
  ipcMain.handle('receipts:print',   wrap(async (saleId) => {
    const { html } = buildReceiptHtml(saleId);
    return printReceiptHtml(html);
  }));
}
