#!/usr/bin/env node
//
// i18n wrap codemod. Targeted. Safe. File-by-file.
//
// Usage:
//   node scripts/i18n-wrap.mjs <file> --dry
//   node scripts/i18n-wrap.mjs <file> --apply
//
// <file> is a path relative to src/renderer (e.g. views/stores.js, cheatsheet.js).
// The mapping is transcribed from src/renderer/i18n/en.js.
// The script ONLY replaces whole JS string literals and NEVER touches a
// string that's already inside t('...') or t("...").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

const [, , relArg, modeArg] = process.argv;
if (!relArg || !modeArg || (modeArg !== '--dry' && modeArg !== '--apply')) {
  console.error('usage: node scripts/i18n-wrap.mjs <file> [--dry|--apply]');
  process.exit(1);
}
const DRY = modeArg === '--dry';
const rel = relArg.replace(/^src\/renderer\//, '');
const absPath = path.join(RENDERER, rel);

// ------------------------------------------------------------------
// Literal → key. Only whole-literal matches. Multi-word strings that
// include template interpolation are NOT in this map — those need to
// be hand-wrapped once.
// ------------------------------------------------------------------
const MAP = new Map([
  // common
  ['Save', 'common.save'], ['Cancel', 'common.cancel'], ['Close', 'common.close'],
  ['Confirm', 'common.confirm'], ['Edit', 'common.edit'], ['Delete', 'common.delete'],
  ['Deactivate', 'common.deactivate'], ['Activate', 'common.activate'],
  ['New', 'common.new'], ['Loading…', 'common.loading'],
  ['No matches', 'common.noResults'], ['Refresh', 'common.refresh'],
  ['Export CSV', 'common.exportCsv'], ['← Prev', 'common.prev'], ['Next →', 'common.next'],
  ['no results', 'common.noResultsLower'],

  // topbar
  ['Sign out', 'topbar.signOut'],
  ['All synced', 'topbar.syncGreen'],
  ['Sync disabled', 'topbar.syncDisabled'],

  // tabs (used by renderer.js, cheatsheet.js)
  ['POS', 'tabs.pos'], ['Sales', 'tabs.sales'], ['Returns', 'tabs.returns'],
  ['Reports', 'tabs.reports'], ['Products', 'tabs.products'],
  ['Inventory', 'tabs.inventory'], ['Suppliers', 'tabs.suppliers'],
  ['Stores', 'tabs.stores'], ['Users', 'tabs.users'], ['Settings', 'tabs.settings'],

  // stores
  ['+ New store', 'stores.new'], ['Edit store', 'stores.edit'],
  ['No stores yet', 'stores.emptyTitle'],
  ['Create a store before making sales.', 'stores.emptyHint'],

  // suppliers
  ['+ New supplier', 'suppliers.new'], ['Edit supplier', 'suppliers.edit'],
  ['No suppliers yet', 'suppliers.emptyTitle'],
  ['Add suppliers to link them to products.', 'suppliers.emptyHint'],

  // users
  ['+ New user', 'users.new'], ['Role', 'users.role'],
  ['New password (leave blank to keep)', 'users.newPassword'],
  ['No users', 'users.emptyTitle'], ['Add the first user.', 'users.emptyHint'],
  ['administrator', 'users.roleAdmin'],
  ['product_manager', 'users.rolePM'],
  ['seller', 'users.roleSeller'],

  // sales
  ['+ New sale', 'sales.new'], ['New sale', 'sales.newTitle'],
  ['Lines', 'sales.lines'], ['+ Add line', 'sales.addLine'],
  ['Save sale', 'sales.saveSale'],
  ['View', 'sales.view'], ['Return', 'sales.return'],
  ['Save return', 'sales.saveReturn'],
  ['No sales yet', 'sales.emptyTitle'],
  ['Go to POS, scan a barcode, press F2.', 'sales.emptyHint'],
  ['Create a store first.', 'sales.createStoreFirst'],
  ['Create a product first.', 'sales.createProductFirst'],
  ['Nothing to export.', 'sales.nothingToExport'],

  // returns
  ['Returns are created from the Sales screen (open a sale → Return).', 'returns.subtitle'],
  ['No returns yet', 'returns.emptyTitle'],
  ['Returns are created from a sale.', 'returns.emptyHint'],

  // inventory
  ['All products', 'inventory.allProducts'],
  ['All stores', 'inventory.allStores'],
  ['All kinds', 'inventory.allKinds'],
  ['purchase', 'inventory.kindPurchase'],
  ['sale', 'inventory.kindSale'],
  ['return', 'inventory.kindReturn'],
  ['adjust', 'inventory.kindAdjust'],
  ['+ Add purchase / adjustment', 'inventory.new'],
  ['No movements', 'inventory.emptyTitle'],
  ['Sales, returns, purchases, and adjustments appear here.', 'inventory.emptyHint'],
  ['Try different filters.', 'inventory.noMatchHint'],
  ['Add stock movement', 'inventory.addTitle'],
  ['purchase (stock in)', 'inventory.kindPurchaseLabel'],
  ['adjust (correction / loss)', 'inventory.kindAdjustLabel'],
  ['Direction', 'inventory.direction'],
  ['+ Add stock', 'inventory.dirAdd'],
  ['− Remove stock', 'inventory.dirRemove'],
  ['Quantity (positive number)', 'inventory.quantity'],
  ['Note (optional)', 'inventory.note'],
  ['Quantity must be a positive integer.', 'inventory.quantityPositive'],

  // reports
  ['Quick range:', 'reports.quickRange'],
  ['Today', 'reports.today'],
  ['Last 7 days', 'reports.last7'],
  ['Last 30 days', 'reports.last30'],
  ['All time', 'reports.allTime'],
  ['From', 'reports.from'], ['To', 'reports.to'],
  ['By day', 'reports.byDay'],
  ['By store', 'reports.byStore'],
  ['By seller', 'reports.bySeller'],
  ['Sales total', 'reports.colSalesTotal'],
  ['Returns total', 'reports.colReturnsTotal'],
  ['Net', 'reports.colNet'],
  ['No activity in this range.', 'reports.noActivity'],

  // settings
  ['Server URL', 'settings.serverUrl'],
  ['Enable synchronization', 'settings.enableSync'],
  ['Push chunk size (items per request)', 'settings.pushChunk'],
  ['Pull chunk size (items per response)', 'settings.pullChunk'],
  ['Sync now', 'settings.syncNow'],
  ['Syncing…', 'settings.syncing'],
  ['Saved.', 'settings.saved'],
  ['Pending outbox', 'settings.pendingOutbox'],
  ['Last successful push', 'settings.lastPush'],
  ['Push: nothing to send.', 'settings.pushNothing'],
  ['Pull: nothing new.', 'settings.pullNothing'],
  ['API contract', 'settings.apiHeader'],
  ['Interface language', 'settings.languageLabel'],
  ['Settings are only available to administrators.', 'settings.adminOnly'],
  ['Demo data', 'settings.demoHeader'],
  ['Reset demo data (next start)', 'settings.demoReset'],
  ['Never seed again', 'settings.demoDisable'],
  ['Reset demo flags?', 'settings.demoResetConfirmTitle'],
  ['Reset flags', 'settings.demoResetOk'],
  ['Flags cleared. Restart Kaupangr to reseed.', 'settings.demoResetDone'],
  ['Never seed demo data again?', 'settings.demoDisableConfirmTitle'],
  ['Disable seeding', 'settings.demoDisableOk'],
  ['Seeding disabled.', 'settings.demoDisableDone'],

  // cheatsheet
  ['Keyboard shortcuts', 'cheatsheet.title'],
  ['Focus barcode input', 'cheatsheet.focusBarcode'],
  ['Look up SKU / add to cart', 'cheatsheet.enterLookup'],
  ['Charge (save sale)', 'cheatsheet.f2Charge'],
  ['Clear cart', 'cheatsheet.escClear'],
  ['Show this help', 'cheatsheet.qHelp'],
  ['DevTools', 'cheatsheet.devtools'],
  ['Global', 'cheatsheet.globalSection'],

  // status line shared with sync-dot.js — hand-wrapped in that file.
]);

const LITERALS = [...MAP.entries()].sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (!fs.existsSync(absPath)) {
  console.error(`not found: ${absPath}`);
  process.exit(1);
}

let src = fs.readFileSync(absPath, 'utf8');
const original = src;
let replaced = 0;

for (const [literal, key] of LITERALS) {
  if (src.includes(`t('${key}'`) || src.includes(`t("${key}"`)) continue;

  const lit = escapeRegExp(literal);
  const re1 = new RegExp(`(?<![\\w$])'${lit}'(?![\\w$])`, 'g');
  const re2 = new RegExp(`(?<![\\w$])"${lit}"(?![\\w$])`, 'g');
  const re3 = new RegExp('(?<![\\w$])`' + lit + '`(?![\\w$])', 'g');

  const before = src;
  src = src.replace(re1, `t('${key}')`);
  src = src.replace(re2, `t('${key}')`);
  src = src.replace(re3, `t('${key}')`);
  if (src !== before) replaced++;
}

if (src === original) {
  console.log(`no changes for ${rel}`);
  process.exit(0);
}

// Add the import if missing.
if (!src.includes("from '../i18n/index.js'") && !src.includes("from './i18n/index.js'")) {
  const isRootLevel = !rel.includes('/');
  const importPath = isRootLevel ? './i18n/index.js' : '../i18n/index.js';
  const importLine = `import { t } from '${importPath}';`;
  const lines = src.split('\n');
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) insertAt = i + 1;
    else if (lines[i].trim() && !/^\s*\/\//.test(lines[i]) && insertAt > 0) break;
  }
  lines.splice(insertAt, 0, importLine);
  src = lines.join('\n');
}

if (DRY) {
  console.log(`--- ${rel} (${replaced} literal(s) replaced — DRY RUN)`);
  const b = original.split('\n');
  const a = src.split('\n');
  const max = Math.max(b.length, a.length);
  for (let i = 0; i < max; i++) {
    if (b[i] !== a[i]) {
      if (b[i] !== undefined) console.log(`  - ${b[i]}`);
      if (a[i] !== undefined)  console.log(`  + ${a[i]}`);
    }
  }
} else {
  fs.writeFileSync(absPath, src, 'utf8');
  console.log(`✓ ${rel}: ${replaced} literal(s) replaced`);
}
