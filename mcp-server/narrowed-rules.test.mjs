/**
 * The three detectors that were narrowed on 2 November, pinned in BOTH directions.
 *
 * Josh, 30 October: "it over-indexes on some rules where if something is repeating or it thinks is
 * repetitive, it'll try to cut it down… sometimes it becomes too strict with repeating things."
 *
 * Measured against the 1,839 posts by the eight writers he chose as his own models
 * (scripts/calibrate-aitells.mjs), these three rules refused 444 of them. They now refuse 83, with
 * the REPORTING rate unchanged — nothing is hidden from him, it simply stops blocking the draft.
 *
 * Each test below exists because the first attempt at the narrowing got it wrong in one direction
 * or the other, and every case here was run before it was written down. A rule that only loosens is
 * not a narrowing, it is a hole.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { scan, HIGH_CONFIDENCE } from "./aitells.mjs";

/** The one finding a rule produced about a body, or null. */
function finding(body, rule, match = /./) {
  return scan(body).findings.find((f) => f.rule === rule && match.test(f.matched)) ?? null;
}
const refuses = (f) => Boolean(f) && f.blocking !== false && HIGH_CONFIDENCE.has(f.rule);
const reports = (f) => Boolean(f) && f.blocking === false;

/* ── 2C-17, repeated bullet openings ──────────────────────────────────────── */

test("a content word repeated across four bullets still refuses", () => {
  // The shape the rule was written for. A real draft once had eight bullets opening on "Pro".
  const body = "- Pro plan wins\n- Pro users churn\n- Pro tier is cheap\n- Pro support lags";
  assert.ok(refuses(finding(body, "2C-17", /all open/)), "a scaffold must still be refused");
});

test("a CONTRACTED grammatical opener does not refuse", () => {
  /*
   * The first narrowing used FUNCTION_WORDS, and `tokens()` keeps apostrophes on purpose — "its"
   * and "it's" are not the same word. So every contraction missed the carve-out and still refused,
   * which is most of how people actually open a bullet. The fix shipped the comment, not the
   * behaviour, and only running it showed that.
   */
  for (const word of ["It's", "You're", "We've", "That's", "There's"]) {
    const body = [1, 2, 3, 4].map((n) => `- ${word} thing number ${n} here`).join("\n");
    const f = finding(body, "2C-17", /all open/);
    assert.ok(!refuses(f), `four bullets opening "${word}" must not refuse`);
    assert.ok(reports(f), `but "${word}" must still be reported — nothing is hidden`);
  }
});

test("an interrogative or a connective does not refuse", () => {
  // A list of parallel questions shares an interrogative and nothing else; the ITEMS are uneven,
  // which is what this rule's own rationale asks for.
  for (const word of ["What", "How", "When", "Then", "The"]) {
    const body = [1, 2, 3, 4].map((n) => `- ${word} different item ${n} entirely`).join("\n");
    assert.ok(!refuses(finding(body, "2C-17", /all open/)), `"${word}" must not refuse`);
  }
});

test("a stance word is NOT a grammatical opener and still refuses", () => {
  /*
   * The opposite error, and the reason FUNCTION_WORDS was the wrong set in both directions: it
   * contains "no", "every", "most", "first". "No budget / No timeline / No authority / No need" is
   * a staged parallel scaffold — exactly the construction this rule exists to catch — and the first
   * narrowing made it unrefusable.
   */
  const body = "- No budget\n- No timeline\n- No authority\n- No need";
  assert.ok(refuses(finding(body, "2C-17", /all open/)), "a stance word carries meaning");
});

test("three bullets report and never refuse, whatever the word", () => {
  // Josh's formatting section asks for sub-headers with bullets under each, and his own threshold
  // is four. Three is the pattern; four is the scaffold. That line is his (12.10).
  const body = "- Pro plan wins\n- Pro users churn\n- Pro tier is cheap";
  const f = finding(body, "2C-17", /all open/);
  assert.ok(reports(f), "three is reported");
  assert.ok(!refuses(f), "and never refused");
});

/* ── 2C-8, the formulaic reveal ───────────────────────────────────────────── */

test("a reveal that is its own sentence refuses, wherever it sits", () => {
  /*
   * His banned list names "Let me explain." and "Here's why." — sentences that announce a reveal
   * and deliver none. The first narrowing anchored them to the END OF A LINE, so any drafter
   * writing paragraphs instead of one-sentence lines escaped the rule entirely.
   */
  const endOfLine = "The rounds pile up.\n\nHere's why.\n\nThe draft was never mine.";
  const midParagraph = "That broke everything. Let me explain. The vendor had changed the API.";
  const afterBullet = "- Here's why.\n- Something else entirely here.";
  for (const [label, body] of [["line", endOfLine], ["paragraph", midParagraph], ["bullet", afterBullet]]) {
    assert.ok(refuses(finding(body, "2C-8")), `the named form must refuse (${label})`);
  }
});

test("a teaser that introduces the next clause reports and does not refuse", () => {
  /*
   * Josh said these words aloud on 30 October as his example of a GOOD opening — "Since doing this
   * one thing, they've improved 10x. Here's why." — while the system was refusing them. A colon
   * setup is one of the six tools in his own hooks section and 8% of the reference corpus.
   */
  const teaser = "They improved 10x. Here's why:\n\nThe draft was never mine.";
  assert.ok(reports(finding(teaser, "2C-8")), "a teaser into the next clause is not a dead line");

  const inSentence = "That is here's why the rounds pile up, probably.";
  assert.ok(!refuses(finding(inSentence, "2C-8")), "mid-sentence is not a reveal line either");
});

test("two reveals on one line are two findings, not one", () => {
  // The dedup keyed on line number, so a second real finding on the same line was dropped.
  const f = scan("Let me explain. Here's why.").findings.filter((x) => x.rule === "2C-8");
  assert.equal(f.filter((x) => x.blocking !== false).length, 2);
});

/* ── 2C-22, throat-clearing ───────────────────────────────────────────────── */

test("the throat-clears his library names refuse; the wider family reports", () => {
  // His section names "Here's the thing:" and "Here's what I learned:". It does not name
  // "Here's how I detect what software a company runs" — there the promise and the substance are
  // the same sentence. That wider reading refused 279 of his own reference writers' posts.
  assert.ok(refuses(finding("Here's the thing: nobody asked.", "2C-22")), "a named form refuses");
  const wider = finding("Here's how I work out what software a company runs.", "2C-22");
  assert.ok(reports(wider), "substance in the same sentence is reported, not blocked");
});

/* ── The normaliser that makes all of this work on real text ──────────────── */

test("a curly apostrophe behaves exactly like a straight one", () => {
  /*
   * Worth pinning rather than assuming. `scan()` runs `normaliseMarks` before any rule sees the
   * text, so "Here’s why." and "Here's why." are one input — a review of this code claimed
   * otherwise, having tested the raw regex outside the real path. Everything Josh pastes from a
   * phone or a word processor arrives curly.
   */
  const curly = "The rounds pile up.\n\nHere’s why.\n\nThe draft was never mine.";
  const straight = "The rounds pile up.\n\nHere's why.\n\nThe draft was never mine.";
  assert.ok(refuses(finding(curly, "2C-8")), "the curly form refuses");
  assert.equal(
    scan(curly).findings.length,
    scan(straight).findings.length,
    "and produces the same findings as the straight one",
  );
});
