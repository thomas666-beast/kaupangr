import { contextBridge, ipcRenderer } from 'electron';

const inv = (channel, ...a) => ipcRenderer.invoke(channel, ...a);

contextBridge.exposeInMainWorld('kaupangr', {
  version: '0.1.0',

  auth: {
    login:  (l, p) => inv('auth:login', l, p),
    logout: ()     => inv('auth:logout'),
    whoami: ()     => inv('auth:whoami'),
  },

  stores: {
    list:      (opts)      => inv('stores:list', opts),
    create:    (data)      => inv('stores:create', data),
    update:    (id, patch) => inv('stores:update', id, patch),
    setActive: (id, b)     => inv('stores:setActive', id, b),
  },

  suppliers: {
    list:      (opts)      => inv('suppliers:list', opts),
    create:    (data)      => inv('suppliers:create', data),
    update:    (id, patch) => inv('suppliers:update', id, patch),
    setActive: (id, b)     => inv('suppliers:setActive', id, b),
  },

  products: {
    list:      (opts)      => inv('products:list', opts),
    create:    (data)      => inv('products:create', data),
    update:    (id, patch) => inv('products:update', id, patch),
    setActive: (id, b)     => inv('products:setActive', id, b),
    findBySku: (sku)       => inv('products:findBySku', sku),
    search:    (q)         => inv('products:search', q),
    importCsv: (csvText)   => inv('products:importCsv', csvText),
    bulkPreview: (opts)    => inv('products:bulkPreview', opts),
    bulkApply:   (opts)    => inv('products:bulkApply', opts),
  },

  sales: {
    list:   (opts) => inv('sales:list', opts),
    get:    (id)   => inv('sales:get', id),
    create: (data) => inv('sales:create', data),
  },

  returns: {
    create:     (data) => inv('returns:create', data),
    listBySale: (id)   => inv('returns:listBySale', id),
    listAll:    (opts) => inv('returns:listAll', opts),
    get:        (id)   => inv('returns:get', id),
  },

  sync: {
    pending:    ()    => inv('sync:pending'),
    markSynced: (ids) => inv('sync:markSynced', ids),
    status:     ()    => inv('sync:status'),
    now:        ()    => inv('sync:now'),
  },

  settings: {
    get:    ()      => inv('settings:get'),
    update: (patch) => inv('settings:update', patch),
  },

  users: {
    list:      (opts)      => inv('users:list', opts),
    create:    (data)      => inv('users:create', data),
    update:    (id, patch) => inv('users:update', id, patch),
    setActive: (id, b)     => inv('users:setActive', id, b),
  },

  stock: {
    onHand:        (productId, storeId)  => inv('stock:onHand', productId, storeId),
    onHandBulk:    (productIds, storeId) => inv('stock:onHandBulk', productIds, storeId),
    listMovements: (opts)                => inv('stock:listMovements', opts),
    addMovement:   (data)                => inv('stock:addMovement', data),
    lowStock:      (opts)                => inv('stock:lowStock', opts),
  },

  reports: {
    salesByDay:     (opts) => inv('reports:salesByDay', opts),
    salesByStore:   (opts) => inv('reports:salesByStore', opts),
    salesBySeller:  (opts) => inv('reports:salesBySeller', opts),
    salesByProduct: (opts) => inv('reports:salesByProduct', opts),
    hourlyHeatmap:  (opts) => inv('reports:hourlyHeatmap', opts),
  },

  exports: {
    save: (payload) => inv('exports:save', payload),
  },

  receipts: {
    print: (saleId) => inv('receipts:print', saleId),
  },

  ui: {
    getLanguage: ()     => inv('ui:getLanguage'),
    setLanguage: (code) => inv('ui:setLanguage', code),
  },
});
