/**
 * The refusal set, tested as the thing that can stop Josh's work.
 *
 * Both failure modes are real and they are not symmetrical. Missing a violation files a draft he
 * then has to give a note on — which is the whole complaint this module answers. Refusing a draft
 * he would have been happy with stops the work entirely, and a check that does that gets switched
 * off, after which it catches nothing. So most of what is below is about not crying wolf.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { prefileVerdict, willRefuse } from "./prefile.mjs";

/** The live library, as far as this module reads it. */
const LIVE = {
  banned_phrases: "Never end by asking for engagement (\"Agree?\", \"Thoughts?\", "
    + "\"What would you add?\").",
};

/* ── The close ──────────────────────────────────────────────────────────────── */

test("the closing line that Josh raised himself is refused", () => {
  // Drafts 89 and 90, 26 October, both ended on this. It is first person, so a pattern keyed on
  // "you" would miss the live case — which is the case that prompted the rule being enforced.
  const body = "I spent a morning on it.\n\nThe answer was in the DNS records.\n\nWhich ones have I missed?";
  const { blocking } = prefileVerdict(body, { sections: LIVE });
  assert.equal(blocking.filter((f) => f.source === "engagement_ask").length, 1);
});

test("every example the library itself names is caught", () => {
  for (const close of ["Agree?", "Thoughts?", "What would you add?", "What am I missing?"]) {
    const body = `He told me the number was wrong.\n\nI had already sent it.\n\n${close}`;
    const { blocking } = prefileVerdict(body, { sections: LIVE });
    assert.ok(
      blocking.some((f) => f.source === "engagement_ask"),
      `the library names "${close}" and the check does not see it`,
    );
  }
});

test("a genuine question close is left alone — it is the default", () => {
  /*
   * The closes section calls a genuine question "the default close", and gate_rules says a question
   * may close a hook. So this check cannot simply fire on a trailing "?" — if it did, it would
   * refuse the shape his own library asks for most often.
   */
  const keep = [
    "Who owns the number after we leave?",
    "So who signs it off when the VP is on leave?",
    "What would you have done with three days and no budget?",
  ];
  for (const close of keep) {
    const body = `She had a shortlist she was not telling us about.\n\n${close}`;
    const { blocking } = prefileVerdict(body, { sections: LIVE });
    assert.equal(
      blocking.filter((f) => f.source === "engagement_ask").length,
      0,
      `refused a genuine question: "${close}"`,
    );
  }
});

test("a solicitation that is not a question is not this check's business", () => {
  // "Never two asks" and the rationing are different rules, judged elsewhere. This one is about
  // ending on a request for a reaction, and a statement is not that.
  const body = "We moved the call to Tuesday.\n\nLet me know how it goes.";
  const { blocking } = prefileVerdict(body, { sections: LIVE });
  assert.equal(blocking.filter((f) => f.source === "engagement_ask").length, 0);
});

/* ── The rules stay his ─────────────────────────────────────────────────────── */

test("the refusal dies with the rule, and without a deploy", () => {
  /*
   * The point of gating on the live text: Josh can delete the line and the enforcement goes with
   * it. A refusal that outlived the rule it came from would be this system inventing a standard,
   * which 12.10 exists to prevent.
   */
  const body = "A thing happened.\n\nThen another.\n\nThoughts?";
  const withRule = prefileVerdict(body, { sections: LIVE });
  const without = prefileVerdict(body, { sections: { banned_phrases: "Be nice." } });

  assert.ok(withRule.blocking.some((f) => f.source === "engagement_ask"));
  assert.equal(without.blocking.filter((f) => f.source === "engagement_ask").length, 0);
  assert.equal(without.advisory.filter((f) => f.source === "engagement_ask").length, 0);
});

test("no library means no opinion, not an accusation", () => {
  // "We could not check" and "this breaks a rule" are different answers and only one is true.
  const body = "A thing happened.\n\nThen another.\n\nThoughts?";
  const { blocking, advisory } = prefileVerdict(body);
  assert.equal(blocking.filter((f) => f.source === "engagement_ask").length, 0);
  assert.ok(
    advisory.some((f) => f.source === "engagement_ask"),
    "with no library in hand it should still be reported",
  );
});

/* ── Not crying wolf ────────────────────────────────────────────────────────── */

test("a real post of his comes back clean", () => {
  const body = [
    "The AI said the customer quotes came from Gong calls.",
    "",
    "It had made them up. All four.",
    "",
    "I only caught it because one of them named a person who left in March.",
    "",
    "So now I check the source before I check the wording.",
  ].join("\n");
  const { blocking } = prefileVerdict(body, { sections: LIVE });
  assert.deepEqual(blocking, [], `refused a clean post: ${JSON.stringify(blocking)}`);
});

test("a three-item list is not bullet soup", () => {
  // His formatting section asks for sub-headers with bullets under each. Three parallel items is
  // what a short real list looks like.
  const body = [
    "Three things changed after that call.",
    "",
    "→ We stopped sending the deck first.",
    "→ We asked who owned the number.",
    "→ I wrote the follow-up myself.",
    "",
    "The third one is the only one that mattered.",
  ].join("\n");
  const { blocking } = prefileVerdict(body, { sections: LIVE });
  assert.deepEqual(blocking, [], `refused a genuine three-item list: ${JSON.stringify(blocking)}`);
});

test("eight blocks of the same scaffold is", () => {
  const body = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    [
      `${n}. Method ${n}`,
      `→ A tool leaves a trace somewhere, and this is where method ${n} goes looking for it.`,
      "→ Pro: cheap, and quick to run against a long list of domains.",
      "→ Con: it misses the back-office tools, which is most of them.",
      "→ Effort to use: easy.",
    ].join("\n")
  ).join("\n\n");
  const { blocking } = prefileVerdict(body, { sections: LIVE });
  assert.ok(blocking.length > 0, "draft 90's shape is still filed");
});

/* ── The two readers agree ──────────────────────────────────────────────────── */

test("willRefuse says exactly what prefileVerdict blocks on", () => {
  const body = "A thing happened.\n\nThen another.\n\nThoughts?";
  const opts = { sections: LIVE };
  assert.equal(willRefuse(body, opts).length, prefileVerdict(body, opts).blocking.length);
});

/* ── An empty index is not a clean draft ────────────────────────────────────── */

test("an empty reference index reports 'not checked', never 'nothing found'", async () => {
  /*
   * borrowedIndexFor's own comment has promised since it was written: "Returns null when the index
   * is empty — not an empty set. 'We could not check' and 'nothing borrowed' are different answers
   * and the caller is told which one it got."
   *
   * It never returned null. It returned `new Set()` for an empty table and for a clean draft alike,
   * so a draft came back `borrowed_phrases: { checked: "N runs", found: 0 }` with 8.3 unenforced —
   * sitting directly beneath a second comment saying a check must report that it ran "or nobody can
   * tell the difference between 'nothing borrowed' and 'nothing looked'". The mechanism written to
   * close that gap contained it.
   *
   * reference_shingles is populated by a script run by hand, so an empty one is a real state: a
   * fresh project, a restored database, or a clone pointed somewhere the script never ran.
   *
   * Asserted by source, because the alternative is emptying a 398,803-row table on the live project.
   */
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./tools/write.mjs", import.meta.url), "utf8");

  assert.match(
    src,
    /if \(any\.length === 0\) return null;/,
    "borrowedIndexFor still cannot distinguish an empty index from a clean draft",
  );
  assert.match(
    src,
    /borrowedIndex === null/,
    "the reply does not branch on an unchecked index, so it reads as clean",
  );
  // Scoped to the reply block. A bare indexOf compares against the word "found: 0" sitting in the
  // explanatory comment ninety lines earlier — which is the mistake this very test is about, made
  // while writing the test for it.
  const reply = src.slice(src.indexOf("borrowed_phrases:"));
  assert.ok(
    reply.indexOf("checked: false") < reply.indexOf("found: 0"),
    "the unchecked case must be answered before the clean case",
  );

  // And the promise in the comment must still be the promise. Matched on a fragment that does not
  // wrap: the full sentence spans two comment lines, and a regex over raw source cannot see across
  // the " * " between them — the same thing reference-split.test.ts needed its assembled() helper
  // for.
  assert.match(src, /Returns null when the index is empty/);
});
