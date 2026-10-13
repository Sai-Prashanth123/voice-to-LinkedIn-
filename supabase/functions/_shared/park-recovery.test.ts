/**
 * An idea that parked has to have a way back, and the way back has to lead somewhere draftable.
 *
 * The three-strike rule (9.8) parks a moment after three rejected drafts, and the notice it posts
 * offers `reopen_idea` as the way out. That route did not work. `reopen_idea` set the status to
 * `captured`, and `captured` is refused by the draft guard in cc-submit with "It has not been
 * interviewed" — on an idea that by definition has full material and three drafts behind it. In
 * one_step mode there is no interview to run either, so the idea was stuck for good.
 *
 * The second fault was the sentence. Every status that was not `captured` or `half_mined` fell
 * through to "It has already moved past drafting." — the exact words Josh quoted in his bug report
 * on 5 October about a different cause, which was fixed. If he ever hit a park he would read the
 * same sentence and reasonably conclude the fix had come undone.
 *
 * Both are about one thing: nothing in the idea bank is deleted, so nothing in it should be
 * unreachable either.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { reopenIdea } from "../cc-submit/decisions.ts";

/** A database that answers per table, because this is about two tables disagreeing. */
function fakeDb(opts: { moment: Record<string, unknown> | null; material: boolean }) {
  const writes: { table: string; row: Record<string, unknown> }[] = [];

  const from = (table: string) => {
    const single = table === "moments"
      ? opts.moment
      : table === "material"
      ? (opts.material ? { moment_id: opts.moment?.id } : null)
      : null;

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: single, error: null }),
      single: () => Promise.resolve({ data: single, error: null }),
      update: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        return Promise.resolve({ data: [{ id: 1 }], error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    };
    return chain;
  };

  // deno-lint-ignore no-explicit-any
  return { db: { from, rpc: () => Promise.resolve({ data: null, error: null }) } as any, writes };
}

const parked = (over: Record<string, unknown> = {}) => ({
  id: 3,
  title: "Champion leaves, succession unclear",
  status: "parked",
  killed: false,
  parked_reason: "Three attempts, three rejections.",
  ...over,
});

test("an idea with material reopens as mined, so it can be drafted straight away", async () => {
  const { db, writes } = fakeDb({ moment: parked(), material: true });

  const res = await reopenIdea(db, { moment_id: 3 });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "mined");

  const update = writes.find((w) => w.table === "moments");
  assert.ok(update, "the moment was never updated");
  assert.equal(update.row.status, "mined", "it went back to a status the drafter refuses");
  assert.equal(update.row.parked_reason, null, "the park reason was left on a live idea");

  // "mined" is on the list cc-submit accepts for drafting. That list is the other half of this fix.
  const guard = await Deno.readTextFile(new URL("../cc-submit/index.ts", import.meta.url));
  assert.match(guard, /\["mined", "queued", "drafted", "gated"\]/);
});

test("an idea with no material still goes back to the interview", async () => {
  const { db, writes } = fakeDb({ moment: parked({ id: 79 }), material: false });

  const body = await (await reopenIdea(db, { moment_id: 79 })).json();

  assert.equal(body.status, "captured");
  assert.equal(writes.find((w) => w.table === "moments")?.row.status, "captured");
});

test("reopening an idea that has material asks him nothing", async () => {
  // The 13 October complaint, arriving by the back door of a reopen. There is nothing to ask about
  // an idea that has already been written up.
  const { db } = fakeDb({ moment: parked(), material: true });

  const body = await (await reopenIdea(db, { moment_id: 3 })).json();

  assert.equal(body.question, null);
  assert.match(body.next, /ready to be written|as it stands/i);
});

test("a killed idea is not a parked one", async () => {
  const { db } = fakeDb({ moment: parked({ killed: true }), material: true });
  const res = await reopenIdea(db, { moment_id: 3 });
  assert.equal(res.status, 409);
});

test("a parked idea is refused in its own words, not in the ones from his bug report", async () => {
  const source = await Deno.readTextFile(new URL("../cc-submit/index.ts", import.meta.url));

  // The fall-through that produced the wrong sentence.
  assert.doesNotMatch(
    source,
    /:\s*"It has already moved past drafting\."/,
    'every status still falls through to "It has already moved past drafting."',
  );
  // Parked says what happened and how to undo it.
  assert.match(source, /moment\.status === "parked"/);
  assert.match(source, /reopen_idea brings it back/);
});
