import { getDb } from '../db/index.js';
import { readSyncSettingsForEngine } from './settings.js';
import { listPending, markSynced } from './sync-queue.js';
import { pushItems, pullItems } from './http-client.js';
import { applyItem } from './apply.js';

const ENTITY_ORDER = ['store', 'supplier', 'product', 'stock_movement', 'sale', 'return'];
const ENTITY_RANK = Object.fromEntries(ENTITY_ORDER.map((e, i) => [e, i]));

const ABSOLUTE_MAX_PUSH_ITEMS = 100_000;
const ABSOLUTE_MAX_PULL_BATCHES = 500;

export async function syncNow(opts = {}) {
  const push = await pushNow(opts);
  const pull = await pullNow(opts);
  return { push, pull };
}

export async function pushNow(opts = {}) {
  const s = readSyncSettingsForEngine();
  if (!s.server_url) return { ok: false, code: 'NO_URL', message: 'server_url not set' };

  const chunkSize = Math.max(10, Math.min(1000, s.sync_push_chunk || 100));
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  let pushed = 0;
  let accepted = 0;
  const rejected = [];

  while (pushed < ABSOLUTE_MAX_PUSH_ITEMS) {
    const pending = listPending({ limit: chunkSize });
    if (pending.length === 0) break;

    const r = await pushItems(s.server_url, pending, opts);
    if (!r.ok) {
      return {
        ok: false, code: r.error.code, message: r.error.message,
        pushed, accepted, rejected,
      };
    }

    const acceptedIds = Array.isArray(r.data?.accepted) ? r.data.accepted : [];
    const rejectedChunk = Array.isArray(r.data?.rejected) ? r.data.rejected : [];

    if (acceptedIds.length > 0) markSynced(acceptedIds);

    pushed   += pending.length;
    accepted += acceptedIds.length;
    rejected.push(...rejectedChunk);

    if (onProgress) {
      try { onProgress({ pushed, accepted, rejected: rejected.length }); }
      catch { /* listener error is not our problem */ }
    }

    if (acceptedIds.length === 0) break;
  }

  return { ok: true, pushed, accepted, rejected };
}

export async function pullNow(opts = {}) {
  const s = readSyncSettingsForEngine();
  if (!s.server_url) return { ok: false, code: 'NO_URL', message: 'server_url not set' };

  const pullLimit = Math.max(10, Math.min(1000, s.sync_pull_chunk));

  let since = getLastPull();
  let applied = 0;
  let skipped = 0;
  const errors = [];
  let batches = 0;

  while (batches < ABSOLUTE_MAX_PULL_BATCHES) {
    batches++;
    const r = await pullItems(s.server_url, since, { ...opts, limit: pullLimit });
    if (!r.ok) {
      return {
        ok: false, code: r.error.code, message: r.error.message,
        applied, skipped, errors, since,
      };
    }

    const items = Array.isArray(r.data?.items) ? r.data.items : [];

    if (items.length > 0) {
      const ordered = [...items].sort(
        (a, b) => (ENTITY_RANK[a.entity] ?? 99) - (ENTITY_RANK[b.entity] ?? 99)
      );
      for (const item of ordered) {
        try {
          const res = applyItem(item);
          if (res.applied) applied++;
          else skipped++;
        } catch (e) {
          errors.push({ item, message: e?.message || 'apply failed' });
        }
      }
    }

    const hasMore = r.data?.hasMore === true;

    if (hasMore) {
      const next = r.data?.nextSince;
      if (!next || next === since) {
        errors.push({ item: null, message: 'server returned hasMore without a nextSince' });
        break;
      }
      since = next;
      continue;
    }

    const finalSince = r.data?.since ?? since;
    if (finalSince && finalSince !== getLastPull()) setLastPull(finalSince);
    return { ok: true, applied, skipped, errors, since: finalSince };
  }

  return {
    ok: true, applied, skipped, errors, since,
    aborted: 'batch-limit-reached',
  };
}

function getLastPull() {
  const row = getDb()
    .prepare(`SELECT value FROM app_meta WHERE key = 'sync_last_pull'`)
    .get();
  return row ? row.value : null;
}

function setLastPull(iso) {
  getDb().prepare(
    `INSERT INTO app_meta (key, value) VALUES ('sync_last_pull', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(iso);
}
