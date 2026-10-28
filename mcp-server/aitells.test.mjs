/**
 * Tests for the AI-trait detectors.
 *
 * Every rule needs BOTH a positive and a negative case, and the file asserts that no rule is
 * missing either. A detector with only positive tests is the dangerous kind: it can match
 * everything and still look green, and the symptom in production is a writer who stops reading the
 * findings because they are always the same length.
 *
 * The four worked examples in docs/reference/ai-trait-scrubber.md are used as known answers. If the document and
 * this code ever disagree, one of them is wrong and this is where it surfaces — which is the whole
 * reason the rule ids match the document's headings rather than being renumbered.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { scan, RULES, EXEMPTIONS, JUDGEMENT, HIGH_CONFIDENCE } from "./aitells.mjs";

const rules = (text) => new Set(scan(text).findings.map((f) => f.rule));
const hits = (text, id) => scan(text).findings.filter((f) => f.rule === id);

/* ── The source document's own examples ───────────────────────────────────────────────────────
 *
 * Each "after" is the document's demonstration of a correct rewrite. If one of them trips a rule,
 * the rule is wrong — the document is the standard, not this file.
 */

const DOC_EXAMPLES = [
  {
    name: "throat-clearing + negative parallelism + profundity",
    before: "Here's the thing: most teams struggle with alignment. Not because the tools are bad. "
      + "But because people are complex. Let that sink in.",
    after: "Teams struggle with alignment. Tools are manageable. People are not.",
    expects: ["2C-22", "2C-2", "2C-7"],
  },
  {
    name: "rule of three + banned vocabulary",
    before: "In today's landscape, we need a robust, scalable, and comprehensive framework to "
      + "navigate uncertainty and leverage our core capabilities.",
    after: "You need one framework. Everything else is noise.",
    expects: ["2C-3", "2B"],
  },
  {
    name: "em dash + unearned profundity",
    before: "We closed 12 deals last month — something shifted. Everything changed.",
    after: "We closed 12 deals last month. The change: we stopped chasing inbound and started "
      + "responding within 4 minutes.",
    expects: ["2C-1", "2C-7"],
  },
];

for (const ex of DOC_EXAMPLES) {
  test(`doc example — ${ex.name} — the "before" trips the rules the document names`, () => {
    const found = rules(ex.before);
    for (const id of ex.expects) {
      assert.ok(found.has(id), `${id} was not detected in: ${ex.before}`);
    }
  });

  test(`doc example — ${ex.name} — the "after" is clean`, () => {
    const found = scan(ex.after).findings;
    assert.deepEqual(
      found.map((f) => `${f.rule}: ${f.matched}`),
      [],
      "the document's own corrected version tripped a rule, so the rule is wrong",
    );
  });
}

/* ── Negative parallelism, the headline rule ─────────────────────────────────────────────────── */

test("negative parallelism catches every variant family", () => {
  const forms = [
    ["direct", "It's not about the tools. It's about the people."],
    ["contracted", "This isn't a hiring problem. This is a management problem."],
    ["not-because across a full stop", "We lost it. Not because the pitch was weak. But because we were late."],
    ["cohort reframe", "Most teams do the safe thing. The best ones do the hard thing."],
    ["imperative", "Forget the funnel. Start with the conversation."],
    ["comparative", "Less process, more judgement."],
    ["question reframe", "Was it the price? No. It was the timing."],
    ["softened", "Most people think cold email is dead."],
  ];
  for (const [label, text] of forms) {
    assert.ok(hits(text, "2C-2").length > 0, `missed the ${label} form: ${text}`);
  }
});

test("negative parallelism does not fire on ordinary contrast", () => {
  // A sentence containing "not" is not the construction. The construction REJECTS a frame in order
  // to assert a replacement, and over-matching here would flag half of normal English.
  const fine = [
    "She was not in the room when we agreed it.",
    "The pilot did not survive procurement.",
    "I don't think the number holds, but I could be wrong about that.",
    "We tried three things and none of them moved the needle for that account.",
  ];
  for (const text of fine) {
    assert.equal(hits(text, "2C-2").length, 0, `false positive on: ${text}`);
  }
});

/* ── Repeated bullet sentences ───────────────────────────────────────────────────────────────── */

test("repeated bullets are caught by shared opening and by uniform length", () => {
  const sameOpening = [
    "- Stop guessing at the buyer's problem",
    "- Stop sending the deck before the call",
    "- Stop writing to everyone at once",
  ].join("\n");
  assert.ok(hits(sameOpening, "2C-17").length > 0, "missed three bullets opening on the same word");

  const uniform = [
    "- The first thing we changed was the timing of the call",
    "- The second thing we changed was the length of the deck",
    "- The third thing we changed was the person who ran it",
  ].join("\n");
  assert.ok(hits(uniform, "2C-17").length > 0, "missed three bullets of near-identical length");
});

test("uneven bullets are left alone", () => {
  const real = [
    "- We were late.",
    "- The CFO had already seen two vendors that week, and by the time we got the meeting she had "
      + "a shortlist she was not telling us about.",
    "- Nobody asked her what changed.",
  ].join("\n");
  assert.equal(hits(real, "2C-17").length, 0, "flagged a genuinely uneven list");

  // The same list with the marker Josh's drafter uses. Widening the marker class must not have
  // turned the rule into a blanket on anything indented.
  const arrows = real.replace(/^- /gm, "→ ");
  assert.equal(hits(arrows, "2C-17").length, 0, "the wider marker class flagged an uneven list");
});

test("a bullet is a bullet whichever marker it carries", () => {
  /*
   * Draft 90, 26 October. Eight blocks, each four bullets, every one opening "→ Pro:", "→ Con:",
   * "→ Effort to use:". 2C-17 is in HIGH_CONFIDENCE and create_draft refuses on it, so the draft
   * should never have been stored — and it was, because the marker class covered `- * • ‣` and a
   * numbered list, and he uses `→`. The ninth gate check reported "no list" about the same post
   * for the same reason. Josh was the third reader and the only one that could see the bullets.
   */
  const section = (n) => [
    `${n}. Method ${n}`,
    `→ A tool leaves a trace somewhere in the stack, and this is where method ${n} looks for it.`,
    "→ Pro: cheap, and quick to run against a long list of domains.",
    "→ Con: it misses the back-office tools entirely, which is most of them.",
    "→ Effort to use: easy.",
  ].join("\n");

  for (const marker of ["→", "➔", "»", "›", "▪", "·", "-", "*", "•"]) {
    const body = [1, 2, 3, 4].map((n) => section(n).replaceAll("→", marker)).join("\n\n");
    assert.ok(hits(body, "2C-17").length > 0, `the scanner cannot see "${marker}" as a bullet`);
  }
});

test("three repeated bullets report, four refuse", () => {
  // A deliberate loosening, because Josh's own formatting section asks for "sub-headers with
  // bullets under each" and a pros-and-cons list is parallel by nature. Three is still a finding;
  // only four or more may stop a draft being filed. See the note in aitells.mjs.
  const bullets = (n) =>
    Array.from({ length: n }, (_, i) => `→ Pro: reason number ${i + 1} that this one is worth it.`)
      .join("\n");

  const three = hits(bullets(3), "2C-17").filter((f) => /open with/.test(f.matched));
  const four = hits(bullets(4), "2C-17").filter((f) => /open with/.test(f.matched));

  assert.ok(three.length > 0, "three bullets opening on the same word should still be reported");
  assert.equal(three[0].blocking, false, "three should not be able to refuse a draft");
  assert.ok(four.length > 0, "four bullets opening on the same word should be caught");
  assert.notEqual(four[0].blocking, false, "four opening on the same word should refuse");
});

test("the bullet marker is spelled once", async () => {
  // shape.ts and aitells.mjs each had their own answer to "what is a bullet", the two disagreed,
  // and neither could see the marker that mattered. One definition now; assert there is no second.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("./aitells.mjs", import.meta.url), "utf8");
  assert.match(src, /BULLET_MARKER/, "aitells.mjs no longer uses the shared marker");
  assert.doesNotMatch(
    src,
    /\[-\*•/,
    "aitells.mjs has grown its own bullet character class again",
  );
});

/* ── The voice exemptions ────────────────────────────────────────────────────────────────────
 *
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * `potentially` and `might` are in voiceprint.contrast.signature_terms — words measured across
 * 11,022 words of his speech as ones he uses far more than the reference writers. Rule 2C-31 strips
 * padding hedges. Without the exemption, the first thing this scanner would do to a draft is remove
 * the two words that most reliably identify him, and the result would read cleaner and sound like
 * nobody.
 */

test("his own hedges are never flagged, and the exemption carries its evidence", () => {
  const text = "We might get there. Potentially by October, if the enrollment holds.";
  assert.equal(scan(text).findings.length, 0, "flagged his signature hedges");

  for (const e of EXEMPTIONS) {
    assert.ok(e.rule, `${e.term} exemption names no rule`);
    assert.match(e.evidence, /voiceprint/, `${e.term} exemption cites no evidence`);
  }
});

/* ── False-positive guards on the rules most likely to over-match ─────────────────────────────── */

test("a real post with specifics and a qualification comes back quiet", () => {
  // Deliberately written the way the standard asks: a scene, a named number, an admission, uneven
  // sentences. If the scanner flags this, it is punishing good writing.
  const good = [
    "The CFO stopped me four minutes into the deck.",
    "",
    "She had seen two vendors that week and she wanted to know one thing: who owned the number "
      + "after we left. I did not have a good answer. We had built the whole pitch around what the "
      + "tool did.",
    "",
    "We rebuilt it that night. The second version opened with the org chart, not the product.",
    "",
    "It worked, though I still think we got lucky on the timing.",
  ].join("\n");

  const found = scan(good).findings;
  assert.ok(
    found.length <= 1,
    `flagged good writing ${found.length} times: ${found.map((f) => `${f.rule} "${f.matched}"`).join("; ")}`,
  );
});

test("uniform sentence length ignores deliberate short stacks", () => {
  // The document's own good rewrite is three short sentences in a row. The rule targets a block of
  // 15-25 word sentences with no variance, which is the statistical tell — not staccato, which is a
  // device.
  assert.equal(hits("Teams struggle. Tools are fine. People are not.", "2C-5").length, 0);
});

test("all-positive tone is only judged on a whole post", () => {
  assert.equal(hits("We shipped it and it worked.", "2C-12").length, 0, "flagged a fragment");
});

/* ── Structural integrity of the rule set ────────────────────────────────────────────────────── */

test("every rule declares an id, a standing, a reason and a fix", () => {
  for (const r of RULES) {
    assert.ok(r.id, "a rule has no id");
    assert.ok(r.name, `${r.id} has no name`);
    assert.ok(r.why && r.why.length > 30, `${r.id} does not say why it matters`);
    assert.ok(r.fix && r.fix.length > 10, `${r.id} does not say how to fix it`);
    assert.equal(typeof r.detect, "function", `${r.id} has no detector`);
    /*
     * `standing`, added 28 October. scrub_draft's rewrite_discipline has always said "when a flag
     * is a judgement call, say so and leave it", and no finding carried a field that could say so
     * — the only machine-readable instruction was an imperative `fix` string, which is how "say
     * the plain thing instead" was applied to a client's verbatim words. judges.test.mjs holds the
     * rest of the invariant, including that no rule in HIGH_CONFIDENCE rests on a judgement.
     */
    assert.ok(
      r.standing === "mechanical" || r.standing === "judgement",
      `${r.id} declares standing "${r.standing}" — it must be mechanical or judgement`,
    );
  }
});

test("rule ids are unique", () => {
  const seen = new Set();
  for (const r of RULES) {
    assert.ok(!seen.has(r.id), `two rules both claim id ${r.id}`);
    seen.add(r.id);
  }
});

test("every high-confidence id is a real rule", () => {
  // measure_draft promotes these into its flags. An id here that no rule produces would be a
  // promotion that silently never happens.
  const ids = new Set(RULES.map((r) => r.id));
  for (const id of HIGH_CONFIDENCE) {
    assert.ok(ids.has(id), `${id} is marked high-confidence but no rule produces it`);
  }
});

test("the judgement rules are carried, not quietly dropped", () => {
  // These are in the source document and are deliberately not implemented. If they were removed
  // from the output entirely, a rule would have been deleted without anyone deciding to.
  assert.ok(JUDGEMENT.length >= 4);
  for (const j of JUDGEMENT) {
    assert.ok(j.id && j.ask, `${j.id ?? "a judgement rule"} is incomplete`);
    assert.ok(j.ask.length > 40, `${j.id} asks nothing useful`);
  }
  const asked = new Set(JUDGEMENT.map((j) => j.id));
  for (const id of ["2C-20", "2C-21", "2C-28", "2C-31"]) {
    assert.ok(asked.has(id), `${id} is neither detected nor asked about`);
  }
});

test("an empty draft does not throw", () => {
  assert.doesNotThrow(() => scan(""));
  assert.doesNotThrow(() => scan(null));
  assert.equal(scan("").counts.total, 0);
});

test("findings arrive in document order", () => {
  const text = [
    "Here's the thing: we were late.",
    "",
    "It's not the tools. It's the people.",
    "",
    "Let that sink in.",
  ].join("\n");
  const lines = scan(text).findings.map((f) => f.line);
  assert.deepEqual([...lines].sort((a, b) => a - b), lines, "findings are out of order");
});

/* ── The real corpus ─────────────────────────────────────────────────────────────────────────
 *
 * THE TEST THAT ACTUALLY FOUND SOMETHING.
 *
 * The first version of this used two posts written by hand for the purpose, and it passed while the
 * detectors were missing two whole forms of the headline rule. Hand-written fixtures test what the
 * author already thought of.
 *
 * These are verbatim from the database. Draft 53 is the hand-checked good one. Drafts 24 and 25 are
 * two of the twenty seeded for component test 8: deliberately generic, and — this is the part that
 * matters — deliberately FLUENT. They are not slop. They are the well-written posts that anyone
 * could have written, which is precisely the failure the whole system exists to catch.
 */

const DRAFT_53 = [
  "The CFO stopped me halfway through the deck.",
  "",
  "I was presenting a slide that had a book on it and a trailer for a film. They did not ask about "
    + "any of that. They asked what happens when the champion leaves.",
  "",
  "Then they answered it themselves: \"we start from zero\"",
  "",
  "It was just the CFO and me on the call, nobody else to perform to, which is probably why it "
    + "landed instead of turning into the kind of exchange where I defend the deck and everybody "
    + "moves on.",
  "",
  "I was angry. Frustrated, and hangry, and wanting to fight about it. Which is the tell. I do not "
    + "get angry at questions I can answer.",
  "",
  "I have done nothing about it since.",
].join("\n");

const FIXTURE_24 = [
  "Most founders get positioning wrong.",
  "",
  "They describe what they do instead of who it is for.",
  "",
  "Positioning is not a tagline. It is a decision about who you are not for",
].join("\n");

const FIXTURE_25 = [
  "Unpopular opinion: most sales training is a waste of money.",
  "",
  "Not because the content is wrong. Because the problem is rarely skill.",
  "",
  "Fix the upstream problem and the training becomes unnecessary.",
].join("\n");

test("the fluent-but-generic fixtures are caught on the headline rule", () => {
  // Both are negative parallelism in forms the first implementation missed: a NOUN subject
  // ("Positioning is not a tagline. It is...") and no "but" ("Not because X. Because Y.").
  assert.ok(hits(FIXTURE_24, "2C-2").length > 0, "missed the noun-subject form in fixture 24");
  assert.ok(hits(FIXTURE_25, "2C-2").length > 0, "missed the omitted-but form in fixture 25");
});

test("the hand-checked good draft comes back quiet", () => {
  // Draft 53 is the one written and checked line by line against the standard. If the scanner has
  // much to say about it, the scanner is wrong — not the draft.
  const found = scan(DRAFT_53).findings;
  assert.ok(
    found.length <= 1,
    `flagged the good draft ${found.length} times: ` +
    found.map((f) => `${f.rule} "${f.matched}"`).join("; "),
  );
  assert.equal(hits(DRAFT_53, "2C-2").length, 0, "false positive on the headline rule");
});

test("the scanner separates the good draft from the generic ones", () => {
  // The whole point. If these score alike the detectors are decorative.
  const good = scan(DRAFT_53).counts.total;
  for (const [label, text] of [["fixture 24", FIXTURE_24], ["fixture 25", FIXTURE_25]]) {
    assert.ok(
      scan(text).counts.total > good,
      `${label} scored ${scan(text).counts.total}, the good draft scored ${good}`,
    );
  }
});

test("a hashtag is caught, and a number reference is not", () => {
  // "No hashtags" sat in the banned-phrases section with no detector anywhere in the repo until
  // 26 October — the most trivially mechanical rule in the library and the one nothing enforced.
  for (const body of ["Worth a read. #B2BSales", "Closing thought.\n\n#outbound #gtm"]) {
    assert.ok(hits(body, "2C-32").length > 0, `missed a hashtag in: ${body}`);
  }

  // A hash is only a hashtag at the start of a word. Flagging these is how a check gets switched off.
  for (const body of [
    "That was my #1 priority last quarter.",
    "It was issue #42 in the tracker.",
    "She asked who owned the number after we left.",
  ]) {
    assert.equal(hits(body, "2C-32").length, 0, `false positive on: ${body}`);
  }
});

test("a dash is a dash in all four forms, and a hyphen is not", () => {
  /*
   * 2C-1 tested em and en only, while claims.ts and frameworks.mjs each treated a wider set as
   * dashes — so the check that REFUSES a draft was the narrowest of the three. Same shape as the
   * bullet-marker bug, different character class. PUNCTUATION_DASH is now shared.
   *
   * The exclusions are as load-bearing as the inclusions: a hyphen in "go-to-market" is not a tell,
   * and a minus in "−5" is arithmetic.
   */
  for (const [what, body] of [
    ["em dash", "We shipped it — and then it broke."],
    ["en dash", "We shipped it – and then it broke."],
    ["horizontal bar", "We shipped it ― and then it broke."],
    ["figure dash", "We shipped it ‒ and then it broke."],
  ]) {
    assert.ok(hits(body, "2C-1").length > 0, `${what} was not caught`);
  }

  for (const [what, body] of [
    ["hyphen", "Our go-to-market motion was fine."],
    ["non-breaking hyphen", "Our go\u2011to\u2011market motion was fine."],
    ["minus", "The number came back as \u22125 last week."],
  ]) {
    assert.equal(hits(body, "2C-1").length, 0, `${what} was flagged as a dash`);
  }
});
