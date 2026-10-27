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
import { CHECK_SEES_SOURCE, gateInputsFor } from "./views.ts";

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

/*
 * ── The instruction was not enough, so now the notes do not arrive at all ───────────────────────
 *
 * Everything above asserts WORDING: that the rubrics tell the judge to quote the post. That was the
 * whole of the 5 October fix, and it left the notes sitting in front of five checks that have no
 * use for them, with an instruction as the only thing standing between. Worse, the narrowing that
 * did exist lived inside handlers/gate.ts, so get_gate_brief — the path that actually runs, since
 * gate_runs_in_claude defaults true — applied none of it.
 *
 * These assert the INPUT instead. A check that cannot see his notes cannot fail a post for them,
 * whatever the model does on the day.
 */

const NOTE_ONLY = ["17 campuses", "Attack Surface Visibility", "North Carolina"];

test("only the three checks that compare against the material are shown it", () => {
  assert.deepEqual([...CHECK_SEES_SOURCE].sort(), ["anyone_else", "claims_trace", "identifiable"]);

  for (const spec of GATE_CHECKS) {
    const sees = gateInputsFor(spec.key);
    const user = GATE_USER({
      check: spec,
      body: DRAFT_56,
      entry: sees.source ? SOURCE : undefined,
      audience: sees.audience ? "VPs of Sales" : undefined,
      clearedNames: sees.clearedNames ? ["Ben"] : undefined,
    });

    if (sees.source) continue;

    for (const phrase of NOTE_ONLY) {
      assert.ok(
        !user.includes(phrase),
        `${spec.key} was handed "${phrase}", which is in his notes and not in the post`,
      );
    }
  }
});

test("the five that judge the text alone get the post and nothing else", () => {
  for (const key of ["hook_opens_loop", "voice_guide", "banned_phrases", "aimed_at_someone", "names_cleared"]) {
    const sees = gateInputsFor(key);
    assert.equal(sees.source, false, `${key} is being shown the source material`);
  }
  // And the two that legitimately look outside the post still do.
  assert.equal(gateInputsFor("aimed_at_someone").audience, true);
  assert.equal(gateInputsFor("names_cleared").clearedNames, true);
  // ...but only to the check that asks for it.
  assert.equal(gateInputsFor("hook_opens_loop").audience, false);
  assert.equal(gateInputsFor("voice_guide").clearedNames, false);
});

test("a check added later is shown the post alone until someone says otherwise", () => {
  // The safe default, stated as a test so it is a decision rather than an accident.
  assert.deepEqual(gateInputsFor("some_check_added_in_future"), {
    source: false,
    audience: false,
    clearedNames: false,
    // shape joined the list on 14 Oct and defaults the same way: a new check sees the post alone.
    shape: false,
    /*
     * hisNotes joined on 27 Oct. Four checks are shown what Josh asked for on this post, so the
     * judge can say "this fails BECAUSE he asked for it" instead of failing silently and sending
     * the writer back into the same wall. A new check is not one of them until someone decides it
     * is — the last time inputs were handed out generously, five checks ended up reading his
     * private notes and failing drafts for things that were not in them.
     */
    hisNotes: false,
  });
});

test("only the checks a request of his can trip are shown what he asked for", () => {
  // A collision is possible where a rule meets a preference: he dictates an opening the banned
  // list forbids, or a close the hook rule does not want. It is not possible for the checks that
  // judge truth — nothing he can ask for makes an invented quote or an uncleared name acceptable.
  for (const key of ["banned_phrases", "hook_opens_loop", "voice_guide", "shape"]) {
    assert.equal(gateInputsFor(key).hisNotes, true, `${key} cannot see what he asked for`);
  }
  for (const key of ["claims_trace", "names_cleared", "identifiable", "anyone_else"]) {
    assert.equal(gateInputsFor(key).hisNotes, false, `${key} is being shown his notes`);
  }
});

test("both gate paths ask the same question about what a check may see", async () => {
  // The fault this whole file now guards was two readers disagreeing, so it is checked by source:
  // neither path may decide for itself which checks get the material.
  const paths = ["./handlers/gate.ts", "../../../mcp-server/tools/brief.mjs"];
  for (const f of paths) {
    const source = await Deno.readTextFile(new URL(f, import.meta.url));
    assert.match(source, /gateInputsFor/, `${f} does not use the shared rule`);
    assert.doesNotMatch(
      source,
      /(const|let)\s+NEEDS_SOURCE\s*=/,
      `${f} has gone back to its own copy of the rule`,
    );
    assert.doesNotMatch(
      source,
      /check\.key === "aimed_at_someone"/,
      `${f} is deciding for itself which check sees the audience`,
    );
  }
});
