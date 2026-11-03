/**
 * The three write routes behind the creator list, and the parser that decides who is on it.
 *
 * `handleFrom` is the one worth the most attention. He will paste a URL, because that is what
 * LinkedIn gives you when you press share, and he will also just type a name. If those two land on
 * different rows he ends up watching one person twice under two spellings — and because the poll
 * cannot narrow by date, that means fetching the same profile twice and paying for it twice, every
 * run, forever, with nothing in the output saying so.
 *
 * The routes are driven against a fake PostgREST. What a fake cannot tell you is whether the
 * CHECK constraints and the grants hold; `local/probe-0061.mjs` answers that against real Postgres
 * by applying every migration to a fresh cluster and then trying to break each one.
 */

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { fakeDb } from "./fake-db.ts";
import {
  handleFrom,
  profileUrlFor,
  recordCommentUsed,
  stopWatchingCreator,
  watchCreator,
} from "../cc-submit/creators.ts";

// deno-lint-ignore no-explicit-any
const call = async (fn: any, db: any, body: Record<string, unknown>) => {
  const res = await fn(db, body);
  return { status: res.status, body: await res.json() };
};

/* ── The parser ───────────────────────────────────────────────────────────── */

Deno.test("every way he might give one person lands on the same handle", () => {
  const forms = [
    "mattjbarker1",
    "@mattjbarker1",
    "in/mattjbarker1",
    "linkedin.com/in/mattjbarker1",
    "www.linkedin.com/in/mattjbarker1",
    "https://linkedin.com/in/mattjbarker1",
    "https://www.linkedin.com/in/mattjbarker1",
    "https://www.linkedin.com/in/mattjbarker1/",
    // What you actually get off the share button.
    "https://www.linkedin.com/in/mattjbarker1/?originalSubdomain=uk",
    "https://www.linkedin.com/in/mattjbarker1/#experience",
    "  https://www.linkedin.com/in/mattjbarker1/  ",
    "HTTPS://WWW.LINKEDIN.COM/in/mattjbarker1/",
  ];
  for (const form of forms) {
    assertEquals(handleFrom(form), "mattjbarker1", `"${form}" did not resolve`);
  }
});

Deno.test("a percent-encoded handle is decoded, not stored encoded", () => {
  assertEquals(handleFrom("https://www.linkedin.com/in/jen%2Dallen/"), "jen-allen");
});

Deno.test("handles with the characters LinkedIn actually allows are kept", () => {
  assertEquals(handleFrom("adam-treboutat"), "adam-treboutat");
  assertEquals(handleFrom("wayne-marlton-the-dm-edge"), "wayne-marlton-the-dm-edge");
  assertEquals(handleFrom("demand.jen"), "demand.jen");
  assertEquals(handleFrom("some_one"), "some_one");
});

Deno.test("what is not a profile is refused rather than stored as one", () => {
  for (
    const bad of [
      "",
      "   ",
      "a", // one character
      "https://example.com/someone",
      "https://www.linkedin.com/company/slingshot",
      "https://www.linkedin.com/feed/",
      "Matt Barker", // a space: a display name, not a handle
      "in/",
      "a/b",
    ]
  ) {
    assertEquals(handleFrom(bad), null, `"${bad}" was accepted as a handle`);
  }
});

Deno.test("the url is derived from the handle, so both spellings cannot disagree", () => {
  assertEquals(profileUrlFor("mattjbarker1"), "https://www.linkedin.com/in/mattjbarker1/");
  // And it satisfies the constraint the table enforces.
  assert(/^https:\/\/(www\.)?linkedin\.com\/in\//.test(profileUrlFor("x1")));
});

/* ── watch_creator ────────────────────────────────────────────────────────── */

Deno.test("watching someone stores the handle and the derived url", async () => {
  const db = fakeDb();
  const { body } = await call(watchCreator, db, {
    creator: "https://www.linkedin.com/in/mattjbarker1/?originalSubdomain=uk",
    display_name: "Matt Barker",
  });

  assertEquals(body.ok, true);
  assertEquals(body.handle, "mattjbarker1");
  assertEquals(body.watching, 1);
  assertEquals(db.tables.creators.length, 1);
  assertEquals(db.tables.creators[0].profile_url, "https://www.linkedin.com/in/mattjbarker1/");
  assertEquals(db.tables.creators[0].display_name, "Matt Barker");
  assertEquals(db.tables.creators[0].active, true);
});

Deno.test("asking twice does not make a second row, and does not read as an error", async () => {
  /*
   * He will do this. Two rows for one person means the poll fetches that profile twice and pays
   * twice, on every run, and nothing in the output would say so.
   */
  const db = fakeDb();
  await call(watchCreator, db, { creator: "mattjbarker1", display_name: "Matt Barker" });
  const { status, body } = await call(watchCreator, db, {
    creator: "https://www.linkedin.com/in/mattjbarker1/",
  });

  assertEquals(status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.already_watching, true);
  assertEquals(db.tables.creators.length, 1, "a second row was created for the same person");
  assertStringIncludes(body.next, "Already watching");
});

Deno.test("re-watching does not wipe the name he gave earlier", async () => {
  const db = fakeDb();
  await call(watchCreator, db, { creator: "mattjbarker1", display_name: "Matt Barker" });
  await call(watchCreator, db, { creator: "mattjbarker1" });
  assertEquals(db.tables.creators[0].display_name, "Matt Barker", "a null overwrote his name");
});

Deno.test("someone he stopped watching is reactivated, not duplicated", async () => {
  // 6.3: the old row is still there and the stored posts still point at it.
  const db = fakeDb({
    creators: [{
      handle: "mattjbarker1",
      display_name: "Matt Barker",
      profile_url: "https://www.linkedin.com/in/mattjbarker1/",
      active: false,
    }],
  });
  const { body } = await call(watchCreator, db, { creator: "mattjbarker1" });

  assertEquals(db.tables.creators.length, 1);
  assertEquals(db.tables.creators[0].active, true);
  assertEquals(body.already_watching, false);
  assertStringIncludes(body.next, "again");
});

Deno.test("a profile it cannot read is refused with something he can act on", async () => {
  const db = fakeDb();
  const { status, body } = await call(watchCreator, db, { creator: "Matt Barker" });
  assertEquals(status, 400);
  assertEquals(db.tables.creators.length, 0);
  assertStringIncludes(body.error, "Matt Barker");
  assertStringIncludes(body.error, "/in/");
});

Deno.test("no creator at all is refused without naming an empty string back at him", async () => {
  const db = fakeDb();
  const { status, body } = await call(watchCreator, db, {});
  assertEquals(status, 400);
  assertStringIncludes(body.error, "Tell me who to watch");
  assert(!body.error.includes('""'));
});

Deno.test("the url field is accepted as well as the handle field", async () => {
  // The tool declares `creator`, but a model will reach for `profile_url` or `url` sooner or later
  // and a refusal on the field NAME is a refusal he cannot act on.
  for (const key of ["handle", "profile_url", "url"]) {
    const db = fakeDb();
    const { body } = await call(watchCreator, db, { [key]: "mattjbarker1" });
    assertEquals(body.ok, true, `${key} was not accepted`);
  }
});

/* ── stop_watching_creator ────────────────────────────────────────────────── */

Deno.test("stopping deactivates and deletes nothing", async () => {
  const db = fakeDb({
    creators: [{ handle: "mattjbarker1", profile_url: "https://www.linkedin.com/in/mattjbarker1/", active: true }],
    creator_posts: [{ activity_id: "a1", handle: "mattjbarker1", text: "a post" }],
    comment_options: [{ id: 1, activity_id: "a1", body: "a comment", status: "offered" }],
  });
  const { body } = await call(stopWatchingCreator, db, { creator: "mattjbarker1" });

  assertEquals(body.ok, true);
  assertEquals(db.tables.creators.length, 1, "the creator row was removed");
  assertEquals(db.tables.creators[0].active, false);
  assertEquals(db.tables.creator_posts.length, 1, "their posts were removed");
  assertEquals(db.tables.comment_options.length, 1, "his undecided options were removed");
  assertStringIncludes(body.next, "Nothing was deleted");
});

Deno.test("stopping someone who was never on the list says so", async () => {
  const db = fakeDb();
  const { status, body } = await call(stopWatchingCreator, db, { creator: "nobody-here" });
  assertEquals(status, 404);
  assertStringIncludes(body.error, "not on your list");
});

/* ── record_comment_used ──────────────────────────────────────────────────── */

const withOption = (over: Record<string, unknown> = {}) =>
  fakeDb({
    creator_posts: [{ activity_id: "a1", handle: "someone", text: "a post" }],
    comment_options: [{ id: 1, activity_id: "a1", body: "a comment", status: "offered", decided_at: null, ...over }],
  });

Deno.test("recording what he used sets the status and the timestamp together", async () => {
  /*
   * Both, or the table's own constraint refuses the row — a decision carries its timestamp or it
   * did not happen. The timestamp is what makes "which comments are worth writing" answerable
   * later rather than just "which were ticked".
   */
  const db = withOption();
  const { body } = await call(recordCommentUsed, db, { option_id: 1, status: "used" });

  assertEquals(body.ok, true);
  assertEquals(body.status, "used");
  assertEquals(db.tables.comment_options[0].status, "used");
  assert(db.tables.comment_options[0].decided_at, "status moved without a decided_at");
});

Deno.test("a discarded option is recorded too, because that is also the signal", async () => {
  const db = withOption();
  const { body } = await call(recordCommentUsed, db, { option_id: 1, status: "discarded" });
  assertEquals(db.tables.comment_options[0].status, "discarded");
  assertStringIncludes(body.next, "just as useful");
});

Deno.test("recording the same decision twice is not an error and changes nothing", async () => {
  const db = withOption({ status: "used", decided_at: "2026-11-01T00:00:00Z" });
  const { status, body } = await call(recordCommentUsed, db, { option_id: 1, status: "discarded" });

  assertEquals(status, 200);
  assertEquals(body.unchanged, true);
  assertEquals(
    db.tables.comment_options[0].status,
    "used",
    "a decision he had already made was silently overwritten",
  );
  assertEquals(db.tables.comment_options[0].decided_at, "2026-11-01T00:00:00Z");
});

Deno.test("an option that does not exist is refused, not invented", async () => {
  const db = withOption();
  const { status, body } = await call(recordCommentUsed, db, { option_id: 999, status: "used" });
  assertEquals(status, 404);
  assertStringIncludes(body.error, "999");
});

Deno.test("a status outside the two is refused", async () => {
  const db = withOption();
  const { status, body } = await call(recordCommentUsed, db, { option_id: 1, status: "published" });
  assertEquals(status, 400);
  assertStringIncludes(body.error, "published");
  assertEquals(db.tables.comment_options[0].status, "offered");
});

Deno.test("a missing option_id is refused rather than defaulting to a row", async () => {
  const db = withOption();
  const { status } = await call(recordCommentUsed, db, { status: "used" });
  assertEquals(status, 400);
  assertEquals(db.tables.comment_options[0].status, "offered");
});

Deno.test("used:false is read as discarded, because a model will send it", async () => {
  const db = withOption();
  await call(recordCommentUsed, db, { option_id: 1, used: false });
  assertEquals(db.tables.comment_options[0].status, "discarded");
});
