/**
 * The creator poll answers before it finishes, and still leaves a record — EXECUTED.
 *
 * WHAT HAPPENED, MEASURED
 *
 * `invoke_worker` calls every worker with `timeout_milliseconds => 30000`. A console harvest polls
 * a backend job to completion, measured at 44 seconds for one profile. The poll therefore could
 * never return in time — and nothing said so for fifteen days, because all 18 runs in that period
 * hit the off state and returned in milliseconds.
 *
 * On 18 November, two creators were added and the poll was run. `net._http_response` held one
 * failure among 458 calls that day: id 157905, status NULL, "Timeout of 30000 ms reached." No
 * posts, no options, no event, no edge-log line.
 *
 * WHAT THESE TESTS GUARD
 *
 * Detaching work is the easiest way to write a worker that reports success and does nothing, which
 * is this repository's signature defect. So the response alone is not accepted as evidence here:
 * each test asserts on the events that were actually filed, and one asserts the negative — that a
 * thrown harvest is still recorded after the caller has been told the run started.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pollDetached } from "./engage.ts";

type Event = { kind: string; severity: string; detail: unknown };

/**
 * A stub client covering only what this path touches: the `creators` read, and the `system_events`
 * insert that `logEvent` performs. `creators` is empty by default, which is the off state and the
 * cheapest way to drive the whole function without a fetch or a model call.
 */
function stubDb(opts: { creators?: unknown[]; failReadWith?: string } = {}) {
  const events: Event[] = [];
  const db = {
    events,
    from(table: string) {
      if (table === "creators") {
        const result = opts.failReadWith
          ? { data: null, error: { message: opts.failReadWith } }
          : { data: opts.creators ?? [], error: null };
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => Promise.resolve(result),
        };
        return chain;
      }
      if (table === "system_events") {
        return {
          insert: (row: Record<string, unknown>) => {
            events.push({
              kind: String(row.kind),
              severity: String(row.severity),
              detail: row.detail,
            });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "settings") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      }
      throw new Error(`stub has no table "${table}"`);
    },
  };
  // deno-lint-ignore no-explicit-any
  return db as any;
}

Deno.test("it answers the caller rather than holding the connection open", async () => {
  // The whole point. invoke_worker gives this 30 seconds; the harvest takes longer than that, so
  // the response must not be waiting on the harvest.
  const db = stubDb();
  const started = Date.now();
  const res = await pollDetached(db);
  const took = Date.now() - started;

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.started, true);
  assert(
    took < 5000,
    `the response took ${took}ms; it must not wait on a harvest that is measured in minutes`,
  );
});

Deno.test("the reply says where to look, because the status no longer says what happened", async () => {
  const res = await pollDetached(stubDb());
  const body = await res.json();
  // A caller told only "ok" would have no way to tell a finished run from a torn-down one.
  assert(/creator_poll_ran/.test(body.next), "the reply does not name the event that records a run");
  assert(/creator_poll_failed/.test(body.next), "the reply does not name the failure event");
  assert(
    /creator_poll_started/.test(body.next),
    "the reply does not explain what a start with no finish means, which is the one state this " +
      "design introduces",
  );
});

Deno.test("a start is filed before the work, so a torn-down run leaves a trace", async () => {
  // The run on 18 November left NOTHING: no event at all. That is the state this prevents.
  const db = stubDb();
  await pollDetached(db);
  const kinds = db.events.map((e: Event) => e.kind);
  assertEquals(kinds[0], "creator_poll_started", `events were ${JSON.stringify(kinds)}`);
});

Deno.test("the off state still reports itself, detached or not", async () => {
  const db = stubDb({ creators: [] });
  await pollDetached(db);
  const kinds = db.events.map((e: Event) => e.kind);
  assert(
    kinds.includes("creator_poll_idle"),
    `the off state filed no event; events were ${JSON.stringify(kinds)}`,
  );
});

Deno.test("a harvest that throws is recorded, after the caller has already been answered", async () => {
  /*
   * This is the assertion that matters most. The caller has been told the run started, so if a
   * throw went unlogged the failure would exist nowhere at all — worse than the timeout it
   * replaces, because the timeout at least appeared in net._http_response.
   */
  const db = stubDb({ failReadWith: "permission denied for table creators" });
  const res = await pollDetached(db);

  assertEquals(res.status, 200, "the caller is answered even when the work fails");

  const failure = db.events.find((e: Event) => e.kind === "creator_poll_failed");
  assert(
    failure,
    `a thrown harvest left no event; events were ${JSON.stringify(db.events.map((e: Event) => e.kind))}`,
  );
  assertEquals(failure.severity, "error");
  assert(
    JSON.stringify(failure.detail).includes("permission denied"),
    "the event does not carry the reason, so it says a run failed without saying why",
  );
});
