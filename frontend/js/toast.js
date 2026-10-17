import { html, setHtml } from './dom.js';
import { icon } from './icons.js';

const ICON = { ok: 'check', danger: 'alert', muted: 'info' };

export function showToast(message, tone = 'muted') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  setHtml(el, html`${icon(ICON[tone] ?? 'info')}<span>${message}</span>`);
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
