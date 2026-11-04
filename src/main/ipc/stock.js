import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import { addMovement, onHand, onHandBulk, listMovements, lowStock } from '../services/stock.js';

export function registerStockIpc() {
  ipcMain.handle('stock:onHand',        wrap((productId, storeId) => onHand(productId, storeId)));
  ipcMain.handle('stock:onHandBulk',    wrap((productIds, storeId) => onHandBulk(productIds, storeId)));
  ipcMain.handle('stock:listMovements', wrap((opts) => listMovements(opts)));
  ipcMain.handle('stock:addMovement',   wrap((data) => addMovement(data)));
  ipcMain.handle('stock:lowStock',      wrap((opts) => lowStock(opts)));
}
