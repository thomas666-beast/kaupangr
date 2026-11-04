import { getState } from './store.js';

/**
 * Refresh the small sync-state dot in the topbar.
 * Safe to call any time; no-ops if not signed in or the element is missing.
 */
export async function refreshSyncDot() {
  const dot = document.getElementById('syncDot');
  if (!dot) return;

  const user = getState().user;
  if (!user) { dot.hidden = true; return; }

  const rstat = await window.kaupangr.sync.status();
  if (!rstat.ok) { dot.hidden = true; return; }

  let enabled = true;
  if (user.role === 'administrator') {
    const rset = await window.kaupangr.settings.get();
    if (rset.ok) enabled = rset.data.sync_enabled;
  }

  dot.hidden = false;
  if (!enabled) {
    dot.className = 'sync-dot disabled';
    dot.title = 'Sync disabled';
  } else if (rstat.data.pendingCount > 0) {
    dot.className = 'sync-dot pending';
    dot.title = `${rstat.data.pendingCount} item(s) pending sync`;
  } else {
    dot.className = 'sync-dot';
    dot.title = 'All synced';
  }
}
