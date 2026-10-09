import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePillars } from "./library.ts";

/**
 * A pillar the model invented is worse than no pillar at all: selection balances across pillars
 * (7.1), so phantom categories quietly change which moment gets written next. These tests pin the
 * behaviour that matters most — placeholder prose must yield NOTHING.
 */

test("the placeholder currently in the library yields no pillars", () => {
  const placeholder = `# Content pillars

FOR JOSH. Not drafted, because guessing at what you write about would put words in your mouth and
you would spend longer correcting it than writing it.

What goes here: what you write about, and what each pillar ACTUALLY covers for you rather than the
generic version of that topic (clause 8).

Three to five is usually right. For each, a sentence on what belongs in it and a sentence on what
people assume belongs in it but does not.`;

  assert.deepEqual(parsePillars(placeholder), []);
});

test("real pillars are read from headings", () => {
  const body = `# Content pillars

## Positioning
What a company actually sells versus what it says it sells.

## Founder-led sales
The messy middle between the founder closing everything and a real team.

## Pricing
`;
  assert.deepEqual(parsePillars(body), ["Positioning", "Founder-led sales", "Pricing"]);
});

test("real pillars are read from bullets, with the explanation stripped", () => {
  const body = `# Content pillars

- Positioning — what they sell vs what they say they sell
- Founder-led sales: the messy middle
- Pricing
`;
  assert.deepEqual(parsePillars(body), ["Positioning", "Founder-led sales", "Pricing"]);
});

test("duplicates collapse and markdown emphasis is stripped", () => {
  const body = `## **Positioning**\n- Positioning\n## Pricing`;
  assert.deepEqual(parsePillars(body), ["Positioning", "Pricing"]);
});

test("an empty section yields nothing rather than throwing", () => {
  assert.deepEqual(parsePillars(""), []);
  assert.deepEqual(parsePillars("   \n\n  "), []);
});

test("prose without list structure is not mistaken for pillars", () => {
  const body = `# Content pillars

I mostly write about positioning and pricing, and sometimes about hiring.`;
  assert.deepEqual(parsePillars(body), []);
});

/**
 * The bank page parsed pillars too, from an app-side copy — `app/lib/pillars.ts` could not import
 * this module, which is Deno with `npm:` specifiers Next would not resolve. This test pinned the two
 * together, because a copy that silently drifted would let Josh pick a pillar the drafter does not
 * recognise.
 *
 * The desk was deleted on 2026-10-09 and the copy went with it. The cases it compared are kept and
 * asserted against this module directly: they are the awkward inputs, which is why they were chosen,
 * and they are worth more as expectations than as a comparison with nothing.
 */
test("the awkward pillar sections parse the way they should", () => {
  assert.deepEqual(parsePillars("## Positioning\n## Hiring\n## The work itself"), [
    "Positioning",
    "Hiring",
    "The work itself",
  ]);

  // Emphasis stripped, trailing description dropped, and the duplicate not repeated.
  assert.deepEqual(
    parsePillars(
      "- Positioning — how founders describe what they sell\n- *Hiring*: the first three\n- Positioning",
    ),
    ["Positioning", "Hiring"],
  );

  // A placeholder section: the instructions to Josh are not pillars, the one real heading is.
  assert.deepEqual(parsePillars("For Josh to fill in\nThree to five is plenty\n## Real one"), [
    "Real one",
  ]);

  // Prose naming pillars is still prose.
  assert.deepEqual(parsePillars("We write about a few things. Mostly positioning, sometimes hiring."), []);
});
