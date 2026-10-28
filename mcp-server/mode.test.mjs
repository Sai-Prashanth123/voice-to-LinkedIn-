/**
 * The writing mode, and the one place it was read by the code but not by the advice.
 *
 * Josh asked on 13 October 2026 to stop being interviewed and to stop having old ideas pulled out
 * of the bank. Three mechanisms were changed to obey him — capture, the selection worker and
 * next_work — and `next_action` was not. That tool is the second call of every session by
 * CLAUDE.md's own instruction, and it answered "answer the interview on 1 candidate" for as long
 * as a candidate existed. A session that followed its own start-here instructions would have put
 * the complaint straight back to him, with every mechanism underneath working perfectly.
 *
 * So this file tests the advice, not the mechanism: that in one_step mode nothing next_action says
 * sends the session into the idea bank, that the ideas are still counted so none of them look
 * deleted, and that turning the mode off brings the interview advice back unchanged. The last one
 * matters most — "for the time being" is what he actually said.
 *
 * Offline by construction: the db is a stub, so this runs in CI with no credentials.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// The registry first: onestep.mjs imports it to reuse the other tools' handlers, and it imports
// onestep.mjs back, so importing onestep on its own hits the cycle mid-evaluation. The registry is
// also the honest way to reach a tool — it is how the server reaches it.
import { tools } from "./tools/index.mjs";
import { inspectTools } from "./tools/inspect.mjs";
import { modeName, ONE_STEP_MODE } from "./mode.mjs";

const nextAction = inspectTools.find((t) => t.name === "next_action");

/** A project with one of everything the idea bank can hold, and one draft waiting on Josh. */
function stub({ oneStep }) {
  return {
    async request(path) {
      if (path.includes("status=eq.mined")) return [{ id: 70 }];
      if (path.includes("status=eq.half_mined")) return [{ id: 71, title: "half answered" }];
      if (path.includes("status=eq.captured")) return [{ id: 89, title: "Champion mover" }];
      if (path.startsWith("/drafts") || path.includes("drafts?")) return [{ id: 63 }];
      if (path.includes("posts?")) return [{ id: 16 }];
      if (path.includes("library_proposals")) return [{ id: 9 }];
      throw new Error(`unexpected read: ${path}`);
    },
    async select(table, opts) {
      assert.equal(table, "settings");
      assert.equal(opts.key, `eq.${ONE_STEP_MODE}`);
      return [{ value: oneStep }];
    },
  };
}

const every = (result) => [result.next, ...result.then];

test("in one_step mode nothing it says sends the session into the idea bank", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: true }) });

  assert.equal(result.mode, "one_step");

  const said = JSON.stringify(every(result));
  for (const forbidden of ["next_interview_question", "answer_interview", "next_work"]) {
    assert.ok(!said.includes(forbidden), `one_step mode still points at ${forbidden}`);
  }
  // "Answer the interview on 1 candidate" was the exact wording that would have reached him.
  assert.ok(!/Answer the interview/i.test(said));
  assert.ok(!/Draft 1 mined moment/i.test(said));

  // Still the most useful thing: the draft he has not judged.
  assert.match(result.next.do, /Review 1 post/);
  // And a library decision is his either way — it is not an idea-bank action.
  assert.ok(every(result).some((a) => /library proposal/.test(a.do)));
});

test("the held ideas are still counted, so nothing looks deleted", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: true }) });

  assert.deepEqual(result.counts, {
    ready_to_draft: 1,
    awaiting_interview: 1,
    just_arrived: 1,
    drafts_waiting_on_josh: 1,
    open_proposals: 1,
    drafts_total: 1,
  });

  // And it says so in words, once, as a fact rather than a task.
  const note = every(result).find((a) => /held in the bank/.test(a.do));
  assert.ok(note, "one_step mode never mentions that the ideas are kept");
  assert.equal(note.do, "3 idea(s) are held in the bank and nothing will be drafted from them");
  assert.match(note.where, /do not start an interview/);
  assert.match(note.why, /set_writing_mode/);
});

test("with the mode off the interview advice comes back, unchanged", async () => {
  const result = await nextAction.handler({}, { db: stub({ oneStep: false }) });

  assert.equal(result.mode, "interviewed");

  const said = JSON.stringify(every(result));
  assert.ok(said.includes("next_interview_question"));
  assert.ok(said.includes("next_work"));
  assert.match(said, /Answer the interview on 1 candidate/);
  // The one_step note is a one_step thing and must not leak into the other mode.
  assert.ok(!/held in the bank/.test(said));
});

test("the two runtimes spell the mode the same way", () => {
  assert.equal(modeName(true), "one_step");
  assert.equal(modeName(false), "interviewed");
  assert.equal(ONE_STEP_MODE, "one_step_mode");
});

/*
 * And the third route to the same silence, which is not about advice but about composition.
 *
 * A thin paste parks itself in applyExtraction, correctly. get_drafting_brief does not refuse a
 * parked moment, only a killed one. list_calendar withholds drafts sitting on parked ideas from
 * his review, also correctly. Composed, those three gave him a post written from material the
 * system had already judged too thin, and then hid it from him — he pastes something and nothing
 * comes back, which is the sentence he wrote in to complain about.
 */
test("a parked paste stops the chain and comes back as a sentence, not a silence", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      name: "a thin one",
      status: "parked",
      note: "Applied, and the moment parked itself: There is a moment here but nothing you took " +
        "from it yet. It reopens the moment he adds to it.",
      uncleared_names: [],
    }),
  });

  try {
    const writePost = tools.find((t) => t.name === "write_post");

    // This db answers the settings read and throws on anything else, so reaching the drafting
    // brief — which reads the library, the material and the names — fails the test by itself.
    const db = {
      async select(table) {
        assert.equal(table, "settings", "write_post read a table after a park");
        return [{ value: true }];
      },
      async request(path) {
        throw new Error(`write_post kept going after a park and read ${path}`);
      },
    };

    /*
     * THE FOUR NON-TEXT FIELDS ARE PART OF THE SCENARIO, NOT PADDING — DO NOT "TIDY" THEM.
     *
     * This fixture was `{ the_moment: "something happened" }` alone, and it only parsed because
     * `write_post` declared `extracted` as a record of strings. That schema is what broke the name
     * guard for fifteen days (see extraction-shape.mjs), so the shape is now the real one and
     * `viaTool` parses against it.
     *
     * Each value is the thin paste this test is about:
     *   strength: 1          — the park guard at interview.ts reads this and fires at 2 or less.
     *                          Raised to a 3 by someone making it look tidier, the guard stops
     *                          firing and this test passes while asserting nothing.
     *   audience_known:false — the paste genuinely does not say who it is for, and false is the
     *                          honest answer rather than a guessed reader (5.6).
     *   audience_is_buyer / time_sensitive: false — neither is claimed by the paste.
     */
    const result = await writePost.handler(
      {
        moment_id: 99,
        extracted: {
          the_moment: "something happened",
          audience_known: false,
          audience_is_buyer: false,
          strength: 1,
          time_sensitive: false,
        },
      },
      { db, url: "https://example.supabase.co", key: "test" },
    );

    assert.equal(result.wrote_nothing, true);
    assert.equal(result.drafting_brief, undefined, "it returned a brief for a parked idea");
    assert.match(result.why, /parked itself/);
    assert.match(result.tell_him, /not enough in it/);
    assert.match(result.to_continue, /Nothing is lost/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every tool next_action sends the caller to actually exists", () => {
  // `decide_draft` sat in the top-line answer for weeks. It is not a tool, a command or a skill, so
  // the single most useful action in the system named something that does not exist. Checked by
  // source rather than by reading, because that is how it survived being read.
  const source = readFileSync(new URL("./tools/inspect.mjs", import.meta.url), "utf8");
  const registered = new Set(tools.map((t) => t.name));
  const commands = new Set(
    readdirSync(new URL("../.claude/commands/", import.meta.url)).map((f) => f.replace(/\.md$/, "")),
  );

  // Every `where:` line in next_action, as the caller reads it.
  const block = source.slice(source.indexOf('name: "next_action"'), source.indexOf('name: "list_proposals"'));
  const wheres = [...block.matchAll(/where:\s*((?:"[^"]*"\s*\+?\s*)+)/g)]
    .map((m) => m[1].replace(/"\s*\+\s*"/g, "").replace(/"/g, "").trim());
  assert.ok(wheres.length >= 3, `only found ${wheres.length} where: lines — did the shape change?`);

  for (const where of wheres) {
    // Tool-shaped words: snake_case, which is how every tool in this server is named.
    for (const word of where.match(/\b[a-z][a-z_]*_[a-z_]+\b/g) ?? []) {
      assert.ok(
        registered.has(word),
        `next_action sends the caller to "${word}", which is not a registered tool`,
      );
    }
    // And slash commands, which are files on disk.
    for (const slash of where.match(/\/([a-z-]+)/g) ?? []) {
      assert.ok(
        commands.has(slash.slice(1)),
        `next_action sends the caller to "${slash}", which is not a command in .claude/commands/`,
      );
    }
  }
});

test("no tool tells the caller the server will judge a draft for them", () => {
  /*
   * create_draft's description said "Once filed, the server runs the eight quality checks by
   * itself; do not run them yourself" long after that stopped being true. gate_runs_in_claude
   * defaults to true, so the server files the draft and judges nothing. A caller that obeyed the
   * description filed a draft and walked away, and 10 of the first 59 drafts carry no verdict at
   * all — Josh found that pile before we did.
   *
   * The skill said the right thing. The one-step tools said the right thing. The tool description
   * said the opposite, and a tool description is what a model reads first.
   */
  const create = tools.find((t) => t.name === "create_draft");
  const text = `${create.config.description} ${create.config.title}`;

  assert.doesNotMatch(
    text,
    /do not run (them|the (eight )?checks) yourself/i,
    "create_draft still tells the caller not to run the checks",
  );
  assert.doesNotMatch(
    text,
    /the server runs the eight/i,
    "create_draft still claims the server runs the gate",
  );
  assert.match(text, /gate-check skill/, "create_draft does not say who runs the gate");
  assert.match(text, /fresh context/i, "create_draft does not say to judge in a separate context");
});

test("the gate's instruction surfaces agree on who judges, and name something reachable", () => {
  /*
   * THIS USED TO ASSERT THE WORDS "gate-check skill", AND THE WORDS WERE THE BUG.
   *
   * The invariant is that every surface telling a caller to judge agrees on who does it, so the
   * model does not read "the server will" in one place and "you will" in another. That part is
   * unchanged and is what caught 10 unjudged drafts.
   *
   * What was wrong was pinning it to the SKILL. Skills live in `.claude/skills/` and exist only in
   * a clone of this repo. Josh has never used a clone — every session he has ever run went through
   * the hosted connector — so "run the gate-check skill" is, on the only surface he has, an
   * instruction naming nothing. The hook and cc-agent genuinely drive the skill and are right to
   * name it; a tool description served over the wire is not.
   *
   * So the assertion is now: an MCP-served surface names the TOOL. Naming the skill as well is
   * fine and is what a clone should read. A surface that names ONLY the skill is the divergence,
   * and it is the one this test could not previously see.
   */
  const skill = readFileSync(
    new URL("../.claude/skills/draft-post/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /gate-check/, "the draft-post skill no longer names the gate-check skill");

  // Checked by source because each of these says it in what it hands back, not in a schema.
  const served = [
    ["tools/onestep.mjs", "write_post", /get_gate_brief/],
    ["tools/write.mjs", "create_draft", /get_gate_brief/],
    ["instructions.mjs", "the server's own instructions", /get_gate_brief/],
    ["tools/inspect.mjs", "next_action", /next_work|get_drafting_brief/],
  ];

  for (const [file, what, reachable] of served) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(
      src,
      reachable,
      `${what} (${file}) tells a caller to judge or to draft without naming a tool. On the hosted ` +
      `connector a skill name is not a route — it is a sentence that cannot be acted on.`,
    );
  }
});
