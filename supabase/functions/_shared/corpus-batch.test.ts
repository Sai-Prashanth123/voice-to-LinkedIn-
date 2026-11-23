/**
 * The corpus batch — the fix for a scheduled run that could never have completed.
 *
 * WHAT WAS MEASURED, AND WHY IT IS NOT A TUNING QUESTION
 *
 * Submitted against the live console on 23 November, rather than reasoned about:
 *
 *   nine profiles in one job   273.1s   76 posts
 *   three profiles in one job  120.2s   17 posts
 *   one profile in one job     111.7s and 128.5s
 *
 * The edge runtime kills every execution at 150.0s. So the nine-writer refresh was not slow, it was
 * impossible — and it had already failed on every scheduled run it ever had, on 19 and 23 November,
 * at the 140s budget that was supposed to make the failure legible. It did make it legible. It
 * could not make it finish.
 *
 * WHY THE ROTATION IS BY ATTEMPT AND NOT BY WHAT IS STORED
 *
 * The obvious signal, `max(scraped_at)` per writer, is wrong in a way this corpus already contains.
 * A writer whose fetch returns nothing stores nothing, so their `scraped_at` does not move, so they
 * are the stalest again on the next run and the other eight never get a turn. `ryanscarlin` is that
 * writer today: last stored 20 October, newest post 10 September, and three of eight test jobs on
 * 23 November came back empty from a flaky backend. A rotation that starves on a failure is a
 * rotation that stops.
 *
 * So the tests below are mostly about progress rather than about the happy path: that every writer
 * gets a turn, that a failing writer cannot pin the schedule, and that a run which cannot read its
 * own history says so rather than quietly picking the same three forever.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CORPUS_BATCH, CORPUS_HANDLES, corpusDueForRefresh } from "./corpus.ts";

/**
 * A database that answers the one read `corpusDueForRefresh` makes.
 *
 * `rows` is most-recent-first, which is what `.order("id", { ascending: false })` asks for. The
 * chain is a thenable rather than an object with a `.limit()` that returns data, because that is
 * the shape the real client has — and because a stub whose chain ends one call early is how the
 * creator-poll test passed while reporting the wrong outcome on 19 November.
 */
// deno-lint-ignore no-explicit-any
function stubDb(rows: Array<{ detail: unknown }>, error: { message: string } | null = null): any {
  const result = { data: error ? null : rows, error };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = () => chain;
  }
  // deno-lint-ignore no-explicit-any
  (chain as any).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { from: () => chain };
}

const startEvent = (writers: string[]) => ({ detail: { writers } });

Deno.test("a run takes three writers, not nine, because nine cannot finish", async () => {
  const { handles } = await corpusDueForRefresh(stubDb([]));
  assertEquals(handles.length, CORPUS_BATCH);
  assert(
    CORPUS_BATCH < CORPUS_HANDLES.length,
    "the batch is the whole corpus again, which measured 273s against a 150s kill",
  );
});

Deno.test("writers with no run on record go first, and the basis says so", async () => {
  /*
   * The state this ships into. Eight of the nine were last touched by the manual run on 18
   * November and `ryanscarlin` on 20 October, but NONE of them has a `corpus_started.writers`
   * entry, because that key did not exist until today. So the first run after this deploys treats
   * every writer as never attempted, which is correct: no attempt is on record.
   */
  const { handles, basis } = await corpusDueForRefresh(stubDb([]));
  assertEquals(handles, CORPUS_HANDLES.slice(0, CORPUS_BATCH));
  assert(
    /no run on record/.test(basis),
    `the basis does not say why these three were chosen: ${basis}`,
  );
});

Deno.test("three runs cover all nine, and no writer is fetched twice before the rest have had a turn", async () => {
  /*
   * The property that matters, run rather than asserted about: feed each run's choice back as the
   * event it would have filed, and see whether the schedule actually walks the corpus.
   */
  const events: Array<{ detail: unknown }> = [];
  const picked: string[][] = [];

  for (let run = 0; run < 3; run++) {
    const { handles } = await corpusDueForRefresh(stubDb(events));
    picked.push(handles);
    events.unshift(startEvent(handles)); // most recent first, as the read returns them
  }

  const all = picked.flat();
  assertEquals(
    all.length,
    new Set(all).size,
    `a writer was fetched twice inside one pass: ${JSON.stringify(picked)}`,
  );
  assertEquals(
    all.slice().sort(),
    CORPUS_HANDLES.slice().sort(),
    `three runs of ${CORPUS_BATCH} did not cover all ${CORPUS_HANDLES.length}: ` +
      JSON.stringify(picked),
  );
});

Deno.test("a writer whose fetch keeps failing cannot starve the other eight", async () => {
  /*
   * THE FAULT THIS WHOLE MODULE EXISTS TO AVOID.
   *
   * Three of eight live jobs on 23 November returned nothing — "Bright Data did not serve the
   * request". If the rotation keyed on what was stored, the three that failed would be the three
   * with the oldest data, so they would be chosen again, fail again, and the corpus would refresh
   * three writers forever while reporting a healthy run each time.
   *
   * Here the most recent run attempted the first three and, as far as this function can see,
   * stored nothing at all. They must still go last.
   */
  const firstThree = CORPUS_HANDLES.slice(0, CORPUS_BATCH);
  const { handles } = await corpusDueForRefresh(stubDb([startEvent(firstThree)]));

  for (const handle of firstThree) {
    assert(
      !handles.includes(handle),
      `${handle} was fetched again immediately after its own run, so a failing writer blocks the ` +
        `rest — which is exactly what keying on max(scraped_at) would have done`,
    );
  }
  assertEquals(handles.length, CORPUS_BATCH);
});

Deno.test("the writer waiting longest goes before the one waiting less long", async () => {
  // Most recent first: run 1 took A,B,C most recently; run 2 took D,E,F before that. So of the six
  // attempted, D,E,F have waited longer — but the three never attempted at all still outrank them.
  const [a, b, c, d, e, f, g, h, i] = CORPUS_HANDLES;
  const { handles } = await corpusDueForRefresh(
    stubDb([startEvent([a, b, c]), startEvent([d, e, f]), startEvent([g, h, i])]),
  );
  assertEquals(
    handles,
    [g, h, i],
    "the three whose last run is furthest back were not the three chosen",
  );
});

Deno.test("a read it could not do is reported, not turned into a silent default", async () => {
  /*
   * The repository's signature defect in this exact shape: a check with nothing to check that
   * reports success. A failed read means this function knows NOTHING about whose turn it is, and
   * the three it then picks are not the longest waiting — so the event has to carry that
   * difference, because "these three because it was their turn" and "these three because I am
   * blind" are different facts and only one of them is fine.
   */
  const { handles, basis } = await corpusDueForRefresh(
    stubDb([], { message: "permission denied for table system_events" }),
  );
  assertEquals(handles.length, CORPUS_BATCH);
  assert(
    /could not read/.test(basis) && /permission denied/.test(basis),
    `a failed read did not say so, and the caller cannot tell it apart from a real rotation: ${basis}`,
  );
});

Deno.test("the batch reaches the harvest, and the start event records who was attempted", async () => {
  /*
   * A value nothing reads is this repository's most common defect, and a batch that is computed
   * and then not passed to the fetch would be precisely that: measured, logged, and inert, with
   * nine profiles still going out in one job. So this asserts the two places the batch has to
   * appear — the fetch and the start event — through the public entry point.
   */
  const { refreshDetached } = await import("./corpus.ts");
  const filed: Array<Record<string, unknown>> = [];

  // deno-lint-ignore no-explicit-any
  const db: any = {
    from: (table: string) => {
      if (table === "system_events") {
        const chain: Record<string, unknown> = {
          insert: (row: Record<string, unknown>) => {
            filed.push(row);
            return Promise.resolve({ error: null });
          },
        };
        for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
        // deno-lint-ignore no-explicit-any
        (chain as any).then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return chain;
      }
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "upsert"]) chain[method] = () => chain;
      // deno-lint-ignore no-explicit-any
      (chain as any).then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return chain;
    },
  };

  const res = await refreshDetached(db);
  assertEquals(res.status, 200);
  await res.json();

  const start = filed.find((row) => row.kind === "corpus_started");
  assert(start, `no corpus_started was filed; events were ${JSON.stringify(filed.map((f) => f.kind))}`);

  const detail = start.detail as { writers?: unknown; chosen_because?: unknown };
  assert(Array.isArray(detail.writers), "the start event does not record which writers it attempted");
  assertEquals(
    (detail.writers as string[]).length,
    CORPUS_BATCH,
    "the start event records a different number of writers than the batch size",
  );
  assert(
    typeof detail.chosen_because === "string" && (detail.chosen_because as string).length > 0,
    "the start event does not say why these writers were chosen, so the rotation is unreadable",
  );
});

Deno.test("the whole corpus is still reachable deliberately, for a caller nothing kills", async () => {
  /*
   * `refreshCorpus` defaults to all nine on purpose: a script run from a terminal has no 150s
   * ceiling, and every existing caller meant the whole corpus. Batching is the scheduled worker's
   * problem, so the default must not quietly become three — a backfill script that silently
   * fetched a third of the corpus would report success and be wrong.
   */
  const source = await Deno.readTextFile(new URL("./corpus.ts", import.meta.url));
  assert(
    /handles: string\[\] = CORPUS_HANDLES/.test(source),
    "refreshCorpus no longer defaults to the whole corpus, so existing callers now fetch a batch",
  );
  assert(
    /const profileUrls = handles\.map\(PROFILE_URL\)/.test(source),
    "the batch is not what gets fetched — profileUrls is still built from something else",
  );
  /*
   * Asserted on the ARGUMENT, not on the whole call, because the call moved into `storeHarvest`
   * when the two-phase path needed the same guards. What must not change is that attribution is
   * given all nine writers: a profile harvest returns other people's posts from the feed, and one
   * of those people is sometimes another reference writer.
   */
  assert(
    /normaliseRows\([A-Za-z.? \[\]]+, CORPUS_WRITERS\)/.test(source),
    "attribution was narrowed to the batch, which files another reference writer's post as foreign",
  );
});
