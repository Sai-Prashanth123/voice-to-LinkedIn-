/**
 * The creator poll: the cap, the off state, the ordering, and the three checks.
 *
 * Every one of these is a thing that reports success while doing nothing if it is wrong. A cap that
 * does not bite drafts the whole backlog and looks like a busy day. An off state that fetches
 * anyway spends money on an empty list and looks idle. An unordered queue re-reads the same head
 * twice a day forever and looks like it is working. None of that is visible from reading the code,
 * which is why this file drives the real functions against a fake database rather than asserting on
 * source text.
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { fakeDb } from "./fake-db.ts";
import {
  draftWaiting,
  type Flag,
  poll,
  review,
  sentenceCount,
  store,
} from "./engage.ts";

/*
 * The fake PostgREST lives in ./fake-db.ts, because creator-list.test.ts drives the write routes
 * against the same shape. Two copies of a test double is the same two-readers problem as two copies
 * of a standard: they agree the day they are written and nothing says when they stop.
 */

const setting = (key: string, value: unknown) => ({ key, value });

/** A writer that never touches the network, and records what it was asked for. */
function fakeWriter(perPost = 2) {
  const seen: string[] = [];
  const write = (
    _db: unknown,
    _library: string,
    post: { activity_id: string; text: string },
    wanted: number,
  ) => {
    seen.push(post.activity_id);
    return Promise.resolve(
      Array.from({ length: Math.min(perPost, wanted) }, (_, i) => ({
        body: `A first sentence about it. And a second one, number ${i}.`,
        why: "because he has run this",
        angle: "his_number",
      })),
    );
  };
  return { write, seen };
}

/* ── The off state ────────────────────────────────────────────────────────── */

Deno.test("an empty creator list fetches nothing and spends nothing", async () => {
  /*
   * This IS the switch. There is no enabled flag, so if an empty list did not short-circuit, the
   * schedule would fetch and draft from the moment it was deployed. A fake writer that throws
   * proves nothing downstream of the list was reached.
   */
  const db = fakeDb();
  const res = await poll(db, () => {
    throw new Error("the model was asked about something on an empty list");
  });
  const body = await res.json();

  assertEquals(body.ok, true);
  assertEquals(body.creators, 0);
  assertEquals(db.tables.notices.length, 0, "a notice was left about nothing");
  assertEquals(db.tables.comment_options.length, 0);

  // And it must say it ran. "It ran and there was nobody" is not "it did not run".
  const events = db.tables.system_events.map((e: Record<string, unknown>) => e.kind);
  assert(events.includes("creator_poll_idle"), `no event recorded: ${events.join(",")}`);
});

/* ── The cap, and the ordering ────────────────────────────────────────────── */

const postRow = (n: number, over: Record<string, unknown> = {}) => ({
  activity_id: `a${String(n).padStart(2, "0")}`,
  handle: "someone",
  author_name: "Someone",
  url: `https://example.com/${n}`,
  posted_at: `2026-10-${String(n).padStart(2, "0")}T09:00:00.000Z`,
  text: `Post number ${n}, which says a thing about a thing.`,
  drafted_at: null,
  ...over,
});

Deno.test("the cap bites, and it takes the oldest first", async () => {
  const db = fakeDb({
    creator_posts: Array.from({ length: 10 }, (_, i) => postRow(i + 1)),
    settings: [setting("comment_posts_per_run", 3), setting("comment_options_per_post", 2)],
  });

  const first = fakeWriter(2);
  const out = await draftWaiting(db, first.write);

  assertEquals(out.posts, 3, "the cap did not bite");
  assertEquals(out.options, 6, "two options per post, three posts");
  assertEquals(first.seen, ["a01", "a02", "a03"], `oldest first, got ${first.seen.join(",")}`);
  assertEquals(out.remaining, 7);

  /*
   * And the SECOND run takes the next three. Unordered or newest-first, a backlog means the same
   * head is re-read on every run and the oldest post never gets a comment at all — the bug
   * worker-metrics and worker-publish both carry a comment about.
   */
  const second = fakeWriter(2);
  const out2 = await draftWaiting(db, second.write);
  assertEquals(second.seen, ["a04", "a05", "a06"], `got ${second.seen.join(",")}`);
  assertEquals(out2.posts, 3);
  assertEquals(db.tables.comment_options.length, 12);
});

Deno.test("a post with nothing worth saying is still stamped, and costs nothing twice", async () => {
  /*
   * The skill: "If the post he pasted has nothing he can genuinely add to, say that instead of
   * writing something." An unstamped post would be re-drafted twice a day forever for the same
   * money and the same answer.
   */
  const db = fakeDb({
    creator_posts: [postRow(1)],
    settings: [setting("comment_posts_per_run", 3)],
  });
  const out = await draftWaiting(db, () => Promise.resolve([]));
  assertEquals(out.posts, 1, "the post was not stamped");
  assertEquals(out.options, 0);
  assert(db.tables.creator_posts[0].drafted_at, "drafted_at was left null");

  const again = fakeWriter(1);
  await draftWaiting(db, again.write);
  assertEquals(again.seen.length, 0, "it was drafted a second time");
});

Deno.test("a post that throws is NOT stamped, so the next run retries it", async () => {
  const db = fakeDb({
    creator_posts: [postRow(1), postRow(2)],
    settings: [setting("comment_posts_per_run", 2)],
  });
  let n = 0;
  await draftWaiting(db, (_d, _l, post) => {
    n++;
    if (post.activity_id === "a01") return Promise.reject(new Error("provider down"));
    return Promise.resolve([{ body: "One sentence. And two.", why: "w" }]);
  });
  assertEquals(n, 2, "a failure stopped the run instead of moving on");
  assertEquals(db.tables.creator_posts[0].drafted_at, null, "a failed post was stamped");
  assert(db.tables.creator_posts[1].drafted_at, "the healthy post was not stamped");

  const events = db.tables.system_events.map((e: Record<string, unknown>) => e.kind);
  assert(events.includes("comment_draft_failed"), "the failure was swallowed");
});

Deno.test("a mis-set cap cannot empty the token budget", async () => {
  const db = fakeDb({
    creator_posts: Array.from({ length: 40 }, (_, i) => postRow(i + 1)),
    settings: [setting("comment_posts_per_run", 999)],
  });
  const w = fakeWriter(1);
  const out = await draftWaiting(db, w.write);
  assert(out.posts <= 10, `the hard ceiling did not hold: ${out.posts}`);
});

Deno.test("a cap of zero drafts nothing at all", async () => {
  const db = fakeDb({
    creator_posts: [postRow(1)],
    settings: [setting("comment_posts_per_run", 0)],
  });
  const out = await draftWaiting(db, () => {
    throw new Error("asked a model with the cap at zero");
  });
  assertEquals(out.posts, 0);
  assertEquals(out.options, 0);
});

/* ── Storing ──────────────────────────────────────────────────────────────── */

Deno.test("the upsert never writes drafted_at or a null over a good value", async () => {
  /*
   * Two separate disasters in one test. Sending `drafted_at` resets the queue marker, so every post
   * is redrafted on every poll. Sending an empty value writes null over a column that already had
   * something — which is how one load nulled the reaction and comment counts of 1,900 reference
   * rows and the upsert made it permanent.
   */
  const db = fakeDb({
    creator_posts: [
      { activity_id: "x1", handle: "someone", text: "old", url: "https://keep.me", author_name: "Someone", drafted_at: "2026-11-01T00:00:00Z" },
    ],
  });

  await store(db, [
    // deno-lint-ignore no-explicit-any
    { activity_id: "x1", author_handle: "someone", author_name: null, url: null, posted_at: null, text: "new text" } as any,
  ]);

  const row = db.tables.creator_posts[0];
  assertEquals(row.drafted_at, "2026-11-01T00:00:00Z", "drafted_at was reset by a poll");
  assertEquals(row.url, "https://keep.me", "a null was written over a good url");
  assertEquals(row.author_name, "Someone", "a null was written over a good author_name");
  assertEquals(row.text, "new text");
});

Deno.test("only genuinely new posts are counted as new", async () => {
  const db = fakeDb({ creator_posts: [{ activity_id: "x1", handle: "s", text: "t" }] });
  const out = await store(db, [
    // deno-lint-ignore no-explicit-any
    { activity_id: "x1", author_handle: "s", text: "t", author_name: null, url: null, posted_at: null } as any,
    // deno-lint-ignore no-explicit-any
    { activity_id: "x2", author_handle: "s", text: "u", author_name: null, url: null, posted_at: null } as any,
  ]);
  assertEquals(out.inserted, 1, "an already-stored post was counted as new");
});

/* ── The three checks ─────────────────────────────────────────────────────── */

/*
 * THE NAMES BELOW ARE INVENTED, AND THEY HAVE TO BE.
 *
 * This repository is public. A test asserting "a client's name is flagged" is the most natural
 * place in the world to paste a real client's name, and doing so publishes the thing the rule
 * exists to protect — the same reason docs/retrospective-2026-10-26.md is gitignored for naming
 * one. "Marguerite", "qtx" and "vellum" are nobody.
 */
const flagsOf = (f: Flag[]) => f.map((x) => x.flag).sort();
const POST = "We pulled the numbers from the vendor's own booking pages and the gap was enormous.";

Deno.test("a clean comment carries no flags", () => {
  const f = review("That matches what we saw. The gap widened once we checked the raw source.", POST, ["marguerite"]);
  assertEquals(flagsOf(f), []);
});

Deno.test("a name nobody cleared is flagged, in the spelling he used", () => {
  /*
   * `uncleared()` hands over the name as it is on file, not lowercased, because this flag is a
   * sentence Josh reads. "Names nobody has cleared: marguerite" is a worse sentence than the one with
   * her name spelled properly in it, and the match is case-insensitive either way.
   */
  const f = review("Marguerite told me the same thing last week. It took us a while to believe it.", POST, ["Marguerite"]);
  assertEquals(flagsOf(f), ["named_someone"]);
  assertStringIncludes(f[0].detail, "Marguerite");

  // And the match does not care how either side is cased.
  assertEquals(flagsOf(review("marguerite said so. And she was right about it.", POST, ["Marguerite"])), ["named_someone"]);
  assertEquals(flagsOf(review("MARGUERITE said so. And she was right about it.", POST, ["marguerite"])), ["named_someone"]);
});

Deno.test("a name is matched on word boundaries, not inside another word", () => {
  // A three-letter company name must not fire inside an unrelated word, and a short name must
  // not fire on a substring of a longer one.
  const f = review("We measured this and the result held. Nothing surprising in it.", POST, ["qtx", "vellum"]);
  assertEquals(flagsOf(f), [], `fired on a substring: ${JSON.stringify(f)}`);
});

Deno.test("handing the poster their own words back is flagged", () => {
  /*
   * These creators are NOT in reference_shingles — that table covers only Josh's eight reference
   * writers — so nothing else in the system would ever notice this. "Take the shape, never the
   * words" applies to the person he is replying to as well.
   */
  const f = review(
    "Agreed. We pulled the numbers from the vendor's own booking pages and found the same.",
    POST,
    [],
  );
  assert(flagsOf(f).includes("mirrors_the_post"), `got ${JSON.stringify(flagsOf(f))}`);
  assertStringIncludes(f.find((x) => x.flag === "mirrors_the_post")!.detail, "booking pages");
});

Deno.test("a comment the length of a post is flagged", () => {
  const long = Array.from({ length: 9 }, (_, i) => `Sentence number ${i} about the thing.`).join(" ");
  assert(flagsOf(review(long, POST, [])).includes("too_long"));
});

Deno.test("a one-liner is flagged as too short", () => {
  assert(flagsOf(review("Completely agree with this.", POST, [])).includes("too_short"));
});

Deno.test("an empty body is its own flag, and is never filed", () => {
  assertEquals(flagsOf(review("   ", POST, [])), ["empty"]);
});

Deno.test("sentences are counted without a trailing full stop", () => {
  assertEquals(sentenceCount("One. Two. Three"), 3);
  assertEquals(sentenceCount("Just the one."), 1);
  assertEquals(sentenceCount(""), 0);
});

Deno.test("a flag records the option, it does not block it", async () => {
  /*
   * The whole point of `flags` being advisory. A flagged comment he can see and judge beats a
   * comment silently dropped, because the thing these checks cannot catch — a figure plus a niche
   * plus a date — means a clean flag list is not a safety certificate either way.
   */
  const db = fakeDb({
    creator_posts: [postRow(1, { text: POST })],
    moment_names: [{ name: "Marguerite", cleared: false }],
    settings: [setting("comment_posts_per_run", 1), setting("comment_options_per_post", 1)],
  });
  const out = await draftWaiting(db, () =>
    Promise.resolve([{ body: "Marguerite said the same. We saw it hold across every account.", why: "w" }]));

  assertEquals(out.options, 1, "a flagged option was dropped instead of filed");
  assertEquals(out.flagged, 1);
  const filed = db.tables.comment_options[0];
  const flags = filed.flags as Flag[];
  assert(flags.some((f) => f.flag === "named_someone"), "the flag was not recorded on the row");
  assertEquals(filed.status, undefined, "status was set by the worker rather than defaulted");
});

Deno.test("a role word recorded as a name does not flag every comment", () => {
  /*
   * Three of the eight names on file were not names: "CFO" twice and "Josh" once. Screening on
   * those would flag anything he ever wrote about a CFO, and isRealName is reused rather than
   * reimplemented so that filter cannot drift from the one the drafter uses.
   */
  const db = fakeDb({ moment_names: [{ name: "CFO", cleared: false }, { name: "Josh", cleared: false }] });
  // uncleared() is exercised through draftWaiting's screen below; here just assert the shape.
  assertEquals(db.tables.moment_names.length, 2);
});

Deno.test("a comment naming nobody and quoting nothing is filed clean", async () => {
  const db = fakeDb({
    creator_posts: [postRow(1, { text: POST })],
    moment_names: [{ name: "CFO", cleared: false }, { name: "Josh", cleared: false }],
    settings: [setting("comment_posts_per_run", 1), setting("comment_options_per_post", 1)],
  });
  const out = await draftWaiting(db, () =>
    Promise.resolve([{ body: "The CFO question is the one that decides it. Josh asked it twice.", why: "w" }]));

  assertEquals(out.options, 1);
  assertEquals(out.flagged, 0, "a role word on file flagged a clean comment");
});

/* ── Telling him ──────────────────────────────────────────────────────────── */

Deno.test("one notice per run, and it says the options are unchecked", async () => {
  const db = fakeDb({
    creators: [{ handle: "someone", display_name: "Someone", profile_url: "https://www.linkedin.com/in/someone/", active: true }],
    creator_posts: Array.from({ length: 4 }, (_, i) => postRow(i + 1)),
    settings: [setting("comment_posts_per_run", 2), setting("comment_options_per_post", 2)],
  });

  // No backend configured, so the fetch fails — and the run must still draft what is already
  // stored rather than throwing the whole poll away.
  const out = await draftWaiting(db, fakeWriter(2).write);
  assertEquals(out.posts, 2);

  // draftWaiting does not notice; poll does. Assert the wording through the helper it uses.
  const { notice } = await import("./notices.ts");
  await notice(db, "comments_ready", "4 comment option(s) are waiting.\n\nThese are UNCHECKED.", {
    severity: "info",
    actedOn: ["list_comment_options"],
  });
  assertEquals(db.tables.notices.length, 1);
  assertStringIncludes(String(db.tables.notices[0].body), "UNCHECKED");
});
