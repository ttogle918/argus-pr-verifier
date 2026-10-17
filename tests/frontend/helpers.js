import { readFileSync } from 'node:fs';
import { expandEvent } from '../../frontend/js/playback.js';
import { reduceRunEvent } from '../../frontend/js/run.js';
import { initialRun } from '../../frontend/js/state.js';

export const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

export const START = {
  stage: '_start', prId: 'pr-checkout-race', prTitle: 'PR #412', repoName: 'acme-pay/ledger-core',
  author: 'devin-bot[ai]', phase: 'phase2_full', requestedMode: 'replay', startedAt: '2026-10-17T00:00:00Z',
};

// Feeds events through playback + reducer with no delays. stopAfter: stop once this stage was applied.
export function replay(events, start = START, { stopAfter = null } = {}) {
  let run = reduceRunEvent(initialRun(), start);
  const ctx = {};
  for (const evt of events) {
    for (const [, e] of expandEvent(evt, { mode: 'replay', ctx })) run = reduceRunEvent(run, e);
    if (evt.stage === stopAfter) break;
  }
  return run;
}
