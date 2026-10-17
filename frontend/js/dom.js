const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Raw(String(s));

const part = (v) => (v instanceof Raw ? v.s : esc(v));

// Tagged template: interpolations are escaped unless they are raw() or html`` results.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += Array.isArray(v) ? v.map(part).join('') : part(v);
    out += strings[i + 1];
  });
  return raw(out);
}

export function setHtml(el, content) {
  el.innerHTML = content instanceof Raw ? content.s : esc(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Delegated listener: handler(event, matchedElement).
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
