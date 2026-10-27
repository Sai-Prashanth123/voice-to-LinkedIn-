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
    s.not_from_him.some((e) => /renames the reader's problem/.test(e)),
    "the group target dropped the exclusion that matters most",
  );
});

test("an explicit handle still overrides a group ask in his note", async () => {
  const r = await brief({ moment_id: 113, writer_handle: "mattjbarker1" });
  assert.equal(r.writer_shape.handle, "mattjbarker1");
  assert.match(r.user, /BUILD THIS ONE IN MATT BARKER'S SHAPE/);
});
