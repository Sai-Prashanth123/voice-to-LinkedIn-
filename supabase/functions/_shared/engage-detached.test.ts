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
        /*
         * A THENABLE CHAIN, not a terminal `order()`.
         *
         * `order()` used to return the promise, which worked only while `order` happened to be the
         * last call in the builder. On 19 November the read gained `.limit()` after it — the poll
         * now takes the longest-unpolled few rather than the whole list — and this stub threw
         * `limit is not a function`, which surfaced as the off state filing `creator_poll_failed`.
         * A stub narrower than the code under test reports a fault in the stub as a fault in the
         * code, so the chain now ends wherever the caller stops.
         */
        const result = opts.failReadWith
          ? { data: null, error: { message: opts.failReadWith }, count: null }
          : { data: opts.creators ?? [], error: null, count: (opts.creators ?? []).length };
        // deno-lint-ignore no-explicit-any
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          // deno-lint-ignore no-explicit-any
          then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
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

Deno.test("a harvest that hangs reports giving up, instead of being killed in silence", async () => {
  /*
   * THE LAYER UNDER THE TIMEOUT FIX, measured the same afternoon it shipped.
   *
   * Detaching the work fixed a pg_net timeout that left no trace. It then exposed the next
   * boundary: the harvest module allows a console job TEN MINUTES, which is longer than the edge
   * runtime holds an isolate once the response has gone. A real run filed creator_poll_started at
   * 15:39:07 and never filed anything else — torn down before its own deadline could fire, so it
   * could not report that it had given up.
   *
   * `withBudget` gives it a deadline the runtime can keep, so the failure is a sentence rather than
   * an absence. This asserts the sentence exists and names the cause.
   */
  const { withBudget } = await import("./jobs.ts");

  /*
   * A promise slower than the budget, with its own handle so it can be cleared afterwards. The
   * first version of this test used a promise that never settles at all, and Deno failed it with
   * "Promise resolution is still pending but the event loop has already resolved" — a leak in the
   * test, not in the code, and exactly the kind of dangling timer `withBudget` clears in its
   * `finally`.
   */
  let slowTimer: number | undefined;
  const tooSlow = new Promise<void>((resolve) => {
    slowTimer = setTimeout(resolve, 30_000) as unknown as number;
  });

  let message = "";
  try {
    await withBudget(tooSlow, 30, "the creator poll");
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  } finally {
    if (slowTimer !== undefined) clearTimeout(slowTimer);
  }

  assert(message.length > 0, "a hang produced no error, so nothing would be recorded");
  assert(
    /the creator poll/.test(message),
    `the message does not say which work hung: ${message}`,
  );
  assert(
    /did not finish within/.test(message),
    `the message does not say it ran out of time: ${message}`,
  );
  assert(
    /blocked|queuing/.test(message),
    `the message gives no likely cause, so a reader has nothing to act on: ${message}`,
  );
});

Deno.test("work that finishes in time is returned untouched and the timer is cleared", async () => {
  // A budget that swallowed the result, or left a timer armed holding the isolate open, would be
  // worse than no budget at all.
  const { withBudget } = await import("./jobs.ts");
  const value = await withBudget(Promise.resolve("harvested"), 5_000, "a quick harvest");
  assertEquals(value, "harvested");
});

Deno.test("the harvest budget is below the runtime's own kill, so it can still report", async () => {
  /*
   * THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE, AND THE OPPOSITE WAS WRONG.
   *
   * It required the budget to EXCEED the slowest measured successful harvest (147s, nine profiles,
   * 18 November), on the reasoning that a budget under the measured need fails every run. That
   * reasoning is sound only if the runtime lets a run take as long as it needs. It does not.
   *
   * Measured from the edge runtime's own logs on 19 November: every execution of every worker on
   * this project shuts down at 150.0s with `reason: WallClockTime`. Dozens, all within a tenth of a
   * second. So the old assertion forced the budget into a range where it could never fire — 240s,
   * ninety seconds past the point the isolate stops existing — and the run died in silence instead
   * of reporting. creator_poll_started 10:50:33, booted 10:50:32.492, killed 10:53:02.511, no
   * outcome filed. A premature kill that REPORTS beats a silent death, and the 110s this was
   * originally set to did at least report.
   *
   * The 147s success was three seconds inside that kill. Luck, not headroom.
   *
   * So the invariant inverts: the budget must sit BELOW the platform ceiling, with enough room left
   * to write the failure event. A harvest that needs longer cannot be bought more time at any
   * number; it has to be made smaller.
   */
  const RUNTIME_KILLS_AT_MS = 150_000; // measured 19 Nov, reason: WallClockTime, every execution
  const ROOM_TO_REPORT_MS = 5_000; // one insert, generously

  const sources = ["./engage.ts", "./corpus.ts"];
  for (const path of sources) {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    const found = src.match(/HARVEST_BUDGET_MS = ([\d_]+);/);
    assert(found, `${path} has no HARVEST_BUDGET_MS to check`);
    const ms = Number(found[1].replaceAll("_", ""));
    assert(
      ms + ROOM_TO_REPORT_MS <= RUNTIME_KILLS_AT_MS,
      `${path} allows ${ms / 1000}s, but the runtime kills every execution at ${
        RUNTIME_KILLS_AT_MS / 1000
      }s on WallClockTime. A budget that cannot fire before the kill reports nothing at all — ` +
        `which is the fault this file exists to prevent. Make the work smaller, not the budget bigger.`,
    );
    assert(
      ms > 0,
      `${path} allows no time at all, so every harvest is killed before it starts`,
    );
  }
});

Deno.test("both workers allow the same budget, so one cannot be tuned alone by accident", async () => {
  const read = async (path: string) => {
    const src = await Deno.readTextFile(new URL(path, import.meta.url));
    return Number(src.match(/HARVEST_BUDGET_MS = ([\d_]+);/)![1].replaceAll("_", ""));
  };
  assertEquals(
    await read("./engage.ts"),
    await read("./corpus.ts"),
    "the two harvests allow different budgets; they run on the same runtime against the same " +
      "backend, so a difference here is a mistake rather than a decision",
  );
});
