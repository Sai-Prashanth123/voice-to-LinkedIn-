/**
 * The gate must judge the POST, not the notes behind it.
 *
 * On 5 October Josh ran a real post through and six of eight checks failed it. Three were wrong, and
 * all three in the same way — they read his raw material and failed the post for what was in there:
 *
 *   identifiable  "17 campuses" and the "Attack Surface Visibility Initiative" — neither phrase
 *                 appears anywhere in the post. Both are in the notes, which no reader sees.
 *   claims_trace  failed because the post said "one specific account" WITHOUT naming the account.
 *                 That is anonymising. The check exists to catch things added, not things left out.
 *   names_cleared failed on "Ben" — the wrong name a stranger had put at the top of a cold email to
 *                 him. Nobody is identified by it.
 *
 * He reported it as "the gate is also failing drafts for things that aren't in them", which is
 * exactly right. These assert the instructions that stop it, against his real draft.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GATE_CHECKS, GATE_SYSTEM, GATE_USER } from "./prompts.ts";

/** Draft 56, as filed on 5 October. */
const DRAFT_56 = `A cold email landed in my inbox addressed to Ben.

My name isn't Ben. Eye roll.

I read the whole thing anyway.

Underneath the wrong name sat a business case for why a security vendor would be a good fit for one
specific account, built out of that account's own internal initiatives.

Then this:

"this is one of thousands. want the rest?"

And the sign off: "If this isn't useful, just say so and I'll stop."

Useful prospect research, handed over with nothing attached to it.`;

/** What his notes held, and the post deliberately did not. */
const SOURCE = {
  the_moment: "A cold email addressed to Ben, with a business case for the University of North " +
    "Carolina System built from their Attack Surface Visibility Initiative across 17 campuses.",
  their_actual_words: "this is one of thousands. want the rest?",
};

const check = (key: string) => {
  const spec = GATE_CHECKS.find((c) => c.key === key);
  if (!spec) throw new Error(`no check named ${key}`);
  return spec;
};

test("the gate is told to quote the post, and told the notes are not visible to a reader", () => {
  const system = GATE_SYSTEM("(library)");
  assert.match(system, /JUDGE THE POST/);
  assert.match(system, /quote the words from the post/i);

  const user = GATE_USER({ check: check("identifiable"), body: DRAFT_56, entry: SOURCE });
  assert.match(user, /NO READER SEES/);
  assert.match(user, /never as something the post failed to include/i);
});

test("identifiable is told a detail only counts when it is in the post", () => {
  const { question } = check("identifiable");
  assert.match(question, /JUDGE THE POST, NOT THE SOURCE/);
  assert.match(question, /quote the phrase from the post/i);
  // The exact failure, kept as the example, so a future edit that drops the rule fails here.
  assert.match(question, /17 campuses/);
});

test("claims_trace runs one way: things added, never things omitted", () => {
  const { question } = check("claims_trace");
  assert.match(question, /ONE WAY ONLY/);
  assert.match(question, /is not a failure/i);
  assert.match(question, /one specific account/);
  assert.match(question, /ADDED, never for things\s+omitted/);
});

test("names_cleared is about identifying a real person, not any capitalised word", () => {
  const { question } = check("names_cleared");
  assert.match(question, /ONLY A NAME WHEN IT POINTS AT SOMEBODY/);
  assert.match(question, /wrong name/i);
  assert.match(question, /Ben/);
});

test("the material the post left out is genuinely absent from the post", () => {
  // Guards the fixture itself: if someone edits DRAFT_56 to contain these, the tests above stop
  // meaning anything.
  assert.equal(DRAFT_56.includes("17 campuses"), false);
  assert.equal(DRAFT_56.includes("Attack Surface Visibility"), false);
  assert.equal(DRAFT_56.includes("North Carolina"), false);
  // And the things the post DOES contain, which a real failure would have to quote.
  assert.equal(DRAFT_56.includes("Ben"), true);
  assert.equal(DRAFT_56.includes("one\nspecific account"), true);
});

test("every check still receives the post itself", () => {
  for (const spec of GATE_CHECKS) {
    const user = GATE_USER({ check: spec, body: DRAFT_56 });
    assert.match(user, /THE POST:/);
    assert.ok(user.includes("My name isn't Ben."), `${spec.key} was not given the post`);
  }
});
