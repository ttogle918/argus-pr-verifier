import { createOverlay } from '../overlay-shell.js';

// Stub: replaced in a later task.
export function mount(root, ctx) {
  createOverlay(root, { name: 'import', title: 'Import a pull request', variant: 'modal', ctx });
}
