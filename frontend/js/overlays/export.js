import { createOverlay } from '../overlay-shell.js';

// Stub: replaced in a later task.
export function mount(root, ctx) {
  createOverlay(root, { name: 'export', title: 'Verified PR bundle', variant: 'modal', ctx });
}
