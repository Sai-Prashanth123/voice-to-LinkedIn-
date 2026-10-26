/**
 * Three guards, each one added after something got through.
 *
 * None of these is a new standard. Each is an existing rule that had no way of stopping anything:
 * a filter nobody applied, a check nobody had to read, a counter nobody incremented. They are
 * together because they share a shape — the system knew the right answer and had no mechanism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/** Repo-relative, because two of these assert about files outside mcp-server. */
const readFile = async (rel) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

import { unknownArgumentMessage, unknownArguments, wrap } from "./server.mjs";
import { tools } from "./tools/index.mjs";
import { HIGH_CONFIDENCE, scan } from "./aitells.mjs";
import { prefileVerdict, willRefuse } from "./prefile.mjs";

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

  /*
   * ASSERTED AGAINST THE RAW-BODY CHECK, NOT AGAINST wrap().
   *
   * This test used to call wrap() and pass, while the real path did nothing — because calling
   * wrap() directly is not what the SDK does. The SDK parses `params.arguments` against the zod
   * shape first, and a non-strict object strips what it does not recognise, so by the time wrap()
   * ran the unknown key was already gone. A green test over a dead guard.
   *
   * The only place the caller's actual request still exists is the raw body, so http.mjs checks
   * there, before the transport. That is what these two assertions now exercise.
   */
  const unknown = unknownArguments(tool, { writer: "mattjbarker1" });
  assert.deepEqual(unknown, ["writer"], "an unknown argument was not identified");

  const message = unknownArgumentMessage(tool, unknown);
  assert.match(message, /no argument "writer"/);
  // It says what the tool does take, because the next thing the caller needs is the right name.
  assert.match(message, /handle/);
  assert.match(message, /dropped rather than/);

  assert.deepEqual(unknownArguments(tool, { handle: "mattjbarker1" }), []);
});

test("the guard runs before the transport, and never inside the dispatch", async () => {
  // It has to read the raw body: everything downstream has already had unknown keys stripped.
  const http = readFileSync(new URL("./http.mjs", import.meta.url), "utf8");
  assert.match(http, /unknownArguments\(tool, message\?\.params\?\.arguments\)/,
    "http.mjs no longer checks the raw request body");

  /*
   * And it must NOT be in wrap(). Put back there it refuses every zero-argument tool, because the
   * SDK calls those as `(extra)` and the context object lands where arguments were expected.
   *
   * The test that used to live here asserted `health` with `{anything: 1}` was refused — which is
   * the broken behaviour written down as the requirement. health, system_status, next_action and
   * next_work all failed on stdio for a day while this test stayed green.
   */
  const dispatch = readFileSync(new URL("./server.mjs", import.meta.url), "utf8");
  const wrapBody = dispatch.slice(dispatch.indexOf("export function wrap"));
  assert.ok(
    !/const unknown = Object\.keys\(args/.test(wrapBody),
    "the unknown-argument check is back in wrap() — it breaks every zero-argument tool",
  );
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

  assert.match(src, /prefileVerdict/, "create_draft does not check the mechanical tells");
  assert.match(src, /scan\(args\.body\)/, "create_draft never scans the body");
  // Refuses before it posts, so nothing is stored.
  assert.ok(
    src.indexOf("prefileVerdict(") < src.indexOf("functions/v1/cc-submit"),
    "the tell check runs after the draft has already been sent",
  );
});

test("the review list shows the verdict, and shows it before the post", () => {
  /*
   * Josh gave the same editorial notes every week because the list he reviews on could not show
   * him a verdict: gate_passed, gate_advisory and gate_reason live on `drafts` and list_calendar
   * selects from `posts`. On draft 90 the gate had already named four of his six notes in its own
   * words, and he never saw them.
   *
   * Order is load-bearing rather than cosmetic. A model reads an object top-down and reads it out
   * in roughly that order, so the body first is how the verdicts kept getting skipped. `gate` is
   * spread in ahead of the rest of the post for that reason.
   */
  const src = readFileSync(new URL("./tools/inspect.mjs", import.meta.url), "utf8");
  assert.match(
    src,
    /drafts\(gate_passed,gate_advisory,gate_reason\)/,
    "list_calendar does not join the draft's verdict, so /review cannot show one",
  );
  assert.match(src, /gate:\s*\{/, "the verdict is not reshaped into a gate block");
  // Scoped to the rewrite itself: `...p,` appears elsewhere in this file, so a bare indexOf
  // compares the wrong two positions and passes or fails for the wrong reason.
  const reshape = src.slice(src.indexOf("data[i] = {"));
  assert.ok(
    reshape.indexOf("gate: {") < reshape.indexOf("...p,"),
    "the post's fields come before its verdict, which is how the verdict gets skipped",
  );

  const review = readFileSync(
    new URL("../.claude/commands/review.md", import.meta.url),
    "utf8",
  );
  assert.ok(
    review.indexOf("gate.flagged") < review.indexOf("Read it to him in full"),
    "/review still reads the post before saying what the checks caught",
  );
});

test("every write door works from a clone, not only from the connector", () => {
  /*
   * THE FAULT THIS IS FOR, measured 26 October.
   *
   * `index.mjs` builds the context for a local stdio run as `{ db, url: env.url }` — no `key`. The
   * hosted connector adds one. `onestep.mjs` did `const { url, key } = context` and put `key`
   * straight into an Authorization header, so from a cloned repo `start_post` sent
   * `Bearer undefined` and got HTTP 401 UNAUTHORIZED_INVALID_JWT_FORMAT.
   *
   * start_post is the first tool in one-step mode, the mode Josh is in. So the clone could not
   * begin. Nothing caught it because `system_events` holds 396 `mcp_http_call` rows and no local
   * equivalent: every session had gone through the connector. The clone path had never been run.
   *
   * The invariant, rather than the instance: any file that posts to the write door must be able to
   * get a key without one being handed to it. Checked by source because the alternative is two
   * live runs, one per transport.
   */
  const dir = new URL("./tools/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && !f.includes(".test."))
    .map((f) => [`tools/${f}`, new URL(f, dir)])
    .concat([["brief-read.mjs", new URL("./brief-read.mjs", import.meta.url)]]);

  let checked = 0;
  for (const [name, url] of files) {
    const src = readFileSync(url, "utf8");
    if (!src.includes("functions/v1/cc-submit")) continue;
    checked++;
    assert.match(
      src,
      /process\.env\.CONTENT_MCP_KEY/,
      `${name} posts to cc-submit with whatever key the context happened to carry. Over stdio ` +
        `there is none, so this sends "Bearer undefined" and 401s in a clone.`,
    );
  }
  assert.ok(checked >= 4, `only ${checked} write doors found — the scan is not finding them`);
});

test("the turn detector is spelled once, and a draft can reach it", () => {
  /*
   * It lived only in scripts/measure-structure.mjs — a CLI that measures the eight writers and
   * writes nothing — so the one fact about reading order this system can compute had never been
   * applied to a post of Josh's. He asked for exactly that on 26 October.
   *
   * It moved to scripts/lib/prose.mjs, whose header exists so two readers of one definition cannot
   * disagree. A second copy would make every comparison between a draft and the corpus an artefact
   * of which copy ran.
   */
  const prose = readFileSync(
    new URL("../scripts/lib/prose.mjs", import.meta.url),
    "utf8",
  );
  assert.match(prose, /export function turnAt/, "the shared definition is gone");

  const cli = readFileSync(
    new URL("../scripts/measure-structure.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(cli, /^function turnAt/m, "measure-structure has its own copy again");
  assert.match(cli, /turnAt.*from "\.\/lib\/prose\.mjs"/, "it does not import the shared one");

  const measure = readFileSync(new URL("./tools/measure.mjs", import.meta.url), "utf8");
  assert.match(measure, /turnAt\(sentences\(body\)\)/, "measure_draft cannot see the turn");
  // No threshold, ever: 56% of the corpus has no marked turn and that is a real shape.
  assert.doesNotMatch(measure, /turn\s*[<>]=?\s*0\.\d/, "a threshold has been put on the turn");
});

test("the gate is described as nine checks, because it is nine", () => {
  // A ninth was added on 14 October. Every surface that still said eight was telling a reader —
  // and a model — to stop at eight, which is how gate_passed stayed null for five days.
  for (const file of [
    "./instructions.mjs",
    "./tools/brief.mjs",
    "../README.md",
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      src,
      /eight (?:ways|independent checks)|the eight checks for/i,
      `${file} still describes the gate as eight checks`,
    );
  }
});

test("the shape targets are paged, because the row ceiling is the server's", () => {
  /*
   * PostgREST returns at most 1,000 rows however many are asked for, silently. Measured 26 October:
   * limit 2000 and limit 5000 both returned exactly 1,000 against 1,839 stored.
   *
   * The ninth gate check was asking for 500, so every shape verdict it recorded was judged against
   * per-writer medians built from about 43 of Matt Barker's 241 measurable posts — and the band
   * across the eight read 7 to 23 where the truth is 8 to 21. Wider than real, so more permissive
   * than written. A bigger limit is not the fix; nothing in a response says it was truncated.
   *
   * Asserted by source because the alternative is a live database with 1,839 rows in it.
   */
  for (const [name, file] of [
    ["get_gate_brief", "./tools/brief.mjs"],
    ["the drafting target", "./tools/voice.mjs"],
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /shapedWriterRows\(/, `${name} loads the shape rows its own way`);
    assert.doesNotMatch(
      src,
      /select: "handle,paragraphs,above_fold_words"/,
      `${name} still has its own unpaged query for the shape rows`,
    );
  }

  const deno = readFileSync(
    new URL("../supabase/functions/_shared/handlers/gate.ts", import.meta.url),
    "utf8",
  );
  assert.match(deno, /SHAPE_ROWS_PAGE/, "the server gate does not page the shape rows");
  assert.doesNotMatch(deno, /\.limit\(500\)/, "the server gate still truncates at 500");
});

test("the free look predicts the refusal, rather than merely resembling it", () => {
  /*
   * measure_draft and scrub_draft are both free and both get skipped, because for a year neither
   * of them could tell a caller which findings would actually stop a draft. They now report
   * will_refuse from the same module create_draft throws from.
   *
   * Asserted by source for the same reason as the block above: the alternative is a database.
   */
  for (const [name, file] of [
    ["measure_draft", "./tools/measure.mjs"],
    ["scrub_draft", "./tools/scrub.mjs"],
    ["create_draft", "./tools/write.mjs"],
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(
      src,
      /from "\.\.\/prefile\.mjs"/,
      `${name} has its own idea of what gets refused`,
    );
  }

  // And the one that matters: the same body gives the same answer on both sides.
  const soup = [1, 2, 3, 4, 5].map((n) =>
    `${n}. Method ${n}\n→ Pro: this is the reason it is worth the effort for case ${n}.`
  ).join("\n\n");
  assert.ok(willRefuse(soup).length > 0, "the free look does not see what create_draft refuses");

  /*
   * THE CASE THIS TEST ORIGINALLY MISSED, which is the whole reason it is being widened.
   *
   * Bullet soup is an AI tell. It needs no library, so it lands in `blocking` whether or not a
   * caller passes `sections` — which means the assertion above passed while measure_draft was
   * calling `willRefuse(body)` with no sections and printing "Nothing here would stop create_draft
   * filing it" for a draft closing on an engagement ask. The guard tested the one class that could
   * not expose the gap.
   *
   * So: a library-derived refusal must never read as silence. With the library it blocks; without
   * it, it must still be reported, and the word "Nothing" must not be what a caller sees.
   */
  const asking = "I spent a morning on it.\n\nIt was in the DNS records.\n\nWhich ones have I missed?";
  const rule = { banned_phrases: 'Never end by asking for engagement ("Agree?", "Thoughts?").' };

  assert.ok(
    willRefuse(asking, { sections: rule }).length > 0,
    "with the live rule in hand this must refuse",
  );
  const blind = prefileVerdict(asking);
  assert.equal(blind.blocking.length, 0, "without the library it cannot claim to refuse");
  assert.ok(
    blind.advisory.some((f) => f.source === "engagement_ask"),
    "without the library it must still REPORT it — reporting nothing is the fault",
  );
});

test("it refuses only the mechanical ones, and reports the arguable ones", () => {
  const src = readFileSync(new URL("./tools/write.mjs", import.meta.url), "utf8");

  // Everything else travels back with the draft id rather than blocking it. A filler word is a
  // judgement — "delete it and read the sentence again" — and a check that cannot be overruled on
  // a judgement is one that will eventually be wrong with no way back.
  // READ OFF create_draft'S HANDLER, NOT THE FILE. These two assertions passed for weeks against
  // a copy of this block that had been pasted into submit_candidates, where it threw a
  // ReferenceError on every call and create_draft returned no tells at all. A source-text match
  // cannot tell which function the text is in.
  const createDraft = String(tools.find((t) => t.name === "create_draft").handler);
  assert.match(createDraft, /ai_tells/, "the non-blocking findings are not returned to the caller");
  assert.match(createDraft, /ai_tells_mean/, "the findings come back with no explanation of their standing");

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

/* ── 7. The Apify path, which had never run ───────────────────────────────── */

test("the Apify run sends the input key the actor actually has", async () => {
  /*
   * It sent `profileUrls`. The actor's property is `targetUrls` — read from its own schema at
   * api.apify.com/v2/acts/harvestapi~linkedin-profile-posts/builds/default on 14 Oct 2026. Apify
   * ignores an unknown input key rather than refusing it, so the first paid run would have started
   * with no URLs, returned nothing, and read exactly like "LinkedIn blocked us".
   *
   * The path had never executed because APIFY_TOKEN was never bought, which is how a never-run
   * branch stays wrong indefinitely.
   */
  const src = await readFile("scripts/scrape-sentinels.mjs");

  assert.match(src, /targetUrls:/, "the Apify run no longer sends targetUrls");
  assert.doesNotMatch(src, /profileUrls:/, "it still sends profileUrls, which the actor ignores");

  // Set explicitly rather than left to default: a repost is somebody else's writing, and reactions
  // and comments are somebody else's words that cost money to fetch.
  assert.match(src, /includeReposts: false/);
  assert.match(src, /scrapeComments: false/);
});

test("a post is attributed to its author, never to the page it was found on", async () => {
  /*
   * handleOf fell back to `inputUrl` — the profile we ASKED for. The comment twenty lines below it
   * warns about exactly this: "author_handle wrote it, subject_handle is whose page it came from.
   * Reading the second as the author would file six strangers' posts under Matt's name."
   *
   * Nothing had been misfiled, because the console flattens author_handle onto every row and the
   * fallback never ran. It would have run on the first Apify harvest, where the author is nested.
   */
  const src = await readFile("scripts/scrape-sentinels.mjs");
  const block = src.slice(src.indexOf("const handleOf"), src.indexOf("const unmapped"));

  assert.doesNotMatch(
    block,
    /"inputUrl"/,
    "the author can still be resolved from the page the post was found on",
  );
  assert.match(block, /author\.publicIdentifier/, "Apify's nested author shape is not read");
  assert.match(block, /in SENTINELS/, "a row from outside the eight is no longer dropped");
});

/**
 * A FOURTH GUARD, WHICH IS THE ABSENCE OF ONE.
 *
 * The unknown-argument check lived in `wrap()` for a day. For a tool that declares arguments it was
 * unreachable, because the SDK strips unknown keys before the handler runs. For a tool that
 * declares none it was actively harmful: the SDK calls a zero-argument tool as `(extra)`, so the
 * context object arrived where arguments were expected and every SDK internal counted as an
 * argument the tool does not have.
 *
 * All eight zero-argument tools refused every call — `health` and `system_status` among them, which
 * are the two CLAUDE.md names for when something looks wrong. `node index.mjs --check` stayed green
 * the whole time, because it calls handlers directly and never crosses the transport.
 *
 * This asserts the shape of the mistake rather than the fix, so it fails again if the check is ever
 * moved back here, whatever it is called.
 */
test("a zero-argument tool survives being handed the SDK's own context", async () => {
  const zero = tools.filter((t) => Object.keys(t.config?.inputSchema ?? {}).length === 0);
  assert.ok(zero.length > 0, "no zero-argument tools left to protect — update this test");

  // Exactly what the SDK passes as the first parameter when a tool declares no input schema.
  const sdkContext = {
    signal: new AbortController().signal,
    sessionId: "test-session",
    _meta: {},
    requestId: 1,
    sendNotification: () => {},
    sendRequest: () => {},
  };

  for (const tool of zero) {
    const called = { yes: false };
    const stub = {
      name: tool.name,
      config: tool.config,
      handler: async () => { called.yes = true; return { ok: true }; },
    };

    const result = await wrap(stub, {}, null)(sdkContext);

    assert.ok(
      !result.isError,
      `${tool.name} refused the SDK's own context: ${result.content?.[0]?.text}`,
    );
    assert.ok(called.yes, `${tool.name} never reached its handler`);
  }
});

test("an old Node is refused with a sentence, not a riddle", async () => {
  /*
   * This server imports TypeScript from supabase/functions/_shared/ on the startup path, so it
   * needs Node's native type stripping — default from 22.18. Below that the first import throws
   * ERR_UNKNOWN_FILE_EXTENSION before a single tool registers, which names neither Node nor a
   * version. package.json said ">=20" and the README said "Node.js 20 or newer"; CI pins 22, so
   * nothing was ever going to catch it.
   *
   * Tested against versions this machine does not run, because a guard only exercised by the
   * passing case is the fault it was written to stop.
   */
  const { meetsFloor, NODE_FLOOR } = await import("./node-floor.mjs");

  for (const bad of ["20.0.0", "20.19.5", "21.7.3", "22.0.0", "22.17.9", "18.20.4"]) {
    assert.equal(meetsFloor(bad), false, `${bad} cannot strip types and must be refused`);
  }
  for (const good of ["22.18.0", "22.20.1", "23.6.0", "24.0.0", "25.4.0"]) {
    assert.equal(meetsFloor(good), true, `${good} is fine and must not be refused`);
  }
  assert.equal(meetsFloor(undefined), false, "an unreadable version is not a pass");

  // The floor, package.json and the README must agree. Three places said three things before.
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  assert.equal(pkg.engines.node, `>=${NODE_FLOOR[0]}.${NODE_FLOOR[1]}`);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, new RegExp(`Node\.js ${NODE_FLOOR[0]}\.${NODE_FLOOR[1]} or newer`));

  // And it must run before anything that reaches a .ts file.
  const index = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.ok(
    index.indexOf("./node-floor.mjs") < index.indexOf("./tools/index.mjs"),
    "the floor check is imported after the registry, so the .ts import fails first",
  );
});

test("the two surfaces are distinguishable, and a script that exits awaits the report", () => {
  /*
   * `start_post` returned 401 from a clone for weeks and nobody could tell, because the hosted door
   * logs every call (`mcp_http_call`) and the local stdio server logged nothing at all. "Never run"
   * and "ran fine" were the same observation. announce() closes that.
   *
   * AND THE TRAP IT IMMEDIATELY FELL INTO. The first version was fire-and-forget everywhere, so
   * doctor.mjs called it and then process.exit(), which tears down the pending request. It filed
   * nothing and reported success — the exact fault it exists to detect, inside itself. index.mjs
   * already carries a comment about that trap for a different reason.
   *
   * So: a long-lived server may drop the promise, a script that exits must await it.
   */
  const announce = readFileSync(new URL("./announce.mjs", import.meta.url), "utf8");
  assert.match(announce, /return fetch\(/, "announce must return the promise or no caller can wait");
  /*
   * Scoped to the PAYLOAD, not the file. The first version of this assertion scanned the whole
   * module and failed on the `cwd` option passed to git — a path given TO a subprocess, not a path
   * sent anywhere. The rule is about what leaves the machine.
   */
  const payload = announce.slice(announce.indexOf("const payload = {"));
  assert.doesNotMatch(
    payload.slice(0, payload.indexOf("};")),
    /cwd|homedir|__dirname|process\.env\.HOME|USERPROFILE/,
    "the payload must not carry a path — it would carry his username with it",
  );

  const doctor = readFileSync(new URL("../scripts/doctor.mjs", import.meta.url), "utf8");
  assert.match(
    doctor,
    /await announce\(/,
    "doctor.mjs exits, so an unawaited announce files nothing and still prints success",
  );

  const index = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  assert.match(index, /announce\(\{/, "the stdio server does not say that it started");
  assert.ok(
    index.indexOf("connect(transport)") < index.indexOf("announce({"),
    "announce must come after connect — the transport owns stdout from there",
  );
});
