import { whoami } from './auth.js';
import { readSyncSettingsForEngine } from './settings.js';
import { syncNow } from './sync-engine.js';

let timer = null;
let inFlight = false;
let lastResult = null;

/**
 * Start the auto-sync timer. Idempotent — calling twice replaces the timer.
 *
 * @param {{ intervalSec?: number, onTick?: (r:object) => void }} [opts]
 */
export function startAutoSync(opts = {}) {
  stopAutoSync();
  const intervalMs = Math.max(30, Number(opts.intervalSec) || 300) * 1000;
  timer = setInterval(() => {
    runAutoSyncOnce(opts.onTick).catch(() => { /* swallow */ });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return intervalMs;
}

export function stopAutoSync() {
  if (timer) { clearInterval(timer); timer = null; }
}

/**
 * Decide whether this run should happen. Returns { ok:true } or
 * { ok:false, reason } — used by runAutoSyncOnce and by tests.
 */
export function canRunNow() {
  if (inFlight) return { ok: false, reason: 'in-flight' };
  const s = readSyncSettingsForEngine();
  if (!s.sync_enabled) return { ok: false, reason: 'sync-disabled' };
  if (!s.sync_auto)     return { ok: false, reason: 'auto-disabled' };
  if (!s.server_url)    return { ok: false, reason: 'no-url' };
  if (!whoami())        return { ok: false, reason: 'no-session' };
  return { ok: true };
}

/**
 * Run the auto-sync once. Never throws.
 *   { skipped: '<reason>' }                        — shouldRun() said no
 *   { ok: true,  push, pull }                      — syncNow() succeeded
 *   { ok: false, code, message, push?, pull? }     — syncNow() returned a failure
 */
export async function runAutoSyncOnce(onTick) {
  const can = canRunNow();
  if (!can.ok) return { skipped: can.reason };

  inFlight = true;
  try {
    const r = await syncNow();
    lastResult = {
      at: new Date().toISOString(),
      ok: !!(r.push?.ok && r.pull?.ok),
      push: r.push,
      pull: r.pull,
    };
    if (typeof onTick === 'function') {
      try { onTick(lastResult); } catch { /* listener error is not our problem */ }
    }
    return lastResult;
  } catch (e) {
    lastResult = {
      at: new Date().toISOString(),
      ok: false,
      code: 'EXCEPTION',
      message: e?.message || 'auto-sync exception',
    };
    if (typeof onTick === 'function') {
      try { onTick(lastResult); } catch { /* ignore */ }
    }
    return lastResult;
  } finally {
    inFlight = false;
  }
}

/** Read the last result (used by tests and, later, by a debug view). */
export function getLastAutoSyncResult() {
  return lastResult;
}

/** Test-only reset. */
export function _resetAutoSyncForTests() {
  stopAutoSync();
  inFlight = false;
  lastResult = null;
}
