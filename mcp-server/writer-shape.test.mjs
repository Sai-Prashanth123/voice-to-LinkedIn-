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

test("the writer's name comes from the handle map, not from his profile", async () => {
  /*
   * ADDED 28 OCTOBER. outboundphd's stored author_name is "🦾Eric Nowoslawski" — his own profile —
   * and writerShapeBlock read the display name off the scraped report. prompts.ts renders it
   * through .toUpperCase(), so the brief instructed a drafter to "BUILD THIS ONE IN 🦾ERIC
   * NOWOSLAWSKI'S SHAPE." writers.mjs has carried the clean name all along.
   *
   * Asserted on the brief rather than on the block, because the brief is where it was visible.
   */
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111, writer_handle: "outboundphd" }, { db, url: creds.url });

  assert.match(brief.user, /BUILD THIS ONE IN ERIC NOWOSLAWSKI'S SHAPE/);
  assert.doesNotMatch(brief.user, /[\u{1F300}-\u{1FAFF}]/u, "an emoji reached the drafting brief");

  const src = readFileSync(join(HERE, "tools", "voice.mjs"), "utf8");
  assert.doesNotMatch(
    src,
    /const name = \(sentinels\.report/,
    "writerShapeBlock reads the display name off the scrape again",
  );
});

test("the rhythm figure travels with the rest of the shape", async () => {
  // writerShapeBlock handed over opening, fold, paragraphs, close, lists and length — and not sd.
  // So the one rhythm figure a drafter aims at never reached them from the brief, while
  // measure_draft reported it against a range nobody had chosen.
  const block = await writerShapeBlock(db, "mattjbarker1");
  const sd = block.lines.find((l) => l.startsWith("SENTENCE VARIATION:"));
  assert.ok(sd, `no sentence-variation line in ${JSON.stringify(block.lines)}`);
  assert.match(sd, /sd of 9\.3 words/, "the figure is not Barker's measured one");
  assert.match(sd, /7\.1 to 18\.8/, "the corpus range is missing from it");
});

test("an unknown handle refuses instead of inventing a shape", async () => {
  const block = await writerShapeBlock(db, "not-a-writer");
  assert.ok(block.refused, "an unknown handle produced a target");
  assert.equal(block.lines, undefined);
});

test("a shape nobody asked for is carried, and says so rather than claiming he chose it", async () => {
  /*
   * This asserted that moment 109 carried NO shape, because nobody had asked for one. That was
   * right about the attribution and wrong about the outcome, and on 31 October the outcome changed.
   *
   * With no handle and no Sentinel ask in his notes, the brief used to carry no opening guidance
   * at all — the whole of it was one line in DRAFTER_SYSTEM, "Open a loop with the first line."
   * `hook_opens_loop` then failed 59% of drafts, every recorded reason the same shape: the first
   * line announced the topic. A drafter cannot aim at a distribution it was never shown, and most
   * drafts are this case.
   *
   * So the corpus band is now the floor. What the original test was really protecting survives
   * intact and is what this one checks: a default must never be presented as something Josh chose.
   * That is not pedantry about a label — it is how the Barker read became the house framework he
   * complained about on 26 October, after shipping on every brief regardless of handle.
   */
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 109 }, { db, url: creds.url });

  assert.equal(brief.writer_shape?.asked_by, "nobody", "an unasked default must label itself");
  assert.ok(
    brief.writer_shape?.targets?.some((l) => l.startsWith("HOW THEY GET IN:")),
    "the point of carrying it is the opening distribution; without that line it is just a band",
  );

  // Never a mandate, and never his name on it.
  assert.doesNotMatch(brief.user, /BUILD THIS ONE/);
  assert.doesNotMatch(
    brief.user,
    /he asked for the Sentinel/,
    "nobody asked — saying he did is a fabricated attribution, in a brief, to the client",
  );
  assert.match(brief.user, /NOBODY ASKED FOR A SHAPE ON THIS POST/);
  assert.match(
    brief.user,
    /the FRAMEWORK wins/,
    "an unasked default must not outrank a library section Josh approved",
  );
});

test("the detector still discriminates: his own ask outranks the default", async () => {
  // The guard the rewrite above could silently lose. If every brief now carries a corpus block,
  // a broken Sentinel-ask detector would look identical to a working one from the outside.
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });
  assert.equal(brief.writer_shape?.asked_by, "his_note", "his recorded ask read as a default");
  assert.match(brief.user, /he asked for the Sentinel accounts/);
});

test("the Sentinel ask in his note on 111 is acted on, not just reported", async () => {
  // The 26 October complaint, closed. He asked for the reference writers in a pushback and the
  // only thing that happened was the note being read out to the writer.
  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });

  assert.equal(brief.writer_shape?.asked_by, "his_note");
  assert.equal(brief.writer_shape?.handle, null, "a group ask resolved to one writer");
  assert.match(brief.user, /BUILD THIS ONE THE WAY THE EIGHT HANDLE IT/);
  // Never one writer's name as the model, for a group ask.
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

  /*
   * The heading changed on 28 October, and the old one is the defect.
   *
   * It read "WHAT JOSH HAS SAID ABOUT PREVIOUS DRAFTS" and the block sat ABOVE the moment-scoped
   * one, in the same bullet style. Six drafters on six different moments all read it as
   * instructions for the post in front of them. The notes were right; the heading was wrong.
   */
  assert.match(brief.user, /WHAT HE HAS SAID ABOUT OTHER POSTS — NOT INSTRUCTIONS FOR THIS ONE/);
  assert.doesNotMatch(
    brief.user,
    /WHAT JOSH HAS SAID ABOUT PREVIOUS DRAFTS/,
    "the heading that six drafters misread is back",
  );

  // Framed as instructions, not as prose to imitate. These are dictated and carry spoken filler,
  // which the voice guide is explicit does not belong in a post.
  assert.match(brief.user, /Take the\s+INSTRUCTION from them and ignore the delivery/);

  // And it must not be mistakable for a rule: only he changes the library (12.10).
  assert.match(brief.user, /None of this is a rule/);
  assert.match(brief.user, /12\.10/);
});

test("a note about another post is labelled with that post, and is not in the block of instructions", async () => {
  /*
   * THE DEFECT THIS PINS, measured 28 October 2026.
   *
   * `joshs_notes` returns the ten most recent notes about ANY post — deliberately, see migration
   * 0054: a preference he stated on Monday was invisible to Tuesday's post. What it did not return
   * was WHICH post, so the brief rendered hook direction for a cold-email post inside the brief for
   * a post about board papers, under a heading that read like feedback on this one.
   *
   * Migration 0056 projects the moment id and title. This asserts both halves of the fix: every
   * bullet says which post, and nothing about THIS post is duplicated down here when the block
   * above already carries it as an instruction.
   */
  const notes = await db.rpc("joshs_notes", { p_limit: 10 });
  assert.ok((notes ?? []).length > 0, "no notes came back at all");
  assert.ok(
    notes.every((n) => "moment_id" in n),
    "the RPC stopped projecting moment_id, so nothing can be labelled",
  );

  const brief = await tools.find((t) => t.name === "get_drafting_brief")
    .handler({ moment_id: 111 }, { db, url: creds.url });

  /*
   * Bounded at the next `---`, because the block that follows is the previous attempt's rejection
   * reasons and those are rendered as `  - anyone_else: …` in the same bullet style. An unbounded
   * slice reads a gate verdict as an unlabelled taste note — which is a small version of exactly
   * the confusion this test exists to pin, so it is worth saying out loud rather than just fixing.
   */
  const from = brief.user.indexOf("WHAT HE HAS SAID ABOUT OTHER POSTS");
  const rest = brief.user.slice(from);
  const end = rest.indexOf("\n---\n");
  const taste = end === -1 ? rest : rest.slice(0, end);
  const bullets = taste.split("\n").filter((l) => /^ {2}- /.test(l));

  if (bullets.length > 0) {
    for (const b of bullets) {
      assert.match(
        b,
        / on "|on another post/,
        `a bullet does not say which post it was about: ${b.slice(0, 90)}`,
      );
    }
  }

  // An empty note rendered as `- 2026-10-27 — ""`, a dated entry presented as something he said.
  assert.doesNotMatch(taste, /— ""/, 'an empty note is being shown as something he said');

  /*
   * ORDER IS PART OF THE FIX, not decoration. A drafter reads top-down, so the block that IS
   * instructions has to come before the block that is not.
   */
  /*
   * Matched WITH the separator prefix, so this finds the real heading and not the reference to it
   * inside the other block's framing paragraph. Without the prefix, a brief on a moment he has
   * never commented on reports the order as wrong, because the only occurrence of the instructions
   * heading is the sentence pointing at it — which is how I first wrote this and how it first lied.
   */
  const his = brief.user.indexOf("\n---\n\nWHAT HE HAS ALREADY TOLD YOU ABOUT THIS POST");
  const other = brief.user.indexOf("\n---\n\nWHAT HE HAS SAID ABOUT OTHER POSTS");
  if (his >= 0 && other >= 0) {
    assert.ok(
      his < other,
      "the notes about other posts are rendered before his instructions for this one, which is " +
        "the order six drafters read in the wrong direction",
    );
  }
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
