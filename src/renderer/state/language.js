import { setLanguage, onLanguageChange, currentLanguage } from '../i18n/index.js';

/**
 * Load the persisted language from the main process and apply it.
 * Falls back to 'en' if the call fails or the language is not available.
 */
export async function loadLanguage() {
  try {
    const r = await window.kaupangr.ui.getLanguage();
    if (r.ok && r.data && r.data.code) {
      setLanguage(r.data.code);
      return r.data.code;
    }
  } catch { /* ignore */ }
  setLanguage(currentLanguage());
  return currentLanguage();
}

export async function changeLanguage(code) {
  const r = await window.kaupangr.ui.setLanguage(code);
  if (!r.ok) return r;
  setLanguage(code);
  return r;
}

export { onLanguageChange, currentLanguage };
