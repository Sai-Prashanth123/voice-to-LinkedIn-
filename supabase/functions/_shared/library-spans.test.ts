/**
 * The section may not contradict itself again, and this is what makes that a test rather than care.
 *
 * `reference_posts` version 8 shipped saying fifty-nine posts across seven accounts four lines above
 * a table of 1,899 across eight, with "the adam-treboutat account returned zero posts" standing over
 * a row of 250 of them. `compare_to_references` had been ranking that handle on those 250 all along,
 * so the tool was right and the prose was stale — and a drafter reading the section could not tell
 * which half was current.
 *
 * It was not missed. Josh's own approval note on version 8 records it: "the intro still says Adam
 * Treboutat returned no posts", shipped knowingly, because the stale sentence lived ABOVE the
 * measurement marker and both refreshers preserve everything above it as his.
 *
 * So the rule is structural, and so is the test. Only one half of the section counts. If this ever
 * fails, the thing to check is not the test: it is whether a sentence stating a quantity has been
 * written back into the half no refresh can reach.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  END,
  HIS_RECORDED_PREFERENCES,
  measurementSpan,
  referencePostsBody,
  REFERENCE_WRITERS,
  refusals,
  REMOVED_WRITER_READ_CHARS,
  SECTION_BUDGET,
  splitModes,
  START,
  TABLE_HEADER,
  WRITER_READS_KEY,
} from "./library-spans.ts";
import { DRAFTING_SECTIONS, GATING_SECTIONS, VIEWS } from "./views.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

const latest = JSON.parse(read("data/josh/sentinels/latest.json"));
const span = measurementSpan(latest);
const body = referencePostsBody(span);

/* ── The one that would have caught the defect ────────────────────────────── */

test("no quantity is stated outside the markers", () => {
  /*
   * THE DECISIVE ONE. Every count lives in the span the refreshers rewrite whole, so prose and
   * table cannot disagree — there is only one of them counting.
   *
   * A clause citation is the only exemption, and it is not a measurement: "clause 8.3" points into
   * the build specification, no refresh can contradict it, and stripping the citations would cost
   * the section the thing that makes its rules traceable.
   */
  const a = body.indexOf(START);
  const b = body.indexOf(END);
  assert.ok(a !== -1 && b > a, "the section has no measurement markers");

  /*
   * THE VERDICT COMES FROM `refusals()`, NOT FROM A SECOND COPY OF THE RULE HERE.
   *
   * This test first re-implemented the scrub — clause citations exempt, everything else refused —
   * and then failed on correct input the moment a second exemption was added for date citations.
   * Which is this whole task's defect, reproduced inside its own test: two copies of one rule, and
   * the one nobody was looking at was the stale one.
   *
   * So the test asserts the OUTCOME the rule exists for, and asks the rule itself for the verdict.
   * What makes it a real test rather than a tautology is the pair below it, which feeds it the
   * sentences version 8 actually shipped and requires them to be refused.
   */
  const offenders = refusals(body).filter((f) => /outside the markers/.test(f.rule));
  assert.deepEqual(
    offenders.map((f) => f.line),
    [],
    "a number outside the markers is a number no refresh can correct",
  );

  // And the counts are not merely absent from the prose — they are inside the span, where a refresh
  // rewrites them. A section that stated no quantity anywhere would pass the check above and be
  // useless.
  const span = body.slice(a, b);
  assert.match(span, /\*\*[\d,]+ stored posts across \d+ accounts/);
});

test("the claimed post and account counts are the measurement's own", () => {
  /*
   * The specific drift, asserted directly rather than through the structural rule above: the
   * headline sentence is compared against `latest.json`. For six weeks it said fifty-nine and
   * seven while the file said 1,899 and eight.
   */
  const headline = span.match(
    /\*\*([\d,]+) stored posts across (\d+) accounts, posted ([\d-]+) to ([\d-]+), measured ([\d-]+)\.\*\*/,
  );
  assert.ok(headline, "the span has no headline stating what was measured");

  assert.equal(Number(headline[1].replace(/,/g, "")), latest.posts);
  assert.equal(Number(headline[2]), latest.accounts);
  assert.equal(headline[5], String(latest.measured_at).slice(0, 10));

  // And the window is the corpus's own, not a date anybody typed.
  const windows = latest.report.map((r: { window: { from: string; to: string } }) => r.window)
    .filter(Boolean);
  assert.equal(headline[3], windows.map((w: { from: string }) => w.from).sort()[0]);
  assert.equal(headline[4], windows.map((w: { to: string }) => w.to).sort().pop());
});

test("every writer on the roster gets a row, and an absent one says so", () => {
  for (const w of REFERENCE_WRITERS) {
    assert.ok(span.includes(`| ${w.name} | ${w.handle} |`), `no row for ${w.handle}`);
  }

  // The row that was denied for six weeks, asserted as present with its real count.
  const adam = latest.report.find((r: { handle: string }) => r.handle === "adam-treboutat");
  assert.ok(adam, "adam-treboutat is absent from the measurement");
  assert.ok(
    span.includes(`| Adam Treboutat | adam-treboutat | ${adam.posts_measured} |`),
    "the account the prose called empty has no row carrying its post count",
  );
  assert.ok(
    !/returned zero posts|not collected/i.test(span),
    "the span still says an account returned nothing",
  );

  // And the other direction: drop a writer from the measurement and the span reports the gap
  // rather than silently shortening the table.
  const short = {
    ...latest,
    report: latest.report.filter((r: { handle: string }) => r.handle !== "adam-treboutat"),
  };
  const shortSpan = measurementSpan(short);
  assert.ok(shortSpan.includes("| Adam Treboutat | adam-treboutat | **none** |"));
  assert.match(shortSpan, /adam-treboutat returned nothing/);
});

/* ── The three refusals ───────────────────────────────────────────────────── */

test("the section carries nothing addressed to Josh, and no changelog", () => {
  assert.deepEqual(refusals(body), []);
});

test("the refusals actually fire on what version 8 shipped", () => {
  /*
   * A guard that passes on correct input and has never been shown failing input is a guard nobody
   * has tested. These three strings are verbatim from version 8.
   */
  const fork = "**Josh — this is a real fork.** We have kept your banned-phrases rule";
  const caution = "**One specific caution, Josh.** Matt Barker is not a peer reference here";
  const changelog = "**This section said he did, and that was wrong.**";
  const stale = "**59 posts across 7 accounts were collected on 7 September 2026 and measured.**";

  for (const [label, text] of [
    ["the fork", fork],
    ["the caution", caution],
    ["the changelog", changelog],
  ] as const) {
    const found = refusals(`# x\n\n${text}\n\n${START}\n${END}`);
    assert.ok(found.length > 0, `${label} was not refused`);
  }

  // The stale count, outside the markers, which is the shape of the original defect.
  const found = refusals(`# x\n\n${stale}\n\n${START}\n${END}`);
  assert.ok(
    found.some((f) => /outside the markers/.test(f.rule)),
    "a count outside the markers was not refused",
  );

  // The same sentence INSIDE the markers is fine — that is the whole point of the boundary.
  assert.deepEqual(refusals(`# x\n\n${START}\n${stale}\n${END}`), []);
});

test("prose about Josh is allowed; prose to Josh is not", () => {
  /*
   * The first version of this refusal matched on his NAME and refused "**Josh writes in the second
   * mode.**" — the derived sentence that carries the judgement the whole scene/cut split exists to
   * record. A section about his standard will say his name. What may not appear is the vocative and
   * the second person: a drafter reading "your rules" cannot know whose, and one invited to "say so"
   * has been handed a conversation it is not in.
   */
  assert.deepEqual(refusals(`${START}\n**Josh writes in the second mode.**\n${END}`), []);
  assert.ok(refusals(`${START}\nWe have kept your rule.\n${END}`).length > 0);
  assert.ok(refusals(`${START}\nIf you want it, say so.\n${END}`).length > 0);
});

/* ── The budget ───────────────────────────────────────────────────────────── */

test("the section stays inside its recorded budget", () => {
  /*
   * What stops the 8 KB coming back. Version 8 was 10,924 characters and 8,287 of them were one
   * writer's shape, on every drafting brief. Every individual addition to it was defensible when it
   * was made, which is exactly why the limit has to be a number rather than a judgement.
   */
  assert.ok(
    body.length <= SECTION_BUDGET,
    `reference_posts is ${body.length} characters, over the ${SECTION_BUDGET} budget`,
  );

  /*
   * THE INVARIANT IS NOT A FRACTION OF VERSION 8 ANY MORE, AND THAT IS DELIBERATE.
   *
   * It was "under half of 10,924". The fourth restoration came within sixty characters of breaking
   * it — and a test that would have been tripped by restoring his own deleted reasoning is a test
   * pointed at the wrong thing. It would have made the budget an argument for leaving his argument
   * deleted, which is the exact trade that caused this defect.
   *
   * So the invariant is the failure the budget actually exists to prevent: this section may never
   * grow to the size of what was taken out of it — 8,287 characters of one writer's shape, shipped
   * on every drafting brief whichever writer was named, and on one where none was.
   */
  assert.ok(
    SECTION_BUDGET < REMOVED_WRITER_READ_CHARS,
    "the budget would allow the section to regrow to the size of the writer read removed from it",
  );
});

/* ── One block, not three ─────────────────────────────────────────────────── */

test("only one place composes the measurement table", () => {
  /*
   * The root cause. `block()` lived in `scripts/sentinel-refresh.mjs` and a hand-copy lived in
   * `supabase/functions/cc-submit/maintenance.ts`, and the two disagreed about the denominator of
   * the identical sentence: the script reported the corroborating fractions over every stored post,
   * the copy over the posts that kept their line breaks. The same corpus produced a different
   * section depending on which door ran last, and neither file mentioned the other.
   *
   * A source grep, because that is the check that catches the mistake where it is made rather than
   * three weeks later in a section that argues with itself.
   */
  const sources = [
    "scripts/sentinel-refresh.mjs",
    "supabase/functions/cc-submit/maintenance.ts",
    "scripts/load-josh-library.mjs",
  ];

  for (const path of sources) {
    const source = read(path);
    assert.ok(
      !source.includes("| Account | Handle |") && !source.includes("| Account | Posts |"),
      `${path} composes the per-writer table itself instead of calling measurementSpan`,
    );
    assert.match(
      source,
      /library-spans\.ts/,
      `${path} writes this section without using the shared composer`,
    );
  }

  // The heading exists once, here.
  assert.match(TABLE_HEADER, /^\| Account \| Handle \|/);
});

test("both refreshers splice through the one function", () => {
  // Not identical output asserted by running them — one needs a scrape file and the other a
  // database. Asserted where it is decidable: neither builds its own body any more.
  for (const path of ["scripts/sentinel-refresh.mjs", "supabase/functions/cc-submit/maintenance.ts"]) {
    const source = read(path);
    assert.match(source, /spliceSpan\(/, `${path} splices by hand`);
    assert.match(source, /measurementSpan\(/, `${path} composes its own span`);
    assert.match(source, /refusals\(/, `${path} can store a body nothing checked`);
  }
});

/* ── The split the MCP tools cite ─────────────────────────────────────────── */

test("the scene/cut split is derived, and reproduces the recorded roster", () => {
  /*
   * `measure.mjs` and `voice.mjs` each hardcode this roster and each comment that it is "a judgement
   * recorded in the reference_posts library section". By 28 October that document named Ryan Carlin
   * at 6 / 28 / 19 where he measures 8 / 23 / 21, counted three cut writers when there were four,
   * and had then been overwritten entirely — so the passage they cite did not exist.
   *
   * Derived now. The judgement — that Josh writes in the scene mode and so the scene writers are the
   * useful reference — is kept; membership is read off the corpus.
   */
  const modes = splitModes(latest.report);
  assert.equal(modes.cut.length + modes.scene.length, latest.report.length);

  const handles = (rows: { handle: string }[]) => rows.map((r) => r.handle).sort();
  assert.deepEqual(
    handles(modes.scene),
    ["demandjen1", "juliacarter98", "mattjbarker1", "outboundphd"],
    "the derived scene roster no longer matches the one measure.mjs and voice.mjs hardcode",
  );
  assert.deepEqual(
    handles(modes.cut),
    ["adam-treboutat", "amangrowth", "curtishowland", "ryanscarlin"],
    "the cut roster has changed; measure.mjs and voice.mjs need telling",
  );

  // The boundary is printed so a reader can see whether it is a cliff or a coin toss.
  assert.ok(modes.gap && modes.gap.over > modes.gap.under);
  assert.match(span, new RegExp(`\\*\\*${modes.threshold} words\\*\\*`));
});

/* ── Where the writer read went ───────────────────────────────────────────── */

test("the writer reads section is in no view at all", () => {
  /*
   * The protection is that `renderLibrary` filters by `wanted.has(row.key)`, so a key in no view
   * reaches no prompt. Adding it to `DRAFTING_SECTIONS` would put 8 KB of one writer's shape back on
   * every brief whichever handle was passed — which is what it was doing until 28 October, and what
   * a control run with no handle read as its shape target.
   */
  for (const view of Object.keys(VIEWS)) {
    assert.ok(
      !VIEWS[view as keyof typeof VIEWS].includes(WRITER_READS_KEY),
      `${view} includes ${WRITER_READS_KEY}, so one writer's shape ships on every ${view} run`,
    );
  }
  assert.ok(!DRAFTING_SECTIONS.includes(WRITER_READS_KEY as never));
  assert.ok(!GATING_SECTIONS.includes(WRITER_READS_KEY as never));

  // And the script that writes it targets that key rather than the drafting section.
  const script = read("scripts/matt-barker-structure.mjs");
  assert.match(script, /WRITER_READS_KEY/);
  assert.ok(
    !/section_key:\s*"reference_posts"/.test(script),
    "the Barker read still proposes against the section a drafter reads",
  );
});

test("the roster matches the one the MCP server matches his words against", () => {
  // Two copies on purpose — see the note on REFERENCE_WRITERS — so they are tested against each
  // other rather than silently diverging over which eight writers clause 8.3 names.
  const writers = read("mcp-server/writers.mjs");
  for (const w of REFERENCE_WRITERS) {
    assert.ok(
      writers.includes(`handle: "${w.handle}"`),
      `${w.handle} is in the library roster and not in mcp-server/writers.mjs`,
    );
  }
  const theirs = [...writers.matchAll(/\{ handle: "([^"]+)", name:/g)].map((m) => m[1]);
  assert.deepEqual(theirs.sort(), REFERENCE_WRITERS.map((w) => w.handle).sort());
});

/* ── The second exemption, and what it deliberately does not cover ────────── */

test("a date citation survives the no-numbers rule; a count does not", () => {
  /*
   * The rule exists to stop an UNDERIVED COUNT drifting, not to strip provenance. The first version
   * of it deleted "His 3 September post states the lived-experience test" — a citation saying where
   * a claim about him came from, which no measurement can contradict. A rule that destroys evidence
   * to protect against staleness has the wrong target.
   *
   * So the exemption is narrow, and the test that matters is the one proving it is not a hole: the
   * sentence that caused this entire defect contains a date AND a count, and it must still refuse.
   */
  assert.deepEqual(
    refusals(`# x\n\nHis 3 September post states the lived-experience test.\n\n${START}\n${END}`),
    [],
    "a day-and-month citation of something he wrote was refused",
  );
  assert.deepEqual(
    refusals(`# x\n\nMeasured 20 October 2026.\n\n${START}\n${END}`),
    [],
    "a date with a year was refused",
  );

  // The hole it must not become. Only "7 September 2026" is exempt; "59 posts across 7 accounts"
  // is what is left, and it is the whole reason this file exists.
  const stale = "**59 posts across 7 accounts were collected on 7 September 2026 and measured.**";
  assert.ok(
    refusals(`# x\n\n${stale}\n\n${START}\n${END}`)
      .some((f) => /outside the markers/.test(f.rule)),
    "a count wearing a date beside it got through",
  );
  // And a bare number is still a bare number.
  assert.ok(refusals(`# x\n\nAbout 241 of them.\n\n${START}\n${END}`).length > 0);
});

/* ── His own reasoning, which a mechanism ate ─────────────────────────────── */

test("the three passages destroyed by the 20 October refresh are present", () => {
  /*
   * These were his approved argument, not measurement, and they were INSIDE the measurement markers
   * when the 20 October refresh rewrote that span — so a mechanism built to replace numbers replaced
   * reasoning, and nobody decided to. They were absent from the live row for eight days while
   * `measure.mjs` and `voice.mjs` carried comments citing one of them as their source.
   *
   * "Do not let a target length near the drafter" is the one that matters most: it is the sentence
   * that stops a drafter aiming at a median, and the band is handed to every drafter by
   * `measure_draft`. They are outside the markers now, which is where argument belongs, and they
   * state no count — their numbers are read off the table.
   */
  for (const passage of [
    "## There is no house length",
    "Do not let a target length near the drafter",
    "## Two structural modes, and they do not mix",
    "## The closest structural match, and the furthest",
    "Curtis Howland is the furthest",
  ]) {
    assert.ok(body.includes(passage), `"${passage}" is missing from the section`);
  }

  // Restored as ARGUMENT: the stale figures they used to carry are gone, and the claims they make
  // are now the table's to support.
  for (const stale of ["8 of 9 posts", "median 214 words", "6-word opener", "28 words above"]) {
    assert.ok(!body.includes(stale), `the restored prose carries the stale figure "${stale}"`);
  }
});

test("the fourth passage, and the only copy of the range it carries", () => {
  /*
   * The one that nearly went for good. "Sentence-length variation, measured" was inside the
   * measurement markers on 20 October, so the refresh that rewrote that span deleted it — and a
   * grep of the whole repository on 28 October found "9–12" in no other file: not the library, not
   * a script, not a comment, not `data/josh/`. The system held one record of what a drafter should
   * aim at for sentence variation and a mechanism built to replace numbers removed it.
   *
   * Eight days later three of six drafters were handed the measured band with nothing about whether
   * to hit it, and one reported being shown bands it "had not been told to hit". The passage that
   * answered that question had been gone the whole time.
   */
  assert.ok(body.includes("## Sentence-length variation, and the one target he has stated"));
  assert.ok(
    body.includes("nearer 9–12 than at the foot of that column"),
    "the only record of his stated variation range is missing again",
  );
  assert.ok(
    body.includes("**The band in the table is not an instruction.**"),
    "the sentence separating his instruction from the measured band is missing",
  );

  // The measured floor is NOT written into the prose. The original said "nearer 9–12 than 3", and
  // the 3 was one writer's measured figure, which moves on every refresh.
  assert.ok(!/than 3\b/.test(body), "a measured figure is written into the restored prose");
});

test("his recorded preferences are exempt from the no-numbers rule, and only those", () => {
  /*
   * The third exemption, and the narrowest. A measured figure moves, so it lives inside the markers;
   * a preference of his does not move and must survive a refresh, so it lives outside. "A number
   * that is a judgement" would swallow everything, so the exemption is these literal strings and
   * nothing pattern-matched.
   */
  assert.ok(HIS_RECORDED_PREFERENCES.length > 0);
  for (const p of HIS_RECORDED_PREFERENCES) {
    // Each one carries what it is about and where it came from, or it is just a magic number.
    assert.ok(p.about.length > 30, `${p.value} has no account of what it is`);
    assert.ok(p.recorded.length > 20, `${p.value} has no provenance`);
    assert.deepEqual(
      refusals(`# x\n\nLand nearer ${p.value} than the foot of the column.\n\n${START}\n${END}`),
      [],
      `${p.value} is enumerated as his preference and was still refused`,
    );
  }

  // And it is not a general licence for ranges. A range nobody enumerated still refuses.
  assert.ok(
    refusals(`# x\n\nLand nearer 14–18 than the foot.\n\n${START}\n${END}`).length > 0,
    "an un-enumerated range got through, so the exemption is a pattern and not a list",
  );
});
