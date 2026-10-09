/**
 * The eighth verdict has to have a consequence.
 *
 * When the gate moved into Claude, `record_gate_verdict` kept writing its eight rows and nothing
 * closed the draft out. Draft 57 was judged on 5 October — eight verdicts, one of them a rejection —
 * and `gate_passed` stayed null, no rewrite was queued, and Josh was never told. The tool answered
 * "the draft is ready for Josh's calendar", a sentence nothing in the system implemented.
 *
 * That is the same fault as the thirty drafts he found with no verdicts: a step that reports success
 * and has no second half. These tests hold the second half in place.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { finishGate } from "./handlers/gate.ts";
import { GATE_CHECKS } from "./prompts.ts";

/*
 * The ending genuinely sends Josh a message, so the two outside edges are held still: a chat id to
 * address, and a fetch that records instead of posting. Stubbing them is the point — what is being
 * tested is which consequence follows a verdict, and a test that needed a Telegram token would be a
 * test nobody runs.
 */
Deno.env.set("TELEGRAM_CHAT_ID", "1510626598");
Deno.env.set("TELEGRAM_BOT_TOKEN", "test-token");
const sent: string[] = [];
globalThis.fetch = ((input: string | URL | Request) => {
  sent.push(String(input));
  return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    headers: { "content-type": "application/json" },
  }));
}) as typeof fetch;

/**
 * Enough of a client for this path: one draft, its verdicts, and a record of every write.
 *
 * `from("x").select(...).eq(...)` resolves to a list for gate_runs and jobs, and to `{data}` through
 * maybeSingle/single for drafts. Writes are recorded rather than applied, because what matters here is
 * WHICH write happened.
 */
function fakeDb(opts: {
  draft: Record<string, unknown>;
  verdicts: { check_key: string; passed: boolean; reason: string | null }[];
}) {
  const writes: { table: string; op: string; row: Record<string, unknown> }[] = [];

  const from = (table: string) => {
    const rows = table === "gate_runs" ? opts.verdicts : table === "jobs" ? [] : [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve({ data: opts.draft, error: null }),
      single: () => Promise.resolve({ data: opts.draft, error: null }),
      update: (row: Record<string, unknown>) => {
        writes.push({ table, op: "update", row });
        return chain;
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, op: "insert", row });
        return Promise.resolve({ data: [{ id: 1 }], error: null });
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    };
    return chain;
  };

  // A job is queued through the `enqueue` function in Postgres, not by inserting a row — the ladder
  // of retry delays and the dedupe key live in there. So the calls are recorded as writes too.
  const rpc = (fn: string, args: Record<string, unknown>) => {
    writes.push({ table: `rpc:${fn}`, op: "rpc", row: args });
    return Promise.resolve({ data: null, error: null });
  };

  // deno-lint-ignore no-explicit-any
  return { db: { from, rpc } as any, writes };
}

/** The job types queued during a call, in order. */
const queued = (writes: { table: string; row: Record<string, unknown> }[]) =>
  writes.filter((w) => w.table === "rpc:enqueue").map((w) => String(w.row.p_type ?? w.row.type ?? ""));

type Verdict = { check_key: string; passed: boolean; reason: string | null };

const allPassing = (): Verdict[] =>
  GATE_CHECKS.map((c) => ({ check_key: c.key, passed: true, reason: null }));

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: 57,
  moment_id: 69,
  attempt: 2,
  body: "a post",
  framework: "what, why, how",
  gate_passed: null,
  gate_reason: null,
  ...over,
});

test("a draft short of eight verdicts is not decided, and says how many are missing", async () => {
  const { db, writes } = fakeDb({
    draft: draftRow(),
    verdicts: allPassing().slice(0, 6),
  });

  const out = await finishGate(db, 57);

  assert.equal(out.outcome, "incomplete");
  assert.equal(out.judged, 6);
  // Nothing may be written: a draft judged on six checks is not a judged draft (9b).
  assert.deepEqual(writes, []);
});

test("all eight passing puts it in the calendar and tells Josh", async () => {
  const { db, writes } = fakeDb({ draft: draftRow({ id: 58, moment_id: 80 }), verdicts: allPassing() });

  const out = await finishGate(db, 58);

  assert.equal(out.outcome, "passed");
  const draftUpdate = writes.find((w) => w.table === "drafts" && w.op === "update");
  assert.equal(draftUpdate?.row.gate_passed, true);
  // The two halves the old code only claimed: the calendar, and the message to him.
  // The calendar is the `posts` table — the row Josh's weekly pass reads.
  assert.ok(writes.some((w) => w.table === "posts"), "nothing was pushed to the calendar");
  /*
   * He is told, and the shape of "told" changed on 9 October.
   *
   * This asserted a `notify_draft_ready` job, which existed only to send a Telegram message. With no
   * push channel left, the fact waits in `notices` and `system_status` reads it. What must stay true
   * is that passing the gate produces something he will see — a pass that reaches the calendar
   * silently is how a draft sits unnoticed for three weeks.
   */
  assert.ok(
    writes.some((w) => w.table === "notices" && w.op === "insert"),
    "nothing tells Josh the draft is ready",
  );
  const told = writes.find((w) => w.table === "notices");
  assert.match(String(told?.row.kind), /draft_ready/);
  assert.ok(
    String(told?.row.acted_on).includes("mark_ready"),
    "the notice does not say what he can do about it",
  );
});

test("a rejection records the reason and queues the rewrite", async () => {
  const verdicts = allPassing();
  verdicts[verdicts.length - 1] = {
    check_key: "banned_phrases",
    passed: false,
    reason: 'The sentence "None of it was inside a filter." rejects a frame to assert another.',
  };

  const { db, writes } = fakeDb({ draft: draftRow(), verdicts });

  const out = await finishGate(db, 57);

  assert.equal(out.outcome, "rejected");
  assert.deepEqual(out.failed, ["banned_phrases"]);

  const draftUpdate = writes.find((w) => w.table === "drafts" && w.op === "update");
  assert.equal(draftUpdate?.row.gate_passed, false);
  // The reason has to survive into the rewrite, or the next attempt is a guess.
  assert.match(String(draftUpdate?.row.gate_reason), /None of it was inside a filter/);

  const retry = writes.find((w) => w.table === "rpc:enqueue" && w.row.p_type === "draft");
  assert.ok(retry, "no rewrite was queued, so the rejection led nowhere");
  const payload = retry!.row.p_payload as Record<string, unknown>;
  assert.equal(payload.attempt, 3);
  // The reasons travel with it, or the next attempt is a guess at what was wrong.
  assert.match(String((payload.failures as string[]).join(" ")), /None of it was inside a filter/);
});

test("the third failure parks the idea instead of writing a fourth draft (9.8)", async () => {
  const verdicts = allPassing();
  verdicts[0] = { check_key: "anyone_else", passed: false, reason: "Anyone could have written it." };

  const { db, writes } = fakeDb({ draft: draftRow({ attempt: 3 }), verdicts });

  const out = await finishGate(db, 57);

  assert.equal(out.outcome, "rejected");
  assert.ok(!queued(writes).includes("draft"), "a fourth draft was queued after three failures");
  const momentUpdate = writes.find((w) => w.table === "moments" && w.op === "update");
  assert.equal(momentUpdate?.row.status, "parked");
});

test("closing a draft that was already decided changes nothing", async () => {
  const { db, writes } = fakeDb({
    draft: draftRow({ gate_passed: false, gate_reason: "banned_phrases: a reframe" }),
    verdicts: allPassing(),
  });

  const out = await finishGate(db, 57);

  assert.equal(out.outcome, "already");
  assert.deepEqual(out.failed, ["banned_phrases: a reframe"]);
  // Called twice — by a retried job and by a second record_gate_verdict — it must not queue a second
  // rewrite, which would burn an attempt and park the idea early.
  assert.deepEqual(writes, []);
});
