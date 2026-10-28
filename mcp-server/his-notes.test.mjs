/**
 * Everything he said about a post, reaching the next draft of it.
 *
 * WHAT HAPPENED
 *
 * 27 October, moment 113. Four drafts in ninety minutes, three pushbacks, and `hook_opens_loop` and
 * `banned_phrases` failed on every single draft. He overrode the gate and approved the fourth.
 *
 * It looked like a writer that would not learn. It was a brief that forgot.
 *
 * `pushBack` puts his note in a `draft` job's payload (`_shared/pushback.ts:49`). `create_draft`
 * closes the job it answers. `get_drafting_brief` read that job filtered to `status = pending`. So
 * his note survived exactly one draft and then vanished from the brief for good:
 *
 *   job 353  03:11  "I don't think we need to mention the 20 company test"
 *   job 354  03:16  "no one cares about the data set… this audience doesn't care about that"
 *   job 355  03:31  "want to invite input from the readers of the post at the end"
 *
 * All three `status = done`. From draft 93 onward the brief carried not one of them, and the writer
 * was working from gate verdicts alone.
 *
 * These tests are the live case. Moment 113 is real and its three notes are real, so a regression
 * here is the same regression, not a fixture of one.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "./db.mjs";
import { tools } from "./tools/index.mjs";
import { REFERENCE_WRITERS, writerAskFrom } from "./writers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function credentials() {
  const read = (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const field = (t, k) => (t.match(new RegExp(`^${k}=(.*)$`, "m")) ?? [])[1]?.trim();
  const own = read(join(HERE, ".env"));
  const url = field(own, "SUPABASE_URL");
  const scoped = field(own, "CONTENT_MCP_KEY");
  if (url && scoped) return { url, key: scoped };
  const ev = read(join(HERE, "..", "eval", ".env"));
  const u = url ?? field(ev, "SUPABASE_URL");
  const k = field(ev, "SUPABASE_SERVICE_ROLE_KEY");
  return u && k ? { url: u, key: k } : null;
}

const creds = credentials();
let db = null;
const brief = (args) =>
  tools.find((t) => t.name === "get_drafting_brief").handler(args, { db, url: creds.url });

before(() => {
  assert.ok(creds, "needs mcp-server/.env or eval/.env to reach the project");
  db = createDb(creds);
});

/* ── Reading an ask for a writer out of what he actually said ────────────────── */

test("both of his real Sentinel asks are read as the group, not as one writer", () => {
  // His words, verbatim, from 26 and 27 October.
  for (const note of [
    "go look at the Sentinel accounts to see how others who have done lists like this would write it",
    "give me three go look at like what makes a good opening hook from the Sentinel accounts as well " +
      "as everything else you know",
  ]) {
    assert.deepEqual(writerAskFrom(note), { corpus: true }, note.slice(0, 40));
  }
});

test("a writer he names by surname, handle or full name resolves to that writer", () => {
  for (const w of REFERENCE_WRITERS) {
    assert.deepEqual(writerAskFrom(`do it the way ${w.surname} would`), { handle: w.handle });
    assert.deepEqual(writerAskFrom(`use ${w.handle} for this one`), { handle: w.handle });
    assert.deepEqual(writerAskFrom(`${w.name} does this well`), { handle: w.handle });
  }
});

test("a complaint about a writer is not a request for that writer", () => {
  /*
   * The worst available failure in this file, and the one a review caught before it shipped.
   *
   * "This reads like Matt Barker, stop" names Matt Barker, and the first version of writerAskFrom
   * took any mention as an ask. So a complaint that a draft sounded too much like him would have
   * answered by building the next draft in his shape — on every redraft of that moment, for up to
   * twelve notes. The library says his cadence is the likeliest to leak and that agreeing with him
   * proves nothing about Josh's voice (8.3), so this was not a neutral mistake.
   */
  for (const note of [
    "this reads like Matt Barker, stop",
    "too much like Barker",
    "don't copy Barker's turn",
    "it sounds like Matt Barker and it shouldn't",
    "less Carter",
    "avoid the Nowoslawski thing",
  ]) {
    assert.equal(writerAskFrom(note), null, `a complaint was read as a request: "${note}"`);
  }
});

test("the natural ways of ASKING for a writer are not read as complaints", () => {
  /*
   * The other half of the negation rule, and the half the first version got wrong.
   *
   * "reads like", "sounds like", "feels like" and "copying" carry no polarity — they are as much
   * a request as a complaint — and listing them as negative threw away the commonest phrasings.
   * The result was no shape at all, so the drafter fell back to the default framework: the exact
   * 26 October complaint, reintroduced by the fix for its opposite.
   */
  for (const [note, expected] of [
    ["make it sound like Barker", { handle: "mattjbarker1" }],
    ["make it read like Matt Barker", { handle: "mattjbarker1" }],
    ["I want this to feel like Julia Carter", { handle: "juliacarter98" }],
    ["copying Barker's structure is what I want", { handle: "mattjbarker1" }],
    ["make it sound like the Sentinel accounts", { corpus: true }],
  ]) {
    assert.deepEqual(writerAskFrom(note), expected, `a request was read as a complaint: "${note}"`);
  }
});

test("a negation belonging to the next clause does not cancel the ask", () => {
  /*
   * The forward window tested the whole negator set, and the words that follow a request are
   * usually the start of the next instruction. "Do it like Barker but don't open with a question"
   * is a request plus an unrelated rule, and it was being discarded.
   */
  for (const [note, expected] of [
    ["do it like Barker but don't open with a question", { handle: "mattjbarker1" }],
    ["go look at Barker and don't use a question", { handle: "mattjbarker1" }],
    ["less of the hook, more like Barker", { handle: "mattjbarker1" }],
    ["this is not working, go look at the Sentinel accounts", { corpus: true }],
  ]) {
    assert.deepEqual(writerAskFrom(note), expected, `an unrelated negation cancelled: "${note}"`);
  }
});

test("a negator anywhere in the same clause still cancels, however far away", () => {
  /*
   * The token-window version of this rule was wrong in both directions at once and there was no
   * number that fixed both. Six tokens back reached over a comma and threw away "less of the hook,
   * more like Barker"; four stopped short of the "don't" in "I don't want it to sound like
   * Barker" and asked for more of the cadence the library says is likeliest to leak.
   *
   * Distance was never the thing that separated them. The clause is.
   */
  for (const note of [
    "I don't want it to sound like Barker",
    "I do not want this to read like Matt Barker",
    "this is copied from Barker",
    "it copied Barker's turn",
  ]) {
    assert.equal(writerAskFrom(note), null, `a complaint was read as a request: "${note}"`);
  }
});

test("a negation in an earlier clause does not reach the ask", () => {
  // The other half of the same rule, and the one a fixed window kept breaking.
  for (const [note, expected] of [
    ["no questions, like Barker", { handle: "mattjbarker1" }],
    ["never a question, like Barker", { handle: "mattjbarker1" }],
    ["less hook, more like Barker", { handle: "mattjbarker1" }],
    ["no hook, sentinel accounts style", { corpus: true }],
  ]) {
    assert.deepEqual(writerAskFrom(note), expected, `an earlier clause cancelled: "${note}"`);
  }
});

test("a trailing 'instead' is how he asks, not how he complains", () => {
  // "instead" was listed as a trailing complaint. "use Barker instead" is one of the plainest
  // ways he could ask for a writer, and it was being discarded. Only "instead of" negates.
  assert.deepEqual(writerAskFrom("use Barker instead"), { handle: "mattjbarker1" });
  assert.deepEqual(writerAskFrom("go with Carter instead"), { handle: "juliacarter98" });
  assert.equal(writerAskFrom("do something instead of the Barker thing"), null);
});

test("ordinary English about eights and others is not a Sentinel ask", () => {
  /*
   * CORPUS_ASK matched "the eight", "other writers" and "others who have". His posts are often
   * numbered lists, so "the eight reasons are too many" is a note he could plausibly write about
   * any post — and it would have restructured every later draft toward a reference-writer band
   * while telling him, in the brief, that he had asked for it.
   */
  for (const note of [
    "the eight reasons are too many, keep the top three",
    "others who have run SDR teams will disagree",
    "other writers would hate this",
    "eight is too many bullets",
  ]) {
    assert.equal(writerAskFrom(note), null, `an ordinary phrase was read as an ask: "${note}"`);
  }
});

test("the newest note wins, not the order of the writer list", () => {
  /*
   * The notes used to be joined into one string, so the answer came from the order of
   * REFERENCE_WRITERS — Matt Barker is first — rather than from when he said it. An instruction he
   * has since replaced is not an instruction.
   */
  assert.deepEqual(
    writerAskFrom(["build it the way Carter opens", "earlier: go look at Barker"]),
    { handle: "juliacarter98" },
  );
  assert.deepEqual(
    writerAskFrom(["go look at the Sentinel accounts", "do it like Barker"]),
    { corpus: true },
  );
});

test("a note that complains about one writer can still ask for the group", () => {
  // Judged per sentence, so one note holding both resolves to the thing he actually asked for.
  assert.deepEqual(
    writerAskFrom("I liked the Sentinel accounts idea. But this reads too much like Barker."),
    { corpus: true },
  );
});

test("a named writer beats a group reference in the same note", () => {
  // The more specific instruction wins. Otherwise "look at the Sentinels, especially Barker"
  // silently loses the only part of it that narrows anything.
  assert.deepEqual(
    writerAskFrom("look at the Sentinel accounts, especially how Barker opens"),
    { handle: "mattjbarker1" },
  );
});

test("a note about anything else asks for nothing", () => {
  for (const note of [
    "Heads of sales development is very specific. What about Managers of SDRs",
    "no one cares about the data set, role count looked wrong, managers outnumbered reps",
    "",
    null,
    undefined,
  ]) {
    assert.equal(writerAskFrom(note), null, String(note).slice(0, 40));
  }
});

/* ── The brief carries them, and keeps them apart from the gate's verdicts ───── */

test("every note he left on the moment reaches the brief, not only the open one", async () => {
  const r = await brief({ moment_id: 113 });

  assert.ok(Array.isArray(r.user.match(/WHAT HE HAS ALREADY TOLD YOU ABOUT THIS POST/)),
    "his notes block is absent — the brief has forgotten again");

  // All three. The count is the assertion: two of these jobs are `done`, and reading only the
  // pending one is the exact bug.
  for (const fragment of [
    "20 company test",
    "no one cares about that",
    "invite input from the readers",
  ]) {
    assert.ok(r.user.includes(fragment), `his note is missing from the brief: "${fragment}"`);
  }
});

test("his instruction is not filed under what the gate rejected", async () => {
  /*
   * One is an instruction and the other is a verdict. Folding his words into "It failed on:" tells
   * the writer he was wrong about something he asked for.
   */
  const r = await brief({ moment_id: 113 });
  const hisBlock = r.user.indexOf("WHAT HE HAS ALREADY TOLD YOU");
  const failedOn = r.user.indexOf("It failed on:");
  assert.ok(hisBlock >= 0, "no block of his own words");
  if (failedOn >= 0) {
    const between = r.user.slice(hisBlock, failedOn);
    assert.ok(
      between.includes("These are INSTRUCTIONS"),
      "his words and the gate's verdicts are not kept apart",
    );
  }
});

test("the brief tells the caller a shape it was not asked for came from his note", async () => {
  const unasked = await brief({ moment_id: 113 });
  assert.equal(unasked.writer_shape?.asked_by, "his_note");

  const asked = await brief({ moment_id: 113, writer_handle: "mattjbarker1" });
  assert.equal(asked.writer_shape?.asked_by, "this_call");
});

/* ── The group ask is answered with a band, never with one writer ─────────────── */

test("a Sentinel ask hands over the eight as a range and names no one as the model", async () => {
  const r = await brief({ moment_id: 113 });
  const s = r.writer_shape;

  assert.equal(s.handle, null, "a group ask resolved to a single writer");
  assert.match(s.name, /the eight together/);
  assert.match(r.user, /BUILD THIS ONE THE WAY THE EIGHT HANDLE IT/);

  // The band, and the warning that its middle is nobody's habit.
  assert.ok(s.targets.some((t) => /ABOVE THE FOLD: they run \d+ to \d+ words/.test(t)));
  assert.ok(s.targets.some((t) => /THE RANGE IS NOT A TARGET/.test(t)));

  // Barker is in the set, so the one construction Josh's library forbids must travel with it.
  assert.ok(
    s.not_from_this_writer.some((e) => /renames the reader's problem/.test(e)),
    "the group target dropped the exclusion that matters most",
  );
});

test("an explicit handle still overrides a group ask in his note", async () => {
  const r = await brief({ moment_id: 113, writer_handle: "mattjbarker1" });
  assert.equal(r.writer_shape.handle, "mattjbarker1");
  assert.match(r.user, /BUILD THIS ONE IN MATT BARKER'S SHAPE/);
});
