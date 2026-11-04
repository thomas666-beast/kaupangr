import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import { createReturn, listReturnsBySale, listAll, getReturn } from '../services/returns.js';

export function registerReturnsIpc() {
  ipcMain.handle('returns:create',     wrap((d)    => createReturn(d)));
  ipcMain.handle('returns:listBySale', wrap((id)   => listReturnsBySale(id)));
  ipcMain.handle('returns:listAll',    wrap((opts) => listAll(opts)));
  ipcMain.handle('returns:get',        wrap((id)   => getReturn(id)));
}
