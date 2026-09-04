/**
 * Every case, in one list.
 *
 * A flat registry rather than directory scanning, so a stage file that is written but never wired
 * in fails loudly at import instead of quietly contributing nothing — which is the same shape as
 * every bug this harness exists to catch.
 */

import { cases as s0 } from "./s0-wiring.mjs";
import { cases as s1 } from "./s1-inputs.mjs";
import { cases as s2 } from "./s2-interview.mjs";
import { cases as s3 } from "./s3-bank.mjs";
import { cases as s4 } from "./s4-select.mjs";
import { cases as s5 } from "./s5-draft.mjs";
import { cases as s6 } from "./s6-gate.mjs";
import { cases as s7 } from "./s7-calendar.mjs";
import { cases as s8 } from "./s8-publish.mjs";
import { cases as s9 } from "./s9-learn.mjs";
import { cases as x } from "./x-consistency.mjs";

export function allCases() {
  return [...s0, ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...s8, ...s9, ...x];
}
