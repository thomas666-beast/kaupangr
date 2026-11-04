import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import {
  listSuppliers, createSupplier, updateSupplier, setSupplierActive,
} from '../services/suppliers.js';

export function registerSuppliersIpc() {
  ipcMain.handle('suppliers:list',      wrap((opts) => listSuppliers(opts)));
  ipcMain.handle('suppliers:create',    wrap((d) => createSupplier(d)));
  ipcMain.handle('suppliers:update',    wrap((id, p) => updateSupplier(id, p)));
  ipcMain.handle('suppliers:setActive', wrap((id, b) => setSupplierActive(id, b)));
}
