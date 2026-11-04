import { ipcMain } from 'electron';
import { wrap } from './wrap.js';
import {
  listProducts, createProduct, updateProduct, setProductActive,
  findBySku, searchProducts, bulkPricePreview, bulkPriceApply,
} from '../services/products.js';
import { importProductsCsv } from '../services/products-csv.js';

export function registerProductsIpc() {
  ipcMain.handle('products:list',          wrap((opts) => listProducts(opts)));
  ipcMain.handle('products:create',        wrap((d) => createProduct(d)));
  ipcMain.handle('products:update',        wrap((id, p) => updateProduct(id, p)));
  ipcMain.handle('products:setActive',     wrap((id, b) => setProductActive(id, b)));
  ipcMain.handle('products:findBySku',     wrap((sku) => findBySku(sku)));
  ipcMain.handle('products:search',        wrap((q) => searchProducts(q)));
  ipcMain.handle('products:importCsv',     wrap((csvText) => importProductsCsv(csvText)));
  ipcMain.handle('products:bulkPreview',   wrap((opts) => bulkPricePreview(opts)));
  ipcMain.handle('products:bulkApply',     wrap((opts) => bulkPriceApply(opts)));
}
