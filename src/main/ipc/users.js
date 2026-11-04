import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import {
  listUsers, createUser, updateUser, setActive,
} from '../services/users.js';

export function registerUsersIpc() {
  ipcMain.handle('users:list',      wrap((opts) => listUsers(opts)));
  ipcMain.handle('users:create',    wrap((d) => createUser(d)));
  ipcMain.handle('users:update',    wrap((id, patch) => updateUser(id, patch)));
  ipcMain.handle('users:setActive', wrap((id, b) => setActive(id, b)));
}
