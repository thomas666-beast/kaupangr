import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import {
  listStores, createStore, updateStore, setStoreActive,
} from '../services/stores.js';

export function registerStoresIpc() {
  ipcMain.handle('stores:list',      wrap((opts) => listStores(opts)));
  ipcMain.handle('stores:create',    wrap((d) => createStore(d)));
  ipcMain.handle('stores:update',    wrap((id, p) => updateStore(id, p)));
  ipcMain.handle('stores:setActive', wrap((id, b) => setStoreActive(id, b)));
}
