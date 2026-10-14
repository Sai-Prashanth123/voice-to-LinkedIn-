/**
 * Three guards, each one added after something got through.
 *
 * None of these is a new standard. Each is an existing rule that had no way of stopping anything:
 * a filter nobody applied, a check nobody had to read, a counter nobody incremented. They are
 * together because they share a shape — the system knew the right answer and had no mechanism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { wrap } from "./server.mjs";
import { tools } from "./tools/index.mjs";
import { HIGH_CONFIDENCE, scan } from "./aitells.mjs";

const call = async (tool, args) => {
  const result = await wrap(tool, {})(args);
  return { isError: Boolean(result.isError), text: result.content[0].text };
};

/* ── 1. An argument a tool does not have ──────────────────────────────────── */

test("a wrong parameter name is refused, not dropped", async () => {
  /*
   * get_reference_posts takes `handle`. Asked for `writer: "mattjbarker1"` it returned the newest
   * posts across all eight writers — four other people, no error, no note that the filter had not
   * applied. That is very likely how Josh reported in September that testing Matt Barker "returned
   * nothing": he was handed somebody else every time.
   */
  const tool = {
    name: "get_reference_posts",
    config: { inputSchema: { handle: {}, limit: {}, since: {}, search: {} } },
    handler: () => ({ posts: ["everyone's"] }),
  };

  const bad = await call(tool, { writer: "mattjbarker1" });
  assert.equal(bad.isError, true, "an unknown argument was accepted");
  assert.match(bad.text, /no argument "writer"/);
  // It says what the tool does take, because the next thing the caller needs is the right name.
  assert.match(bad.text, /handle/);
  assert.match(bad.text, /dropped rather than/);

  const good = await call(tool, { handle: "mattjbarker1" });
  assert.equal(good.isError, false, good.text);
});

test("the guard covers every tool, not the one that was caught", async () => {
  // Checked at dispatch on purpose: the next tool to grow a filter would have the same hole.
  const src = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  assert.match(src, /inputSchema/, "the dispatch no longer reads the declared arguments");

  const noArgs = { name: "health", config: { inputSchema: {} }, handler: () => ({ ok: true }) };
  const r = await call(noArgs, { anything: 1 });
  assert.equal(r.isError, true);
  assert.match(r.text, /takes no arguments/);
});

test("a tool that genuinely takes nothing still works when given nothing", async () => {
  const noArgs = { name: "next_action", config: { inputSchema: {} }, handler: () => ({ next: {} }) };
  assert.equal((await call(noArgs, {})).isError, false);
  assert.equal((await call(noArgs, undefined)).isError, false);
});

/* ── 2. A mechanical tell, filed past ─────────────────────────────────────── */

test("create_draft refuses the tells where the construction is simply wrong", () => {
  /*
   * scrub_draft costs nothing and flagged the filler word "actually". The draft was filed anyway,
   * and draft 73 is in the database with a word from his own banned list in it. Reading a warning
   * and not acting on it is a choice a model makes constantly, so the warning is no longer the only
   * thing standing there.
   */
  const src = readFileSync(new URL("./tools/write.mjs", import.meta.url), "utf8");

  assert.match(src, /HIGH_CONFIDENCE/, "create_draft does not check the mechanical tells");
  assert.match(src, /scan\(args\.body\)/, "create_draft never scans the body");
  // Refuses before it posts, so nothing is stored.
  assert.ok(
    src.indexOf("HIGH_CONFIDENCE.has") < src.indexOf("functions/v1/cc-submit"),
    "the tell check runs after the draft has already been sent",
  );
});

test("it refuses only the mechanical ones, and reports the arguable ones", () => {
  const src = readFileSync(new URL("./tools/write.mjs", import.meta.url), "utf8");

  // Everything else travels back with the draft id rather than blocking it. A filler word is a
  // judgement — "delete it and read the sentence again" — and a check that cannot be overruled on
  // a judgement is one that will eventually be wrong with no way back.
  assert.match(src, /ai_tells/, "the non-blocking findings are not returned to the caller");
  assert.match(src, /ai_tells_mean/, "the findings come back with no explanation of their standing");

  // The subset that blocks is the one already defined as "the construction is simply wrong".
  assert.ok(HIGH_CONFIDENCE.size > 0);
  const filler = scan("So the method is actually unglamorous.").findings;
  assert.ok(filler.length > 0, "the scanner no longer catches a filler word");
  assert.ok(
    filler.every((f) => !HIGH_CONFIDENCE.has(f.rule)),
    "a filler word now blocks a draft — it is a judgement and should only be reported",
  );
});

/* ── 3. The counter that never moved ──────────────────────────────────────── */

test("the attempt number is read off the record when no job carries one", () => {
  /*
   * It came off the waiting rewrite job. In one_step mode the gate is advisory, finishGate skips
   * retryOrPark, no job is ever queued, and so three drafts of moment 101 all recorded attempt 1.
   * 9.8 counts attempts, so with the counter frozen the clause cannot fire in the mode Josh uses.
   */
  const src = readFileSync(
    new URL("../supabase/functions/cc-submit/index.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    src,
    /const attempt = Number\(payload\.attempt \?\? 1\)/,
    "the attempt still defaults to 1 whenever no job exists",
  );
  assert.match(src, /rejectedBefore/, "the attempt is not derived from the drafts already rejected");
  // The job still wins where there is one, or a caller could reset the count by saying "attempt 1".
  assert.match(src, /payload\.attempt !== undefined/);
  assert.match(src, /gate_passed", false/);
});

test("counting an attempt is not the same as parking the idea", () => {
  // Advisory mode deliberately does not park: the decision is his. The counter is for the record
  // and for telling him it is the third go, not for taking the choice away.
  const gate = readFileSync(
    new URL("../supabase/functions/_shared/handlers/gate.ts", import.meta.url),
    "utf8",
  );
  assert.match(gate, /retryOrPark/, "the interviewed path no longer parks on three failures");
  assert.match(
    gate,
    /advisory/i,
    "the advisory branch is gone, so a failing draft would be withheld from him again",
  );
});

test("the refusal happens where the argument still exists", () => {
  /*
   * The first version of this guard was in wrap(), and it did nothing. The MCP SDK parses
   * params.arguments against the tool's zod shape before any handler runs, and a non-strict zod
   * object strips what it does not recognise — so by the time wrap() sees the arguments the unknown
   * key is already gone. Deployed, asked again with `writer`, and got four other writers back.
   *
   * The raw body is the last place the real request exists.
   */
  const http = readFileSync(new URL("./http.mjs", import.meta.url), "utf8");

  assert.match(http, /refuseUnknownArguments/, "the HTTP path no longer checks the arguments");
  assert.match(http, /request\.clone\(\)/, "it reads the body without leaving it for the transport");
  // Before the transport, or the SDK has already stripped the key.
  assert.ok(
    http.indexOf("refuseUnknownArguments(request") < http.indexOf("transport.handleRequest"),
    "the check runs after the transport has taken the request",
  );
  // One definition of what counts as unknown, shared with wrap().
  assert.match(http, /unknownArguments/, "http.mjs decides for itself what an unknown argument is");
});

/* ── 4. Writing from the disk instead of the library ──────────────────────── */

test("no skill tells a drafter to read the law files", () => {
  /*
   * josh-voice step 1 said "Read the law set. All five files are short." On 14 Oct Josh watched a
   * session do it and report back: "I didn't call the voice brief, I read through the voice files
   * from this instead", "the voice guide arrived on the voice files on disk", and "the frameworks I
   * used the three structures from the file on disk rather than the library's own version". He also
   * watched it skip three of the six files it had just been told to read.
   *
   * The same skill states the precedence — for anything the gate will judge, the library wins — so
   * it was instructing the model to do the thing it then told it not to rely on.
   */
  const skill = readFileSync(
    new URL("../.claude/skills/josh-voice/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    skill,
    /\*\*Read the law set\.\*\*/,
    "the skill still opens by sending the drafter to the files on disk",
  );
  assert.match(skill, /get_voice_brief/, "the skill no longer names the tool that replaces it");
  // The files are still there and still worth reading about him. They are not an input to a draft.
  assert.match(skill, /Not an input to a draft|not for writing as him/i);
});

test("the law files stay readable by the code that imports them", () => {
  // voiceprint.json and law.json are imported by resources.mjs, measure.mjs and voice.mjs. Demoting
  // the markdown must not have touched those, or measure_draft loses its contrast numbers.
  for (const f of ["resources.mjs", "tools/measure.mjs", "tools/voice.mjs"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.match(src, /voiceprint\.json/, `${f} no longer reads the measured voiceprint`);
  }
});

/* ── 5. The shape warning that comes before the gate run ──────────────────── */

test("a wall of text is flagged before a gate run is spent on it", async () => {
  /*
   * The ninth gate check judges shape properly, against the writers' measured range. This is the
   * free look first — measure_draft costs nothing and a writer who sees it has already fixed the
   * post before any model is paid to read it.
   *
   * Two things were missing. `above_fold_words` — the three lines LinkedIn shows before "see more",
   * the single most shape-relevant number there is — was computed in measurePost and never
   * returned here. And rule 2C-16, the one rule about paragraphs, returned nothing when there were
   * fewer than three: a post written as one block was structurally exempt from the rule about
   * blocks.
   */
  const measure = tools.find((t) => t.name === "measure_draft");
  const wall = "Every tool I run is on trial, including the ones I would defend. ".repeat(6);

  const r = await measure.handler({ body: wall }, {});

  assert.equal(r.shape.paragraphs, 1);
  assert.ok(r.shape.above_fold_words > 0, "above_fold_words is still not returned");
  assert.match(r.shape.against_the_writers.paragraphs, /they run \d/);
  assert.ok(
    r.flags.some((f) => /One paragraph/.test(f)),
    "a wall of text produced no flag",
  );
});

test("a short deliberate post is not flagged for being short", async () => {
  // One of his writers runs a median of four paragraphs and seventeen words above the fold. The
  // rule has no opinion about a two-sentence post, and must not grow one.
  const measure = tools.find((t) => t.name === "measure_draft");
  const r = await measure.handler({ body: "Two sentences. That is all." }, {});

  assert.ok(!r.flags.some((f) => /One paragraph/.test(f)), "a short post was flagged as a wall");
  assert.equal(scan("Two sentences. That is all.").findings.filter((f) => f.rule === "2C-16").length, 0);
});

test("the wall-of-text rule reports and does not block", () => {
  // Reportable, not in HIGH_CONFIDENCE. Shape is a judgement the ninth check makes with the
  // writers' numbers in front of it; create_draft refusing on it would be this tool having an
  // opinion it has no basis for.
  assert.equal(HIGH_CONFIDENCE.has("2C-16"), false);
  const wall = "Every tool I run is on trial, including the ones I would defend. ".repeat(6);
  assert.ok(scan(wall).findings.some((f) => f.rule === "2C-16"), "the rule no longer fires at all");
});

/* ── 6. The one entry point into the learning loop ────────────────────────── */

test("a proposal is shaped the way the table will accept", () => {
  /*
   * propose_library_change sent `evidence` as an array. The table's constraint
   * `proposals_evidence_not_empty` checks `jsonb_typeof(evidence) = 'object'`, so every call this
   * tool ever made was refused by the database — and nobody knew, because nothing had used it. All
   * nine proposals on file were written by the sentinel refresh script, which happens to build an
   * object.
   *
   * So clause 12.10 — the system proposes and Josh decides — had one entry point for a model and it
   * could not insert a row.
   */
  const src = readFileSync(new URL("./tools/write.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('name: "propose_library_change"'));

  assert.doesNotMatch(
    block.slice(0, block.indexOf("return {")),
    /evidence: args\.evidence,/,
    "the evidence array is still passed straight to a column that requires an object",
  );
  assert.match(block, /evidence: \{ kind:/, "the evidence is no longer wrapped in an object");

  // The constraint itself, quoted from the migration, so this test fails if the table changes.
  const migration = readFileSync(
    new URL("../supabase/migrations/0004_reference_library.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /jsonb_typeof\(evidence\) = 'object'/);
});
