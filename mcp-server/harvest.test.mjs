/**
 * The shared harvest core: who wrote a row, and what either backend's row becomes.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `scripts/lib/harvest.mjs` was extracted out of `scripts/scrape-sentinels.mjs` so that
 * `worker-engage` could fetch creator posts without a second copy of `handleOf`. An extraction is
 * exactly the kind of change that typechecks, passes every existing test, and is wrong — so the
 * guard that matters most gets its own tests here, pinned to the behaviour the script documented
 * rather than to whatever the new code happens to do.
 *
 * THE FIXTURES ARE SYNTHETIC ON PURPOSE.
 *
 * The field names are real, read off a live console job on 3 November 2026 (job 44361:
 * activity_id, url, author_name, author_handle, subject_handle, posted_at, date_precision, text,
 * headline, reaction_count, comment_count, is_repost). The TEXT is invented. Three of that job's
 * eleven rows were written by people who are not Josh's and not ours, and this is a public
 * repository — clause 8.3 is why `docs/verify/all-openings.md` is gitignored, and a test fixture is
 * not an exception to it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { first, handleOf, normaliseRows, toIso } from "../scripts/lib/harvest.mjs";

/** Shaped like Josh's creator list or the hardcoded eight: handle -> display name. */
const ALLOWED = { mattjbarker1: "Matt Barker", demandjen1: "Jen Allen-Knuth" };

/** A console row. The author is FLAT on the row, and `subject_handle` is whose page it came from. */
const consoleRow = (over = {}) => ({
  activity_id: "7000000000000000001",
  url: "https://www.linkedin.com/posts/mattjbarker1_example-activity-7000000000000000001-aaaa",
  author_name: "Matt Barker",
  author_handle: "mattjbarker1",
  subject_handle: "mattjbarker1",
  posted_at: "2026-11-03T07:25:08.217000+00:00",
  date_precision: "exact",
  text: "A short line standing in for a real post.",
  headline: "Founder",
  reaction_count: 120,
  comment_count: 14,
  is_repost: false,
  ...over,
});

/** An Apify row. The author is NESTED and the date is an OBJECT. Both have bitten before. */
const apifyRow = (over = {}) => ({
  id: "7000000000000000002",
  author: {
    publicIdentifier: "demandjen1",
    name: "Jen Allen-Knuth",
    url: "https://www.linkedin.com/in/demandjen1/",
  },
  postedAt: {
    timestamp: 1791806316736,
    date: "2026-10-12T11:58:36.736Z",
    postedAgoShort: "1w",
    postedAgoText: "1 week ago",
  },
  text: "Another stand-in line.\n\nWith a paragraph break, which Apify keeps.",
  engagement: { likes: 47, comments: 9 },
  ...over,
});

/* ── The guard ────────────────────────────────────────────────────────────── */

test("the console's flat author_handle is read", () => {
  assert.equal(handleOf(consoleRow(), ALLOWED), "mattjbarker1");
});

test("Apify's nested author is read", () => {
  /*
   * These nested names were added after the first Apify run: the console flattens the author onto
   * the row, so the nested lookups were never reached and every Apify row fell through to the URL
   * match below.
   */
  assert.equal(handleOf(apifyRow(), ALLOWED), "demandjen1");
});

test("a row by someone not on the list is refused", () => {
  /*
   * Not hypothetical. Job 44361 returned 11 rows from one profile and 3 were written by other
   * people. A profile page carries other people's posts, so this is the ordinary case, not the
   * edge case.
   */
  assert.equal(handleOf(consoleRow({ author_handle: "someone-else", author_name: "Someone Else" }), ALLOWED), null);
});

test("inputUrl is NOT an author field", () => {
  /*
   * THE TEST THIS FILE EXISTS FOR.
   *
   * `inputUrl` is the profile we ASKED for, not whoever wrote the post. It was in the fallback list
   * once, which meant any row without an author field was attributed to the page it came from. The
   * console never exercised it because it flattens `author_handle` onto every row; the first Apify
   * harvest would have. A path that had never executed was one run away from filing six strangers'
   * posts under Matt's name.
   */
  const row = {
    text: "A post by nobody in particular.",
    posted_at: "2026-11-03T07:25:08Z",
    inputUrl: "https://www.linkedin.com/in/mattjbarker1/",
  };
  assert.equal(handleOf(row, ALLOWED), null, "inputUrl was read as the author");

  // And it must not sneak in through the normaliser either.
  const { rows, foreign } = normaliseRows([row], ALLOWED);
  assert.equal(rows.length, 0, "a row with no author survived normalisation");
  assert.equal(foreign, 1);
});

test("a genuine author URL still works as a fallback", () => {
  const row = {
    text: "No flat handle, no nested author, but a real author URL.",
    posted_at: "2026-11-03T07:25:08Z",
    authorUrl: "https://www.linkedin.com/in/demandjen1/",
  };
  assert.equal(handleOf(row, ALLOWED), "demandjen1");
});

test("an empty allowed list refuses everyone", () => {
  // worker-engage's off state is an empty creator list. It must not be an open door.
  assert.equal(handleOf(consoleRow(), {}), null);
  assert.equal(normaliseRows([consoleRow()], {}).rows.length, 0);
});

test("allowed is not consulted through the prototype chain", () => {
  // `"constructor" in allowed` is true for any object literal, so a handle called `constructor`
  // or `toString` would have been accepted by an `in` check.
  assert.equal(handleOf(consoleRow({ author_handle: "constructor" }), ALLOWED), null);
  assert.equal(handleOf(consoleRow({ author_handle: "toString" }), ALLOWED), null);
});

/* ── Dates ────────────────────────────────────────────────────────────────── */

test("a posted-at is an ISO string, or null, and never a guess", () => {
  assert.equal(toIso("2026-11-03T07:25:08.217000+00:00"), "2026-11-03T07:25:08.217Z");
  assert.equal(toIso(1791806316736), new Date(1791806316736).toISOString());
  // Apify's object shape.
  assert.equal(toIso({ timestamp: 1791806316736, date: "2026-10-12T11:58:36.736Z" }), "2026-10-12T11:58:36.736Z");
  assert.equal(toIso(null), null);
  assert.equal(toIso("not a date"), null, "an unparseable date became a real one");
});

test("an unreadable date leaves posted_at null and says so", () => {
  const { rows, unmapped } = normaliseRows([consoleRow({ posted_at: "nonsense" })], ALLOWED);
  assert.equal(rows[0].posted_at, null);
  assert.ok(unmapped.includes("posted_at"), "a missing date was not reported");
});

/* ── Normalising ──────────────────────────────────────────────────────────── */

test("the activity_id fallback can never be [object Object]", () => {
  /*
   * Interpolating Apify's date object into the fallback id produced the literal string
   * "[object Object]" — stable across every post, so a whole profile would have collapsed onto one
   * primary key.
   */
  const row = apifyRow();
  delete row.id;
  const { rows } = normaliseRows([row], ALLOWED);
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].activity_id.includes("[object Object]"), `id was ${rows[0].activity_id}`);
  assert.ok(rows[0].activity_id.startsWith("demandjen1:2026-10-12T11:58:36.736Z:"));
});

test("nested engagement counts win over the flat names", () => {
  /*
   * The flat names did not match Apify's nested `engagement.*`, and `first()` returns null for a
   * name it cannot find rather than complaining — so one load wrote null over the reaction and
   * comment counts of all 1,900 reference rows and the upsert made it permanent. One row survived.
   */
  const { rows } = normaliseRows([apifyRow()], ALLOWED);
  assert.equal(rows[0].reaction_count, 47);
  assert.equal(rows[0].comment_count, 9);

  // And the console's flat names still work.
  const { rows: c } = normaliseRows([consoleRow()], ALLOWED);
  assert.equal(c[0].reaction_count, 120);
  assert.equal(c[0].comment_count, 14);
});

test("a row with no text is dropped and reported, not stored empty", () => {
  const { rows, unmapped } = normaliseRows([consoleRow({ text: "   " })], ALLOWED);
  assert.equal(rows.length, 0);
  assert.ok(unmapped.includes("text"));
});

test("foreign rows are counted, so an empty harvest is distinguishable", () => {
  /*
   * A run that dropped everything and a run where nobody posted look identical without this. The
   * worker reports it for the same reason create_draft reports "0 found across 114 drafts".
   */
  const { rows, foreign } = normaliseRows(
    [consoleRow(), consoleRow({ author_handle: "stranger-one" }), consoleRow({ author_handle: "stranger-two" })],
    ALLOWED,
  );
  assert.equal(rows.length, 1);
  assert.equal(foreign, 2);
});

test("author_name falls back to the name on the list", () => {
  const { rows } = normaliseRows([consoleRow({ author_name: null })], ALLOWED);
  assert.equal(rows[0].author_name, "Matt Barker");
});

test("first() reaches into nested objects and skips empty strings", () => {
  assert.equal(first({ a: { b: "x" } }, "a.b"), "x");
  assert.equal(first({ a: "" , b: "y" }, "a", "b"), "y", "an empty string was treated as present");
  assert.equal(first({}, "nope"), null);
});

/* ── Fit for the edge runtime, and fit for a poller ───────────────────────── */

const SOURCE = readFileSync(new URL("../scripts/lib/harvest.mjs", import.meta.url), "utf8");

test("nothing from node: is imported, or Deno cannot load it", () => {
  /*
   * The whole reason this is a module and not a copy. `worker-engage` runs in Deno and imports it
   * directly, the way cc-submit imports build-stamp.mjs — a single `node:` import would break that
   * and the breakage would only show up on deploy.
   */
  assert.doesNotMatch(SOURCE, /from "node:/, "harvest.mjs imports a node builtin");
  assert.doesNotMatch(SOURCE, /require\(/, "harvest.mjs uses require");
  // No process, no console: a worker has neither argv nor a terminal to write progress to.
  const code = SOURCE.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(code, /\bprocess\./, "harvest.mjs reads process");
  assert.doesNotMatch(code, /\bconsole\.(log|error|warn)\(/, "harvest.mjs writes to the console");
});

test("the console fetch never passes `since`", () => {
  /*
   * Probed 3 November 2026: the console ACCEPTS `since`, echoes it back, and returns zero rows —
   * 0 rows in 7.8s against 11 in 33.8s for the same unfiltered job, with a qualifying post from
   * that morning sitting there. A poller that passed it would report "nobody posted" forever, which
   * is strictly worse than an unsupported parameter because it looks like an answer.
   */
  const fn = SOURCE.slice(SOURCE.indexOf("export async function fetchFromConsole"), SOURCE.indexOf("export async function apifyApi"));
  const body = fn.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(body, /\bsince\b/, "the console fetch references `since`");
  assert.match(body, /ttl_seconds: 0/, "the console fetch would accept a cached answer");
});

test("the console fetch judges by rows, not by items_scraped", () => {
  // Both successful probes reported items_scraped: 0 while returning 11 rows. Reading the counter
  // would make every poll look empty.
  const code = SOURCE.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.doesNotMatch(code, /items_scraped/, "the fetch reads items_scraped");
  assert.doesNotMatch(code, /\bcoverage\b/, "the fetch reads coverage");
});
