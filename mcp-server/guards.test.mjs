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
