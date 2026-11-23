/**
 * Collect-then-submit: the fix for a worker that could not wait for its own scraper.
 *
 * WHAT WAS ACTUALLY WRONG, AFTER I GOT IT WRONG ONCE
 *
 * The scheduled corpus refresh has failed on every run it has ever had. I read that as a batch-size
 * problem, measured nine profiles at 273s against a 150s platform kill, split the run into three
 * writers, deployed it — and watched it fail again at 15:45 on 23 November with three writers.
 *
 * The batch size was never the binding constraint. The console takes 111.7s, 120.2s, 128.5s and
 * 136.6s to answer jobs of ONE and THREE profiles; the latency is overhead, not per-profile. A
 * single writer already spends most of a 150s budget, so there is no batch size that reliably fits.
 * I had set the batch from a single 120s reading, which is the one-trial mistake this repository
 * keeps making and which I had corrected elsewhere the same day.
 *
 * The job itself never needed us: it runs server-side to completion whether anybody is listening.
 * So the waiting moves into the gap between runs, and the tests below are about the two states that
 * arrangement can get wrong — a submission that is not recorded, and a landed job nobody collects.
 * Both would look exactly like working code.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CORPUS_BATCH, JOB_SUBMITTED, pendingConsoleJob } from "./corpus.ts";

/**
 * A database that answers the two reads `pendingConsoleJob` makes, keyed by event kind.
 *
 * The chain is a thenable, like the real client. A stub whose chain ends one call early is how the
 * creator-poll test passed on 19 November while the code under it reported the wrong outcome.
 */
// deno-lint-ignore no-explicit-any
function stubDb(byKind: Record<string, Array<{ detail: unknown }>>): any {
  return {
    from: () => {
      let wanted: string[] = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (_col: string, value: string) => {
          wanted = [value];
          return chain;
        },
        in: (_col: string, values: string[]) => {
          wanted = values;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
      };
      // deno-lint-ignore no-explicit-any
      (chain as any).then = (resolve: (v: unknown) => unknown) => {
        const rows = wanted.flatMap((k) => byKind[k] ?? []);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return chain;
    },
  };
}

const submitted = (job: number, writers: string[]) => ({ detail: { job, writers } });

Deno.test("a submitted job with no outcome against it is what the next run collects", async () => {
  const pending = await pendingConsoleJob(
    stubDb({ [JOB_SUBMITTED]: [submitted(59510, ["mattjbarker1", "demandjen1", "outboundphd"])] }),
  );
  assert(pending, "a job was submitted and never settled, and this found nothing to collect");
  assertEquals(pending.jobId, 59510);
  assertEquals(pending.writers.length, 3);
});

Deno.test("a job already stored is not collected twice", async () => {
  /*
   * Upserting the same harvest again would be harmless in itself — `onConflict: activity_id` — but
   * a run that re-collects the last job never submits a new one, so the corpus would stop moving
   * while every event said it had refreshed. That is the shape of fault this file keeps catching.
   */
  const pending = await pendingConsoleJob(stubDb({
    [JOB_SUBMITTED]: [submitted(59510, ["mattjbarker1"])],
    corpus_refreshed: [{ detail: { job: 59510, stored: 17 } }],
  }));
  assertEquals(pending, null);
});

Deno.test("a job that failed is settled too, so a refusal does not block the rotation forever", async () => {
  const pending = await pendingConsoleJob(stubDb({
    [JOB_SUBMITTED]: [submitted(59510, ["mattjbarker1"])],
    corpus_failed: [{ detail: { job: 59510, error: "Bright Data did not serve the request" } }],
  }));
  assertEquals(
    pending,
    null,
    "a job the scraper refused is still waiting to be collected, so this worker would retry it " +
      "instead of moving on — three of eight live jobs on 23 November were refusals",
  );
});

Deno.test("the newest unsettled job is taken, not the oldest", async () => {
  // Submitted most-recent-first, as `.order(\"id\", { ascending: false })` returns them. 59600 is
  // the live one; 59510 was abandoned when its own run died, and chasing it first would make the
  // worker a run behind forever.
  const pending = await pendingConsoleJob(stubDb({
    [JOB_SUBMITTED]: [submitted(59600, ["curtishowland"]), submitted(59510, ["mattjbarker1"])],
  }));
  assertEquals(pending?.jobId, 59600);
});

Deno.test("an outcome with no job id does not settle anything", async () => {
  /*
   * Every `corpus_failed` filed before 23 November carries no `job`, because jobs were not recorded
   * — and there are several in the live log. If a missing id matched, the first one of those would
   * settle a pending job that is still running and its rows would be dropped on the floor.
   */
  const pending = await pendingConsoleJob(stubDb({
    [JOB_SUBMITTED]: [submitted(59510, ["mattjbarker1"])],
    corpus_failed: [{ detail: { error: "the corpus refresh did not finish within 140s" } }],
  }));
  assertEquals(pending?.jobId, 59510);
});

Deno.test("nothing submitted means nothing to collect, which is not an error", async () => {
  assertEquals(await pendingConsoleJob(stubDb({})), null);
});

Deno.test("the submission is recorded before the wait, not after it", async () => {
  /*
   * THE WHOLE MECHANISM, ASSERTED ON THE SOURCE.
   *
   * If the submission were logged after the opportunistic wait, then an isolate killed during that
   * wait would leave a job running on the console that nothing would ever collect — the exact
   * silent loss this replaced, with an extra API call. The order of these two statements is the
   * difference between durable and decorative, so it is checked rather than trusted.
   */
  const source = await Deno.readTextFile(new URL("./corpus.ts", import.meta.url));
  const body = source.slice(source.indexOf("export async function collectThenSubmit"));
  const submitAt = body.indexOf("await submitConsoleHarvest(");
  const logAt = body.indexOf("JOB_SUBMITTED, \"info\"");
  const waitAt = body.indexOf("OPPORTUNISTIC_BUDGET_MS");

  assert(submitAt > -1 && logAt > -1 && waitAt > -1, "collectThenSubmit no longer has these steps");
  assert(
    submitAt < logAt && logAt < waitAt,
    "the job id is not recorded between submitting and waiting, so a killed isolate loses the job",
  );
});

Deno.test("the worker no longer waits for the scraper as its main path", async () => {
  /*
   * `fetchFromConsole` submits and waits in one call. It is right for a script and fatal here, and
   * it is still imported by `scripts/` — so what matters is that the worker's own module does not
   * reach for it. If this ever fails, the 150s kill is back and every scheduled run fails again.
   */
  const source = await Deno.readTextFile(new URL("./corpus.ts", import.meta.url));
  /*
   * The IMPORT and the CALL, not any mention: the comments in corpus.ts name `fetchFromConsole`
   * deliberately, to say why this file does not use it. A test that forbade the word would make
   * the explanation unwritable, which is its own kind of defect.
   */
  const imports = source.slice(0, source.indexOf("export const CORPUS_WRITERS"));
  assert(
    !/fetchFromConsole/.test(imports),
    "corpus.ts imports fetchFromConsole again, which waits inside an isolate that dies at 150s",
  );
  assert(
    !/fetchFromConsole\(/.test(source),
    "corpus.ts calls fetchFromConsole, which submits and waits in one go against a 150s kill",
  );
  assert(
    /collectThenSubmit\(db\), HARVEST_BUDGET_MS/.test(source),
    "the detached worker does not run the two-phase path",
  );
});

Deno.test("the batch is still three, because one writer is not meaningfully cheaper", async () => {
  /*
   * Kept rather than dropped to one. Three measured 120.2s and one measured 111.7s, so the batch
   * costs almost nothing extra now that nothing waits for it — and a run that collects three
   * writers' posts walks the corpus three times faster.
   */
  assertEquals(CORPUS_BATCH, 3);
});
