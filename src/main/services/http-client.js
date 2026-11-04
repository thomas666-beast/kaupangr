const DEFAULT_TIMEOUT_MS = 15000;

export async function pushItems(baseUrl, items, opts = {}) {
  const wireItems = items.map(it => ({
    id: it.id,
    entity: it.entity,
    entity_id: it.entity_id,
    op: it.op,
    created_at: it.created_at,
    payload: typeof it.payload === 'string' ? JSON.parse(it.payload) : it.payload,
  }));

  return request(baseUrl, '/sync/push', {
    method: 'POST',
    body: { items: wireItems },
    ...opts,
  });
}

export async function pullItems(baseUrl, since, opts = {}) {
  const parts = [];
  if (since) parts.push(`since=${encodeURIComponent(since)}`);
  if (Number.isFinite(opts.limit) && opts.limit > 0) parts.push(`limit=${Math.floor(opts.limit)}`);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  return request(baseUrl, `/sync/pull${qs}`, { method: 'GET', ...opts });
}

async function request(baseUrl, path, { method, body, fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = joinUrl(baseUrl, path);
  const doFetch = fetch || globalThis.fetch;
  if (typeof doFetch !== 'function')
    return fail('NO_FETCH', 'fetch is not available');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await doFetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') return fail('TIMEOUT', `request exceeded ${timeoutMs} ms`);
    return fail('NETWORK', e?.message || 'network error');
  }
  clearTimeout(timer);

  const status = res.status;
  let text = '';
  try { text = await res.text(); }
  catch (e) { return fail('BODY_READ', e?.message || 'failed to read body', status); }

  if (!res.ok) {
    let message = `HTTP ${status}`;
    try {
      const j = JSON.parse(text);
      if (j && typeof j.error === 'string') message = j.error;
      else if (j && typeof j.message === 'string') message = j.message;
    } catch { /* keep default */ }
    return fail(`HTTP_${status}`, message, status);
  }

  if (!text) return { ok: true, data: null };
  try { return { ok: true, data: JSON.parse(text) }; }
  catch { return fail('BAD_JSON', 'response was not valid JSON', status); }
}

function fail(code, message, status) {
  return { ok: false, error: { code, message, ...(status ? { status } : {}) } };
}

function joinUrl(base, path) {
  if (!base) throw new Error('baseUrl is required');
  return base.replace(/\/+$/, '') + path;
}
