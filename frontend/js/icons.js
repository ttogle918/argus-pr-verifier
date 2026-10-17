import { raw, esc } from './dom.js';

const STROKE = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  breach: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  warn: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.3"/>',
  held: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  pending: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
  spinner: '<path d="M12 3a9 9 0 1 1-9 9"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  invalid: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  security: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>',
  edge_cases: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  state: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  regression: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  clipboard: '<path d="M9 4h6v3H9zM7 5H5v16h14V5h-2"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
  details: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};

const FILLED = { play: '<path d="M7 4.5v15l12.5-7.5L7 4.5z"/>' };

// Eye glyphs use a 40x24 viewBox.
const EYE = {
  eyeClosed: '<path d="M3 11 Q20 21 37 11"/><path d="M11 16 L9 20 M20 18 L20 22 M29 16 L31 20"/>',
  eyeOpen: '<path d="M2 12 Q20 -3 38 12 Q20 27 2 12 Z" fill="currentColor" fill-opacity="0.14"/><circle cx="20" cy="12" r="6" fill="currentColor"/><circle cx="20" cy="12" r="2.5" fill="var(--bg)" stroke="none"/>',
};

export const ARGUS_LOGO = raw('<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2 12 Q12 2.5 22 12 Q12 21.5 2 12 Z"/><circle cx="12" cy="12" r="3.4"/></svg>');

// icon('check', { size: 16, label: 'Caught' }) - decorative unless label is given.
export function icon(name, { size = 16, label = null, cls = '' } = {}) {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  const klass = `icon icon--${name}${cls ? ` ${esc(cls)}` : ''}`;
  if (EYE[name]) {
    return raw(`<svg class="${klass}" viewBox="0 0 40 24" width="${Math.round(size * 1.67)}" height="${size}" ${a11y} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">${EYE[name]}</svg>`);
  }
  if (FILLED[name]) {
    return raw(`<svg class="${klass}" viewBox="0 0 24 24" width="${size}" height="${size}" ${a11y} fill="currentColor">${FILLED[name]}</svg>`);
  }
  return raw(`<svg class="${klass}" viewBox="0 0 24 24" width="${size}" height="${size}" ${a11y} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${STROKE[name] ?? STROKE.info}</svg>`);
}
