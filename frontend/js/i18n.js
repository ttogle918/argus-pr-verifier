import { KO } from './i18n/ko.js';

export { LANG_NAMES } from './i18n/names.js';

// UI copy is written in English; the English text is also the lookup key for other languages.
// Data from the server (PR titles, findings, traces) is shown as received.
export const LANGS = ['en', 'ko'];
const STORAGE_KEY = 'argus-lang';
const DICTS = { ko: KO };

function savedLang() {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

let lang = savedLang();
const listeners = new Set();

export const getLang = () => lang;

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, next); } catch { /* per-viewer convenience only */ }
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// t('Run') or t('{caught} of {total} caught', { caught, total }). Unknown text falls back to the English.
export function t(text, vars) {
  let out = String(text ?? '');
  out = DICTS[lang]?.[out] ?? out;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}
