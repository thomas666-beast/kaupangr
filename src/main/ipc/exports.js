import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { wrap } from './wrap.js';

export function registerExportsIpc() {
  ipcMain.handle('exports:save', wrap(async ({ filename, content }) => {
    if (typeof filename !== 'string' || !filename) return { saved: false, reason: 'filename' };
    if (typeof content !== 'string') return { saved: false, reason: 'content' };

    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const res = await dialog.showSaveDialog(win, {
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return { saved: false, reason: 'cancelled' };

    await fs.writeFile(res.filePath, content, 'utf8');
    return { saved: true, path: res.filePath };
  }));
}
