import { createOverlay } from '../overlay-shell.js';

// Stub: replaced in a later task.
export function mount(root, ctx) {
  createOverlay(root, { name: 'mutant', title: 'Plant a calibration mutant', variant: 'modal', ctx });
}
