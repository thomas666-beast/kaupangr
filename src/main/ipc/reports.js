import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import {
  salesByDay, salesByStore, salesBySeller, salesByProduct, hourlyHeatmap,
} from '../services/reports.js';

export function registerReportsIpc() {
  ipcMain.handle('reports:salesByDay',     wrap((opts) => salesByDay(opts)));
  ipcMain.handle('reports:salesByStore',   wrap((opts) => salesByStore(opts)));
  ipcMain.handle('reports:salesBySeller',  wrap((opts) => salesBySeller(opts)));
  ipcMain.handle('reports:salesByProduct', wrap((opts) => salesByProduct(opts)));
  ipcMain.handle('reports:hourlyHeatmap',  wrap((opts) => hourlyHeatmap(opts)));
}
