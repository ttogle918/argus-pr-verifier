import { createOverlay } from '../overlay-shell.js';

// Stub: replaced in a later task.
export function mount(root, ctx) {
  createOverlay(root, { name: 'run-details', title: 'Run details', variant: 'drawer', ctx });
}
