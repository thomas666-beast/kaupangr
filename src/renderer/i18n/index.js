import en from './en.js';
import fr from './fr.js';
import { LANGUAGES } from './languages.js';

const catalogues = { en, fr };

const available = new Set(LANGUAGES.map(l => l.code));

let currentCode = 'en';
let currentStrings = catalogues.en;
const listeners = new Set();

export function availableLanguages() {
  return LANGUAGES;
}

export function currentLanguage() {
  return currentCode;
}

export function setLanguage(code) {
  if (!available.has(code)) code = 'en';
  currentCode = code;
  currentStrings = catalogues[code] || catalogues.en;
  document.documentElement.lang = currentCode;
  for (const fn of listeners) fn(currentCode);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate a dotted key. Falls back to English, then to the key itself.
 * Interpolation: t('common.showingRange', { start: 1, end: 50, total: 120 }).
 */
export function t(key, vars) {
  const parts = key.split('.');
  let node = currentStrings;
  for (const p of parts) {
    if (node == null || typeof node !== 'object') { node = null; break; }
    node = node[p];
  }
  if (typeof node !== 'string') {
    // Fall back to English.
    let fallback = catalogues.en;
    for (const p of parts) {
      if (fallback == null || typeof fallback !== 'object') { fallback = null; break; }
      fallback = fallback[p];
    }
    node = typeof fallback === 'string' ? fallback : key;
  }
  return interpolate(node, vars);
}

function interpolate(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) =>
    vars[name] !== undefined ? String(vars[name]) : m
  );
}
