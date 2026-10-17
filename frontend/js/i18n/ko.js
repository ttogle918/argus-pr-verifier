import { KO_COMMON } from './ko-common.js';
import { KO_START } from './ko-start.js';
import { KO_RUN } from './ko-run.js';
import { KO_VERIFY } from './ko-verify.js';
import { KO_DECIDE } from './ko-decide.js';

// Each screen keeps its own table; a key that appears in two tables must have the same translation
// (tests/frontend/i18n.test.js checks this).
export const KO_PARTS = { KO_COMMON, KO_START, KO_RUN, KO_VERIFY, KO_DECIDE };
export const KO = Object.assign({}, KO_COMMON, KO_START, KO_RUN, KO_VERIFY, KO_DECIDE);
