/**
 * The 9.3 record, and whether it can be read back.
 *
 * These are the exact confusions the live column was carrying on 19 October: 11 distinct values
 * across 49 drafts for what are really five or six structures, because nothing compared them on a
 * key. Each test below names the real value that made the case.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  frameworkKey,
  frameworkMix,
  isNamedFramework,
  namedFrameworks,
  tidyFramework,
} from "./frameworks.mjs";

const SECTION = `# Body frameworks

Three structures, and a set of measured moves.

## What, why, how

State what happened.

## Problem, agitate, solve

Name a problem.

## Hook, frame, insight, lesson

The frame is the extra step.

---

# The measured moves

**Open on something specific.** A plain statement opens 45% of posts.
`;

test("case alone does not make a second framework", () => {
  // Live: "what, why, how" (18 drafts) and "What, why, how" (2) were counted separately.
  assert.equal(frameworkKey("what, why, how"), frameworkKey("What, why, how"));
});

test("the non-breaking hyphen does not make a second framework", () => {
  // Live: "problem, agitate, solve" and "Problem‑Agitate‑Solution" — the second carries U+2011.
  assert.equal(frameworkKey("Problem‑Agitate‑Solve"), frameworkKey("problem, agitate, solve"));
  assert.equal(frameworkKey("problem-agitate-solve"), frameworkKey("Problem, Agitate, Solve"));
});

test("a different structure stays a different structure", () => {
  // The whole point: "The scene" must not be folded into one of his three to flatter the count.
  assert.notEqual(frameworkKey("The scene"), frameworkKey("What, why, how"));
  assert.notEqual(frameworkKey("scene_then_lesson"), frameworkKey("The scene"));
});

test("the stored value keeps his capitalisation and loses only stray whitespace", () => {
  assert.equal(tidyFramework("  What,  why,   how \n"), "What, why, how");
  assert.equal(tidyFramework("Hook, frame, insight, lesson"), "Hook, frame, insight, lesson");
});

test("the named frameworks come off the section, not from this file", () => {
  assert.deepEqual(namedFrameworks(SECTION), [
    "What, why, how",
    "Problem, agitate, solve",
    "Hook, frame, insight, lesson",
  ]);
  // "# The measured moves" is a single-hash heading and is not a structure.
  assert.ok(!namedFrameworks(SECTION).includes("The measured moves"));
});

test("a framework is recognised across spellings and refused when it is not his", () => {
  assert.ok(isNamedFramework("what, why, how", SECTION));
  assert.ok(isNamedFramework("Problem‑Agitate‑Solve", SECTION));
  assert.ok(!isNamedFramework("The scene", SECTION));
  assert.ok(!isNamedFramework("Narrative storytelling", SECTION));
});

test("the mix folds spellings together and flags what the library does not name", () => {
  const drafts = [
    { framework: "what, why, how" },
    { framework: "What, why, how" },
    { framework: "what,  why, how" },
    { framework: "The scene" },
    { framework: "problem, agitate, solve" },
  ];
  const mix = frameworkMix(drafts, SECTION);

  assert.equal(mix.length, 3, "three distinct structures, not five");
  assert.equal(mix[0].used, 3);
  assert.equal(mix[0].in_library, true);

  const stranger = mix.find((m) => m.framework === "The scene");
  assert.equal(stranger.in_library, false, "a value outside his section is flagged, not folded in");
});

test("an empty frameworks section makes no claim about what is allowed", () => {
  // An empty library must not start flagging every draft. The honest answer is no answer.
  const mix = frameworkMix([{ framework: "The scene" }], "");
  assert.equal(mix[0].in_library, undefined);
  assert.equal(mix[0].used, 1);
});

test("a draft with no framework is not counted as a framework", () => {
  const mix = frameworkMix([{ framework: "" }, { framework: null }, { framework: "The scene" }], SECTION);
  assert.equal(mix.length, 1);
});
