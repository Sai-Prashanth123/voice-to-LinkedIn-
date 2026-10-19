/**
 * The declared sets and the surfaces that accept them, held together.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A STYLE RULE
 *
 * On 14 October a ninth gate check, `shape`, was added to GATE_CHECKS and to the gate_runs check
 * constraint. The closing branch in record_gate_verdict was correctly changed to require
 * GATE_CHECKS.length verdicts. The enum of key names the tool ACCEPTS was left at eight.
 *
 * The result was not a wrong answer, which a normal test catches. It was an unreachable state:
 * Claude Code could record at most eight distinct checks, closing needed nine, so gate_passed
 * stayed null on every draft from 14 to 19 October and mark_ready refused all of them. The tool
 * reported "0 check(s) still to record" while refusing to close. Nothing failed; nothing ran.
 *
 * Every assertion below compares one declaration against another place that has to agree with it.
 * None of them need a database or a network, so they run everywhere and cannot be skipped. A list
 * restated in two files is the defect; this is the test that notices.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { tools } from "./tools/index.mjs";
import { GATE_CHECKS } from "../supabase/functions/_shared/prompts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const tool = (name) => tools.find((t) => t.name === name);

test("record_gate_verdict accepts every check the gate is made of", () => {
  const schema = tool("record_gate_verdict").config.inputSchema.check_key;

  for (const check of GATE_CHECKS) {
    const parsed = schema.safeParse(check.key);
    assert.ok(
      parsed.success,
      `GATE_CHECKS declares "${check.key}" and record_gate_verdict will not accept it. ` +
      `A check that cannot be recorded can never be reached, so the gate can never close.`,
    );
  }
});

test("it accepts nothing the gate is not made of", () => {
  // The other direction matters too: a key the tool takes but the gate does not count is a verdict
  // written to a row that nothing will ever read back.
  const schema = tool("record_gate_verdict").config.inputSchema.check_key;
  assert.ok(!schema.safeParse("shapes").success, "a near-miss key must not be accepted");
  assert.ok(!schema.safeParse("").success, "an empty key must not be accepted");
});

test("the database accepts exactly the same set of keys", () => {
  // Grants and constraints are the real boundary. A key this tool takes and Postgres refuses is a
  // failure at the write door, after the judgement has already been made.
  const sql = readFileSync(join(HERE, "..", "supabase", "migrations", "0049_shape_check.sql"), "utf8");
  for (const check of GATE_CHECKS) {
    assert.ok(
      sql.includes(`'${check.key}'`) || check.key !== "shape",
      `the gate_runs constraint has no place for "${check.key}"`,
    );
  }
  assert.ok(sql.includes("'shape'"), "0049 is the migration that added shape; it must name it");
});

test("nothing counts the checks by a number written down twice", () => {
  /*
   * The arithmetic bug that hid the enum bug. `checks_remaining: 8 - done` reported zero remaining
   * at the eighth verdict while the branch above it still required nine, so the one surface that
   * could have revealed the problem stated the opposite. A literal count here is the same mistake
   * in waiting, whatever the current length happens to be.
   */
  const src = readFileSync(join(HERE, "tools", "write.mjs"), "utf8");
  const literal = /checks_remaining:\s*\d+\s*-\s*done/;
  assert.ok(
    !literal.test(src),
    "checks_remaining is counted from a literal. Count from GATE_CHECKS.length so the number " +
    "cannot disagree with the branch that uses it.",
  );
});

test("the arguable AI tells are attached by the tool that scanned the body", () => {
  /*
   * This block sat at the end of submit_candidates, which has no body to scan and no `tells` in
   * scope, so every successful call threw a ReferenceError AFTER cc-submit had stored the
   * candidates: the work landed and the tool reported failure. create_draft, meanwhile, never
   * reported a tell at all.
   *
   * guards.test.mjs asserted that write.mjs contains "ai_tells" and the misplaced copy satisfied
   * it, because a match against a module's source text cannot tell which function the text is in.
   * So this reads the handlers one at a time, which is the only way the question can be asked.
   */
  const owner = tools.find((x) => x.name === "create_draft");
  const ownerSrc = String(owner.handler);
  assert.ok(ownerSrc.includes("ai_tells"), "create_draft no longer reports the tells it scanned");
  assert.ok(ownerSrc.includes("scan("), "create_draft is not the one scanning the body");

  for (const x of tools) {
    if (x.name === "create_draft") continue;
    const src = String(x.handler ?? "");
    if (!src.includes("ai_tells")) continue;
    assert.ok(
      src.includes("scan("),
      `${x.name} returns ai_tells without scanning anything — pasted in from create_draft.`,
    );
  }
});

test("no message tells Josh the gate has a number of checks it no longer has", () => {
  /*
   * The enum was not the only place the count was written down. Three messages he actually reads
   * still said eight after the ninth check landed: "Only N of 8 checks have a verdict", "N of 8
   * checks flagged it", and the calendar notice. A count in prose drifts exactly the way a count in
   * a schema does, and it is worse, because it is the sentence he is reading when he decides
   * whether to trust the thing.
   *
   * Comment lines are dropped before reading. "judged on six of eight checks" in write.mjs is the
   * record of a real bug from September and must stay exactly as it is; what matters here is what
   * the code says OUT LOUD, so only the lines that can reach him are checked.
   */
  const files = [
    "../supabase/functions/cc-submit/index.ts",
    "../supabase/functions/_shared/handlers/gate.ts",
    "../supabase/functions/_shared/approve.ts",
    "./tools/write.mjs",
    "./tools/brief.mjs",
  ];

  const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

  for (const f of files) {
    const code = readFileSync(new URL(f, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !isComment(line))
      .join(" ");

    for (const bad of ["of 8 checks", "of eight checks", "run the eight checks"]) {
      assert.ok(
        !code.includes(bad),
        `${f} reports the gate size as a literal ("${bad}"). Count from GATE_CHECKS.length.`,
      );
    }
  }
});

test("nothing that instructs a session states the gate size as a word", () => {
  /*
   * The last place the count was written down, and the one that did the damage. The gate-check
   * skill said "After the eight" and "When all eight are in", CLAUDE.md and the connector's own
   * instructions said "the eight checks still run" — while CLAUDE.md's skill table said nine, two
   * lines apart. A session reading any of those would stop at the eighth verdict and believe it was
   * finished, which is exactly what happened from 14 to 19 October.
   *
   * The number belongs in one place. These files should say "the checks", and the brief and
   * checks_remaining say how many there are today.
   */
  const files = [
    "../CLAUDE.md",
    "./instructions.mjs",
    "../.claude/skills/gate-check/SKILL.md",
    "../.claude/skills/draft-post/SKILL.md",
    "../.claude/skills/josh-voice/SKILL.md",
  ];

  // "all eight are in", "the eight checks", "eight quality checks" — the forms that instruct.
  // Not a bare "eight" anywhere: this file's own comments discuss the bug, and "weight" exists.
  const instructing = /\b(all|the)\s+(eight|nine|ten)\s+(are|checks|quality)|\b(eight|nine|ten)\s+(quality\s+)?checks?\s+(still\s+)?(run|are|is)\b/i;

  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    // The one deliberate mention: the skill explains why it no longer says a number.
    const body = src.split("\n").filter((l) => !l.includes("would have told you to skip")).join("\n");
    const hit = body.match(instructing);
    assert.equal(
      hit,
      null,
      `${f} tells a session the gate is a fixed size ("${hit?.[0]}"). Say "the checks" and let ` +
      "checks_remaining carry the number.",
    );
  }
});
