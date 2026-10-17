import { createOverlay } from '../overlay-shell.js';

// Stub: replaced in a later task.
export function mount(root, ctx) {
  createOverlay(root, { name: 'diff', title: 'PR diff', variant: 'drawer', ctx });
}
