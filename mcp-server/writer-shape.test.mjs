/**
 * Pointing a draft at one of the eight writers — the fix Josh singled out on 26 October.
 *
 *   "I keep asking for a specific writer's shape, usually Matt Barker, and the draft uses the
 *    default framework instead. This is the one place I'd call out a specific fix: being able to
 *    point the drafter at one of my reference writers and have it actually build on that structure
 *    would solve most of it."
 *
 * The danger in granting it is obvious and it is the reason clause 8.3 exists. Handing a drafter
 * "write this like Matt Barker" is the single instruction most likely to produce his cadence rather
 * than Josh's, and the library says so itself: his is the voice most likely to leak, because the
 * system is already aligned to his thinking.
 *
 * So the test that matters most here is not that the target arrives. It is that his WORDS do not.
 */

import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb } from "./db.mjs";
import { tools } from "./tools/index.mjs";
import { writerShapeBlock } from "./tools/voice.mjs";
import { hashRun, shinglesOf } from "../supabase/functions/_shared/shingles.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function credentials() {
  const read = (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const field = (text, key) => (text.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]?.trim();
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

before(() => {
  assert.ok(creds, "needs mcp-server/.env or eval/.env to reach the project");
  db = createDb(creds);
});

/* ── The one that matters: the shape, never the words ───────────────────────── */

test("not one seven-word run of his prose reaches the drafting brief", async () => {
  /*
   * The real 8.3 assertion rather than a proxy for it. Built from the same shingler the refusal at
   * filing uses, so if the brief ever started carrying his sentences this fails on the same
   * definition that would refuse the draft.
   *
   * Checked against every stored post of his, not a sample.
   */
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111, writer_handle: "mattjbarker1" }, { db, url: creds.url });

  const haystack = new Set();
  for (const run of shinglesOf(`${brief.system}\n${brief.user}`)) haystack.add(hashRun(run));
  assert.ok(haystack.size > 50, "the brief did not produce shingles — the test is not testing");

  let page = 0;
  let checked = 0;
  for (;; page += 500) {
    const posts = await db.select("reference_writer_posts", {
      select: "activity_id,text",
      handle: "eq.mattjbarker1",
      order: "activity_id.asc",
      offset: String(page),
      limit: "500",
    });
    for (const p of posts) {
      checked++;
      for (const run of shinglesOf(p.text ?? "")) {
        assert.ok(
          !haystack.has(hashRun(run)),
          `a run of Matt Barker's words reached the brief, from ${p.activity_id}: "${run}"`,
        );
      }
    }
    if (posts.length < 500) break;
  }
  assert.ok(checked > 200, `only ${checked} of his posts were checked`);
});

/* ── The target itself ──────────────────────────────────────────────────────── */

test("the brief carries his measured shape as a target, not as a caution", async () => {
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111, writer_handle: "mattjbarker1" }, { db, url: creds.url });

  assert.ok(brief.writer_shape, "no writer_shape came back");
  assert.equal(brief.writer_shape.handle, "mattjbarker1");
  assert.ok(brief.writer_shape.targets.length >= 4, "too few targets to build a post from");
  assert.match(brief.user, /BUILD THIS ONE IN MATT BARKER'S SHAPE/);

  // The sentence that actually overrides the frameworks section's "the right default when nothing
  // else obviously fits" — without editing a section Josh has not approved a change to (12.10).
  assert.match(brief.user, /the measured shape wins for this post/);
});

test("the number the drafter aims at is the number the gate judges against", async () => {
  /*
   * A target the gate cannot see is advice, and advice is what Josh has been overruling by hand.
   * Both sides come from writerShapeTargets over the same paged rows, so this asserts they agree
   * rather than merely resemble each other.
   */
  const [block, gateBrief] = await Promise.all([
    writerShapeBlock(db, "mattjbarker1"),
    tools.find((t) => t.name === "get_gate_brief")
      .handler({ draft_id: 90 }, { db, url: creds.url }),
  ]);

  const fold = block.lines.find((l) => l.startsWith("ABOVE THE FOLD:"));
  const band = fold.match(/the eight run (\d+) to (\d+)/);
  assert.ok(band, `no corpus band in "${fold}"`);

  // The gate brief renders the same band in prose for the judge.
  const shapeText = JSON.stringify(gateBrief);
  assert.ok(
    shapeText.includes(`${band[1]} to ${band[2]}`) || gateBrief.checks_remaining === 0,
    "the drafter's band and the gate's band disagree",
  );
});

/* ── Refusing rather than degrading ─────────────────────────────────────────── */

test("the exclusions cannot be separated from the target", async () => {
  /*
   * The failure mode is a refactor that keeps the shape and drops the thing the shape is not
   * allowed to include. For Matt Barker that is the one construction Josh's banned-phrases section
   * forbids outright, so a target without it is worse than no target.
   *
   * Both halves asserted: the writer who has exclusions recorded carries them, and the writer who
   * has none says so rather than returning an empty list that reads as "nothing to avoid".
   */
  const barker = await writerShapeBlock(db, "mattjbarker1");
  assert.ok(barker.excludes.length > 0, "Barker's target came back with no exclusions");
  assert.match(barker.excludes.join(" "), /renames the reader's problem/);

  const other = await writerShapeBlock(db, "curtishowland");
  assert.ok(other.excludes.length > 0, "a writer with no exclusions returned an empty list");
  assert.match(other.excludes.join(" "), /No exclusions are recorded/);
});

test("an unknown handle refuses instead of inventing a shape", async () => {
  const block = await writerShapeBlock(db, "not-a-writer");
  assert.ok(block.refused, "an unknown handle produced a target");
  assert.equal(block.lines, undefined);
});

test("no writer named means no block at all", async () => {
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });
  assert.equal(brief.writer_shape, undefined, "a shape appeared without being asked for");
  assert.doesNotMatch(brief.user, /BUILD THIS ONE IN/);
});

/* ── It survives the steps between ──────────────────────────────────────────── */

test("the handle is carried, not dropped, at every step that has one", () => {
  // A handle that arrives at start_post and is not passed on is the default framework being used
  // anyway, which is the complaint. Asserted by source: the alternative is writing to his bank.
  const onestep = readFileSync(new URL("./tools/onestep.mjs", import.meta.url), "utf8");
  assert.match(onestep, /writer_handle: args\.writer_handle/, "write_post drops the handle");
  assert.match(onestep, /\.\.\.\(args\.writer_handle && \{ writer_handle/, "start_post drops it");

  const inspect = readFileSync(new URL("./tools/inspect.mjs", import.meta.url), "utf8");
  assert.match(inspect, /writerShapeBlock\(db, args\.writer_handle\)/, "a rewrite loses the shape");
});

/* ── What he has said, which the drafter had never seen ─────────────────────── */

test("the brief carries his own notes about drafts, and frames them as notes", async () => {
  /*
   * The standing assumption was that the system has nothing positive to aim at, because he has
   * never approved a post. That was wrong, and this is the correction: five pushback notes in his
   * own words, three verdicts, and three before-and-after pairs — all of it unread until 26 October.
   *
   * push_back_on_draft carried his note into the next draft of THAT moment via the job payload and
   * nowhere else, so a preference he stated on Monday was invisible to Tuesday's post.
   *
   * The 26 October note is the proof it matters: "go look at the Sentinel accounts to see how
   * others who have done lists like this would write it" — he asked for reference-writer targeting
   * in a pushback, and nothing read it.
   */
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });

  assert.match(brief.user, /WHAT JOSH HAS SAID ABOUT PREVIOUS DRAFTS/);

  // Framed as instructions, not as prose to imitate. These are dictated and carry spoken filler,
  // which the voice guide is explicit does not belong in a post.
  assert.match(brief.user, /Take the\s+INSTRUCTION from them and ignore the delivery/);

  // And it must not be mistakable for a rule: only he changes the library (12.10).
  assert.match(brief.user, /None of this is a rule/);
  assert.match(brief.user, /12\.10/);
});

test("a line he changed is shown as a pair, because that is the only positive example there is", async () => {
  // He was given "My holidays used to have client meetings in them. Now I say no." and cut the
  // second sentence — the one that answered his own hook, which is exactly what hook_opens_loop
  // had flagged on that draft. A verdict says what was wrong; a change says what better was.
  const notes = await db.rpc("joshs_notes", { p_limit: 12 });
  const pairs = (notes ?? []).filter(
    (n) => n.before_text && n.after_text && n.before_text !== n.after_text,
  );
  assert.ok(pairs.length > 0, "no before/after pair survived the read");

  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });
  assert.match(brief.user, /He was given:/);
  assert.match(brief.user, /He changed it to:/);
});
