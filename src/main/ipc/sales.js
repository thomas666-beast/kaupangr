import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import { createSale, listSales, getSale } from '../services/sales.js';

export function registerSalesIpc() {
  ipcMain.handle('sales:list',   wrap((opts) => listSales(opts)));
  ipcMain.handle('sales:get',    wrap((id)   => getSale(id)));
  ipcMain.handle('sales:create', wrap((d)    => createSale(d)));
}
