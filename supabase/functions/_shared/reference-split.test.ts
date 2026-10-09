/**
 * The posts are held. They must never reach a draft.
 *
 * Until 9 October this system stored none of the reference writers' text, so a draft could not quote
 * what did not exist. Josh asked for the posts — "I tried testing with Matt Barker and it returned
 * nothing, and I can't get to the posts through Claude Code" — and he was right to. They are stored
 * now and he reads them with `get_reference_posts`.
 *
 * That moves the protection from an absence of data to a rule in code, which is weaker, so the rule
 * needs a test. The rule: the DRAFTING and GATE views of the library carry measurements and never
 * sentences. A drafter given another writer's prose writes a pastiche; a gate that has read their
 * posts starts judging Josh against their voice, which is the one thing clause 8.3 names.
 *
 * If this test ever fails, the thing to check is not the test. It is whether his last few drafts
 * sound like somebody else.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIEWS } from "./views.ts";

/* ── What the views are allowed to contain ────────────────────────────────── */

test("the drafting and gate views are defined, and differ", () => {
  // The whole arrangement rests on these being two different things. If they ever became the same
  // list, the gate would be reading what the drafter read and nobody would notice.
  assert.ok(VIEWS.drafting, "no drafting view");
  assert.ok(VIEWS.gating, "no gate view");

  const drafting = new Set(VIEWS.drafting);
  const gate = new Set(VIEWS.gating);

  const onlyDrafting = [...drafting].filter((k) => !gate.has(k));
  assert.ok(
    onlyDrafting.length > 0,
    "the gate sees everything the drafter sees — the voice transcript split has collapsed",
  );
});

test("the voice transcript stays out of the gate's view", () => {
  // The precedent this whole split follows: the drafter may hear how Josh sounds; a judge that has
  // read the evidence judges against the evidence.
  assert.ok(VIEWS.drafting.includes("voice_transcript"));
  assert.ok(!VIEWS.gating.includes("voice_transcript"));
});

/* ── The reference posts themselves ───────────────────────────────────────── */

test("no library section holds reference-writer prose", () => {
  /*
   * `reference_posts` is a table of its own, reachable by one tool Josh calls. The library sections —
   * which is what a brief is built from — must not be where the text lives. A section key that looked
   * like a store of posts would mean the drafter gets them on every run.
   */
  for (const view of Object.keys(VIEWS)) {
    for (const key of VIEWS[view as keyof typeof VIEWS]) {
      assert.ok(
        key !== "reference_posts_text" && !key.endsWith("_posts_text"),
        `${view} includes ${key}, which sounds like a store of their words`,
      );
    }
  }
});

test("the brief builder never reads the reference_writer_posts table", () => {
  /*
   * A grep, deliberately. The drafting brief is assembled in `_shared/library.ts` and the briefs in
   * `mcp-server/tools/brief.mjs`; neither has any business touching the posts table. This is the
   * check that would have caught the mistake at the point someone made it, rather than three weeks
   * later in a draft that reads like Matt Barker.
   */
  const files = [
    "supabase/functions/_shared/library.ts",
    "supabase/functions/_shared/handlers/draft.ts",
    "supabase/functions/_shared/handlers/gate.ts",
    "supabase/functions/_shared/prompts.ts",
    "mcp-server/tools/brief.mjs",
  ];

  for (const path of files) {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
    assert.ok(
      !/reference_writer_posts/.test(source),
      `${path} reaches the reference_writer_posts table — the drafting path must see measurements only`,
    );
  }
});

/**
 * Read a source file with its string concatenation joined up.
 *
 * Every description in this codebase is written as `"..." +\n  "..."` to stay inside the line length,
 * so a regex run against the raw source cannot see a sentence that spans two literals — which is how
 * the first version of the two tests below failed against code that was perfectly correct. This reads
 * what the model will actually be handed.
 */
function assembled(path: string): string {
  const raw = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  return raw.replace(/"\s*\+\s*\r?\n\s*"/g, "");
}

test("only the table's own two tools reach it", () => {
  /*
   * `get_reference_posts` is the one door that returns text. If a second place starts selecting from
   * this table — a brief builder, a worker, another tool — this is where it is noticed, because by
   * then the symptom is a draft that sounds like somebody else and the cause is three weeks old.
   */
  const voice = assembled("mcp-server/tools/voice.mjs");

  /*
   * Not a count of call sites — there are three, and the third is honest: when a handle returns
   * nothing, `get_reference_posts` reads back the handles it does have so it can say which those are
   * rather than just "none". Counting calls would have made that lookup look like a leak.
   *
   * What matters is how many places ask for the TEXT. One: the tool Josh calls.
   */
  const withText = [...voice.matchAll(/select:\s*"([^"]*)"/g)].filter((m) => /\btext\b/.test(m[1]));
  assert.equal(
    withText.length,
    1,
    `${withText.length} selects ask for post text; exactly one (get_reference_posts) should`,
  );
});

test("the tool that returns posts says plainly what may not be taken", () => {
  const voice = assembled("mcp-server/tools/voice.mjs");

  // A model picks a tool from its description and acts on what it says. Drop these sentences and the
  // next drafter has their prose in hand and no instruction about it.
  assert.match(voice, /borrow the shape, never the sentence/i);
  assert.match(voice, /not quoted, not near-quoted, not paraphrased/i);
  // Matt Barker specifically: he is where Josh's rules came from rather than a peer, so his cadence
  // is the one most likely to leak and the one Josh asked to lean hardest into.
  assert.match(voice, /not a peer reference/i);
});

test("get_sentinels no longer claims the words are not held", () => {
  /*
   * It used to say "THEIR WORDS ARE NOT HERE and never will be". That was true of the database and
   * false of the repo — the raw scrape has been committed since 5 October — and it is now
   * deliberately false of both. A model told the text does not exist, inside a system that holds it,
   * is the worst of the three options.
   */
  const voice = readFileSync(new URL("../../../mcp-server/tools/voice.mjs", import.meta.url), "utf8");
  assert.ok(
    !/WORDS ARE NOT HERE and never will be/.test(voice),
    "a tool description still claims their words are not held",
  );
  assert.match(voice, /MEASUREMENTS ONLY/);
});
