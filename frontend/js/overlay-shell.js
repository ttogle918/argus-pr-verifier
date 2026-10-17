import { html, setHtml } from './dom.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared modal/drawer behavior. The overlay is open while state.overlay?.name === name.
export function createOverlay(root, { name, title, variant = 'modal', ctx }) {
  setHtml(root, html`
    <div class="overlay overlay--${variant}" data-overlay="${name}" hidden>
      <div class="overlay__backdrop" data-close></div>
      <section class="overlay__panel" role="dialog" aria-modal="true" aria-labelledby="${name}-title" tabindex="-1">
        <header class="overlay__header">
          <h2 class="overlay__title" id="${name}-title">${title}</h2>
          <button type="button" class="icon-btn" data-close data-testid="overlay-close" aria-label="Close">${icon('x', { size: 18 })}</button>
        </header>
        <div class="overlay__body"></div>
      </section>
    </div>`);
  const wrap = root.firstElementChild;
  const panel = wrap.querySelector('.overlay__panel');
  const body = wrap.querySelector('.overlay__body');
  const openHandlers = [];
  let returnFocus = null;
  let isOpen = false;

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) ctx.actions.closeOverlay();
  });
  const onKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); ctx.actions.closeOverlay(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === panel) { e.preventDefault(); last.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const sync = (state) => {
    const open = state.overlay?.name === name;
    if (open === isOpen) return;
    isOpen = open;
    wrap.hidden = !open;
    document.body.classList.toggle('has-overlay', !!state.overlay);
    if (open) {
      returnFocus = document.activeElement;
      document.addEventListener('keydown', onKeydown);
      openHandlers.forEach((fn) => fn(state));
      (panel.querySelector('[autofocus]') || panel.querySelector(FOCUSABLE))?.focus();
    } else {
      document.removeEventListener('keydown', onKeydown);
      if (returnFocus?.isConnected) returnFocus.focus();
    }
  };
  ctx.store.subscribe(sync);
  sync(ctx.store.getState());

  return { panel, body, onOpen: (fn) => openHandlers.push(fn) };
}
