import { test } from "node:test";
import assert from "node:assert/strict";
import { recordEditDiff, recordVerdict } from "./outcome.ts";

/**
 * 12.2 and 12.4, pinned at the seam that actually broke.
 *
 * The diff was correct code called from the wrong place — inside the successful LinkedIn publish
 * loop, so with LinkedIn unconnected it never ran at all. `classifyEdit` has always had tests; what
 * had none was the question these ask: does the measurement happen without a network, and does it
 * refuse to double-count.
 */

/** The smallest thing that behaves like the PostgREST builder for the calls these two make. */
function fakeDb(tables: Record<string, unknown>) {
  const writes: { table: string; row: Record<string, unknown> }[] = [];

  const builder = (table: string) => {
    let single: unknown = tables[table] ?? null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: single, error: null }),
      single: () => Promise.resolve({ data: single, error: null }),
      upsert: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        single = { ...(single as object ?? {}), ...row };
        return Promise.resolve({ data: null, error: null });
      },
      update: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  };

  // deno-lint-ignore no-explicit-any
  return { db: { from: builder } as any, writes };
}

test("12.2 measures the edit at approval, with nothing from LinkedIn", async () => {
  const { db, writes } = fakeDb({
    posts: { id: 1, moment_id: 4, draft_id: 9, body: "A line that stayed.\n\nAnd a tightened close." },
    drafts: { body: "A line that stayed.\n\nAnd a close that was baggier than it needed to be." },
    outcomes: null,
  });

  const result = await recordEditDiff(db, 1, "approved");

  assert.equal(result.measured, true);
  assert.equal(result.editClass, "light");

  const row = writes.find((w) => w.table === "outcomes")!.row;
  assert.equal(row.edit_stage, "approved");
  assert.ok(row.draft_body, "the draft is kept, not just its score");
  assert.ok(row.approved_body, "and so is what Josh approved");
  assert.equal(row.published_body, null, "nothing has gone out yet");
});

test("a post with no draft behind it is recorded as unmeasurable, not silently skipped", async () => {
  const { db, writes } = fakeDb({
    posts: { id: 2, moment_id: 4, draft_id: null, body: "Typed straight in." },
  });

  const result = await recordEditDiff(db, 2, "approved");

  assert.equal(result.measured, false);
  assert.ok(writes.some((w) => w.table === "system_events"), "12.2 says every time — a post that "
    + "cannot satisfy it must be visible rather than absent");
});

test("publishing an untouched post does not re-measure it", async () => {
  const body = "Approved and never touched again.";
  const { db, writes } = fakeDb({
    posts: { id: 3, moment_id: 4, draft_id: 9, body },
    drafts: { body: "Something quite different." },
    outcomes: { approved_body: body, edit_stage: "approved" },
  });

  const result = await recordEditDiff(db, 3, "published");

  assert.equal(result.measured, false);
  assert.equal(result.reason, "unchanged since approval");
  // It still records that the post went out — it just does not overwrite the honest stage.
  const row = writes.find((w) => w.table === "outcomes")!.row;
  assert.equal(row.published_body, body);
  assert.equal(row.edit_stage, undefined, "the approval measurement stands");
});

test("a body that moved between approval and publishing IS re-measured", async () => {
  const { db } = fakeDb({
    posts: { id: 4, moment_id: 4, draft_id: 9, body: "A completely different hook.\n\nAnd body." },
    drafts: { body: "The original hook.\n\nThe original body." },
    outcomes: { approved_body: "The original hook.\n\nThe original body.", edit_stage: "approved" },
  });

  const result = await recordEditDiff(db, 4, "published");
  assert.equal(result.measured, true);
  assert.equal(result.editClass, "rewrite");
});

test("12.4 — an empty verdict is not a verdict, and does not error", async () => {
  const { db, writes } = fakeDb({ posts: { moment_id: 4, draft_id: 9 } });

  assert.equal(await recordVerdict(db, 1, "   "), false);
  assert.equal(await recordVerdict(db, 1, ""), false);
  assert.equal(writes.filter((w) => w.table === "outcomes").length, 0);
});

test("12.4 — a verdict names the draft it judged", async () => {
  const { db, writes } = fakeDb({ posts: { moment_id: 4, draft_id: 9 } });

  assert.equal(await recordVerdict(db, 1, "Hook was wrong."), true);

  const row = writes.find((w) => w.table === "outcomes")!.row;
  assert.equal(row.verdict, "Hook was wrong.");
  // A moment produces several drafts; "the hook was wrong" against a moment says nothing about
  // which attempt was wrong.
  assert.equal(row.verdict_draft_id, 9);
  assert.ok(row.verdict_at);
});

test("12.4 — an explicit draft id beats the post's current one", async () => {
  const { db, writes } = fakeDb({ posts: { moment_id: 4, draft_id: 9 } });

  // He is judging the version he was shown, which may not be the latest by the time he answers.
  await recordVerdict(db, 1, "This one nailed it.", 7);

  const row = writes.find((w) => w.table === "outcomes")!.row;
  assert.equal(row.verdict_draft_id, 7);
});
