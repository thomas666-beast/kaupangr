import { getState } from '../state/store.js';
import { refreshSyncDot } from '../state/sync-dot.js';
import { esc } from '../esc.js';
import { confirmAction } from '../confirm.js';
import { t, availableLanguages } from '../i18n/index.js';
import { changeLanguage } from '../state/language.js';

const MAX_REJECTIONS_SHOWN = 3;

export async function renderSettings(root) {
  const user = getState().user;
  if (user?.role !== 'administrator') {
    root.innerHTML = `<p class="err">${t('settings.adminOnly')}</p>`;
    return;
  }

  const [rs, rstat] = await Promise.all([
    window.kaupangr.settings.get(),
    window.kaupangr.sync.status(),
  ]);
  if (!rs.ok) { root.innerHTML = `<p class="err">${rs.error.message}</p>`; return; }
  const s = rs.data;
  const stat = rstat.ok ? rstat.data : { pendingCount: 0, lastSyncedAt: null };

  root.innerHTML = `
    <div class="pageheader">
      <h2>${t('settings.title')}</h2>
    </div>

    <div class="datatable" style="padding:24px;overflow:auto">
      <h3 style="margin-top:0">${t('settings.syncHeader')}</h3>

      <div class="form-row" style="max-width:520px">
        <label>${t('settings.serverUrl')}</label>
        <input id="f-url" placeholder="http://localhost:3000" value="${esc(s.server_url)}" />
      </div>
      <div class="form-row">
        <label style="display:flex;align-items:center;gap:.5rem">
          <input id="f-enabled" type="checkbox" ${s.sync_enabled ? 'checked' : ''} style="width:auto;height:auto" />
          ${t('settings.enableSync')}
        </label>
      </div>
      <div class="form-row" style="max-width:240px">
        <label>${t('settings.pushChunk')}</label>
        <input id="f-chunk" type="number" min="10" max="1000" step="10" value="${s.sync_push_chunk}" />
      </div>
      <div class="form-row" style="max-width:240px">
        <label>${t('settings.pullChunk')}</label>
        <input id="f-pull-chunk" type="number" min="10" max="1000" step="10" value="${s.sync_pull_chunk}" />
      </div>
      <div class="toolbar" style="max-width:520px">
        <button class="primary" id="btnSave">${t('settings.save')}</button>
        <button class="ghost" id="btnSync" ${s.server_url ? '' : 'disabled'}>${t('settings.syncNow')}</button>
      </div>
      <div class="err" id="err"></div>
      <div class="ok"  id="ok"></div>
      <div class="err" id="details" style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px"></div>

      <h3 style="margin-top:32px">${t('settings.statusHeader')}</h3>
      <table style="max-width:520px">
        <tbody>
          <tr><th style="text-align:left;padding:8px 0;color:var(--text-muted)">${t('settings.pendingOutbox')}</th>
              <td id="stat-pending" style="padding:8px 0">${stat.pendingCount}</td></tr>
          <tr><th style="text-align:left;padding:8px 0;color:var(--text-muted)">${t('settings.lastPush')}</th>
              <td id="stat-last" style="padding:8px 0">${stat.lastSyncedAt ? esc(stat.lastSyncedAt) : '—'}</td></tr>
        </tbody>
      </table>

      <h3 style="margin-top:32px">${t('settings.languageHeader')}</h3>
      <div class="form-row" style="max-width:240px">
        <label>${t('settings.languageLabel')}</label>
        <select id="f-lang">
          ${availableLanguages().map(l => `<option value="${l.code}">${l.label}</option>`).join('')}
        </select>
      </div>

      <h3 style="margin-top:32px">${t('settings.demoHeader')}</h3>
      <div class="toolbar">
        <button class="ghost" id="btnDemoReset">${t('settings.demoReset')}</button>
        <button class="ghost danger" id="btnDemoDisable">${t('settings.demoDisable')}</button>
      </div>
      <div class="ok" id="demo-ok"></div>

      <h3 style="margin-top:32px">${t('settings.apiHeader')}</h3>
      <pre class="api">POST /sync/push
Body: { "items": [ { "id": 12, "entity": "sale", "entity_id": 5,
                     "op": "upsert", "payload": {...}, "created_at": "..." } ] }
Resp: { "accepted": [12, 13], "rejected": [] }

GET /sync/pull?since=&lt;iso8601&gt;&limit=&lt;n&gt;
Resp: { "items": [ ... ], "since": "&lt;iso8601&gt;", "hasMore": &lt;bool&gt;, "nextSince": "&lt;iso8601|null&gt;" }</pre>
    </div>
  `;

  const btnSync  = root.querySelector('#btnSync');
  const errEl    = root.querySelector('#err');
  const okEl     = root.querySelector('#ok');
  const detailEl = root.querySelector('#details');

  // ---- Language selector ----
  const langSel = root.querySelector('#f-lang');
  try {
    const r = await window.kaupangr.ui.getLanguage();
    if (r.ok && r.data?.code) langSel.value = r.data.code;
  } catch { /* ignore */ }
  langSel.addEventListener('change', async () => {
    await changeLanguage(langSel.value);
  });

  // ---- Save sync settings ----
  root.querySelector('#btnSave').addEventListener('click', async () => {
    errEl.textContent = '';
    okEl.textContent = '';
    detailEl.textContent = '';
    const url = root.querySelector('#f-url').value.trim();
    const enabled = root.querySelector('#f-enabled').checked;
    const pushChunk = Number.parseInt(root.querySelector('#f-chunk').value, 10);
    const pullChunk = Number.parseInt(root.querySelector('#f-pull-chunk').value, 10);
    const r = await window.kaupangr.settings.update({
      server_url: url,
      sync_enabled: enabled,
      sync_push_chunk: pushChunk,
      sync_pull_chunk: pullChunk,
    });
    if (!r.ok) { errEl.textContent = r.error.message; return; }
    okEl.textContent = t('settings.saved');
    btnSync.disabled = !url;
    refreshSyncDot();
  });

  // ---- Sync now ----
  btnSync.addEventListener('click', async () => {
    errEl.textContent = '';
    okEl.textContent = t('settings.syncing');
    detailEl.textContent = '';
    btnSync.disabled = true;

    const r = await window.kaupangr.sync.now();
    btnSync.disabled = false;

    if (!r.ok) { okEl.textContent = ''; errEl.textContent = r.error.message; return; }

    const { push, pull } = r.data;
    const lines = [];

    if (push.ok) {
      lines.push(
        push.pushed === 0
          ? t('settings.pushNothing')
          : t('settings.pushSummary', {
              pushed: push.pushed,
              accepted: push.accepted,
              rejected: push.rejected.length,
            })
      );
    } else {
      lines.push(t('settings.pushFailed', { code: push.code, message: push.message }));
    }

    if (pull.ok) {
      lines.push(
        pull.applied === 0 && pull.skipped === 0
          ? t('settings.pullNothing')
          : t('settings.pullSummary', {
              applied: pull.applied,
              skipped: pull.skipped,
              errors: pull.errors.length,
            })
      );
    } else {
      lines.push(t('settings.pullFailed', { code: pull.code, message: pull.message }));
    }

    okEl.textContent = lines.join(' · ');

    const rejected = push.ok ? push.rejected : [];
    if (rejected.length > 0) {
      const shown = rejected.slice(0, MAX_REJECTIONS_SHOWN);
      const hiddenCount = rejected.length - shown.length;
      const previewLines = shown.map(x => `id ${x.id}: ${x.reason}`);
      if (hiddenCount > 0) previewLines.push(t('settings.andNMore', { n: hiddenCount }));
      detailEl.textContent = previewLines.join('\n');
    }

    const rstat2 = await window.kaupangr.sync.status();
    if (rstat2.ok) {
      root.querySelector('#stat-pending').textContent = rstat2.data.pendingCount;
      root.querySelector('#stat-last').textContent = rstat2.data.lastSyncedAt || '—';
    }

    refreshSyncDot();
  });

  // ---- Demo buttons ----
  const demoOk = root.querySelector('#demo-ok');

  root.querySelector('#btnDemoReset').addEventListener('click', async () => {
    demoOk.textContent = '';
    const ok = await confirmAction({
      title: t('settings.demoResetConfirmTitle'),
      body: t('settings.demoResetConfirmBody'),
      okText: t('settings.demoResetOk'),
    });
    if (!ok) return;
    const r = await window.kaupangr.demo?.resetFlags?.() ?? { ok: false, error: { message: 'not available' } };
    if (!r.ok) { demoOk.style.color = 'var(--danger)'; demoOk.textContent = r.error.message; return; }
    demoOk.style.color = 'var(--success)';
    demoOk.textContent = t('settings.demoResetDone');
  });

  root.querySelector('#btnDemoDisable').addEventListener('click', async () => {
    demoOk.textContent = '';
    const ok = await confirmAction({
      title: t('settings.demoDisableConfirmTitle'),
      body: t('settings.demoDisableConfirmBody'),
      okText: t('settings.demoDisableOk'),
      danger: true,
    });
    if (!ok) return;
    const r = await window.kaupangr.demo?.disableSeeding?.() ?? { ok: false, error: { message: 'not available' } };
    if (!r.ok) { demoOk.style.color = 'var(--danger)'; demoOk.textContent = r.error.message; return; }
    demoOk.style.color = 'var(--success)';
    demoOk.textContent = t('settings.demoDisableDone');
  });
}
