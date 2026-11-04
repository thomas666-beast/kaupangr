/**
 * Searchable picker. Renders a text input + dropdown and a hidden id field.
 * Caller wires it to any search function via { searchFn }.
 *
 * Usage:
 *   const ac = createSearchable({
 *     searchFn: async (q) => {
 *       const r = await window.kaupangr.products.search(q);
 *       return {
 *         ok: r.ok,
 *         data: r.ok ? r.data.map(p => ({ id: p.id, label: `${p.sku} — ${p.name}` })) : [],
 *       };
 *     },
 *     placeholder: 'Search product...',
 *     onChange: ({ id, label }) => { ... },
 *   });
 *   container.appendChild(ac.el);
 *   ac.setValue({ id: 42, label: 'COF-001 — Coffee 250g' });
 *   ac.get();
 *   ac.clear();
 */

export function createSearchable({
  searchFn,
  placeholder = 'Search...',
  onChange,
  minChars = 1,
  debounceMs = 150,
}) {
  const el = document.createElement('div');
  el.className = 'ac';
  el.innerHTML = `
    <input type="text" class="ac-input" placeholder="${placeholder}" autocomplete="off" />
    <input type="hidden" class="ac-value" />
    <button type="button" class="ac-clear" title="Clear" hidden>×</button>
    <ul class="ac-list" hidden></ul>
  `;

  const input  = el.querySelector('.ac-input');
  const hidden = el.querySelector('.ac-value');
  const clear  = el.querySelector('.ac-clear');
  const list   = el.querySelector('.ac-list');

  let results = [];
  let activeIndex = -1;
  let selected = null;          // { id, label } | null
  let timer = null;
  let lastQuery = '';

  function open()   { list.hidden = false; }
  function close()  { list.hidden = true; activeIndex = -1; }
  function clearList() { list.innerHTML = ''; results = []; activeIndex = -1; }

  function paintList() {
    list.innerHTML = results.map((it, i) => `
      <li data-index="${i}" class="${i === activeIndex ? 'active' : ''}">
        <span class="ac-label">${escHtml(it.label)}</span>
        ${it.sub ? `<span class="ac-sub">${escHtml(it.sub)}</span>` : ''}
      </li>`).join('');
    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('mousedown', (e) => {
        // prevent input blur before mousedown lands
        e.preventDefault();
        selectIndex(+li.dataset.index);
      });
    });
  }

  function selectIndex(i) {
    const it = results[i];
    if (!it) return;
    selected = { id: it.id, label: it.label };
    input.value = it.label;
    hidden.value = String(it.id);
    clear.hidden = false;
    close();
    clearList();
    if (typeof onChange === 'function') onChange(selected);
  }

  function clearSelection() {
    selected = null;
    input.value = '';
    hidden.value = '';
    clear.hidden = true;
    close();
    clearList();
    if (typeof onChange === 'function') onChange(null);
    input.focus();
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (selected && q !== selected.label) {
      // typing after selection clears it
      selected = null;
      hidden.value = '';
      clear.hidden = true;
      if (typeof onChange === 'function') onChange(null);
    }
    clearTimeout(timer);
    if (q.length < minChars) { clearList(); close(); return; }
    timer = setTimeout(runSearch, debounceMs);
  });

  async function runSearch() {
    const q = input.value.trim();
    if (q === lastQuery) return;
    lastQuery = q;
    const r = await searchFn(q);
    if (q !== input.value.trim()) return;   // stale
    results = (r && r.ok && Array.isArray(r.data)) ? r.data : [];
    activeIndex = results.length > 0 ? 0 : -1;
    if (results.length === 0) {
      list.innerHTML = `<li class="ac-empty">No match.</li>`;
    } else {
      paintList();
    }
    open();
  }

  input.addEventListener('keydown', (e) => {
    if (list.hidden) {
      if (e.key === 'ArrowDown' && input.value.trim()) {
        // Trigger a search if the user has typed something
        clearTimeout(timer);
        runSearch();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      activeIndex = Math.min(results.length - 1, activeIndex + 1);
      paintList();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      activeIndex = Math.max(0, activeIndex - 1);
      paintList();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        selectIndex(activeIndex);
        e.preventDefault();
      }
    } else if (e.key === 'Escape') {
      close();
      e.preventDefault();
    }
  });

  input.addEventListener('blur', () => {
    // Let a click on a list item land first.
    setTimeout(close, 120);
  });

  clear.addEventListener('click', clearSelection);

  return {
    el,
    get() { return selected; },
    setValue(v) {
      if (!v) { clearSelection(); return; }
      selected = { id: v.id, label: v.label };
      input.value = v.label;
      hidden.value = String(v.id);
      clear.hidden = false;
      close();
      clearList();
    },
    clear() { clearSelection(); },
    focus() { input.focus(); },
  };
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
