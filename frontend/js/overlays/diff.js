import { html, setHtml } from '../dom.js';
import { createOverlay } from '../overlay-shell.js';
import { t } from '../i18n.js';

export function diffLineClass(line) {
  if (/^(@@|diff |index |--- |\+\+\+ )/.test(line)) return 'code__line--meta';
  if (line.startsWith('+')) return 'code__line--add';
  if (line.startsWith('-')) return 'code__line--del';
  return '';
}

export function mount(root, ctx) {
  const { body, onOpen } = createOverlay(root, { name: 'diff', title: t('PR diff'), variant: 'drawer', ctx });
  onOpen((state) => {
    const pr = state.prs.find((p) => p.id === state.selectedPrId);
    const diff = pr?.diff ?? '';
    setHtml(body, html`
      <div class="diff-drawer">
        <div class="diff-drawer__head">
          <h3 class="diff-drawer__title">${pr?.title ?? t('No pull request selected')}</h3>
          ${pr ? html`<p class="mono diff-drawer__meta">${pr.repo_name} · ${pr.author}</p>` : ''}
        </div>
        ${diff.trim()
          ? html`<pre class="code" tabindex="0" aria-label="${t('Diff text')}">${diff.replace(/\n$/, '').split('\n').map((l) => html`<span class="code__line ${diffLineClass(l)}">${l || ' '}</span>`)}</pre>`
          : html`<p class="empty-state">${t('This PR has no diff text. It will be loaded when the run starts.')}</p>`}
      </div>`);
  });
}
