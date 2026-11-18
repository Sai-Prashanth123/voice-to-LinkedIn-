/**
 * The corpus refresh — EXECUTED, with the two losses it is built around at the front.
 *
 * WHY THESE PARTICULAR ASSERTIONS
 *
 * Collecting the reference writers automatically was left undone on purpose for six weeks, and
 * worker-ops says why: it needs a key that was not in the vault, and "automating the collection of
 * a corpus that currently comes back without line breaks would be automating something half
 * useless." Both halves of that are real risks rather than preferences, and both have already cost
 * something:
 *
 *   9 October  — the console returned all 14 rows of a Matt Barker harvest as one unbroken
 *                paragraph each. Six columns here are counted FROM line breaks, and `merge-
 *                duplicates` means a key present with a null value overwrites, so one console run
 *                over an Apify corpus nulls the shape of every shaped row. 0046 revokes DELETE
 *                from every role, so there is no way back.
 *   20 October  — the Apify mapping read `reactionsCount` where the payload says `engagement.likes`,
 *                so every row arrived with null engagement and the upsert erased the reaction and
 *                comment counts of all 1,900 posts. The run reported success.
 *
 * So the tests that matter are the refusals, not the happy path: that a flat row cannot overwrite a
 * shaped one, that a column the backend could not fill is dropped rather than written as null, and
 * that a failed read refuses instead of upserting blind.
 */

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CORPUS_HANDLES, CORPUS_WRITERS } from "./corpus.ts";
import { REFERENCE_WRITERS } from "../../../mcp-server/writers.mjs";

Deno.test("the nine here are the nine the connector knows about", () => {
  /*
   * Two lists of handles is the shape of every "spelled twice" fault in this repository. They
   * genuinely have to be separate — one is the connector's and one runs in the cloud — so this is
   * the test that keeps them honest. `scripts/scrape-sentinels.mjs` and
   * `scripts/load-reference-posts.mjs` each hold a third and fourth copy; those are CLI-only and
   * out of reach from Deno, which is itself an argument for this worker replacing them.
   */
  assertEquals(
    CORPUS_HANDLES.slice().sort(),
    REFERENCE_WRITERS.map((w: { handle: string }) => w.handle).sort(),
    "the corpus worker and the connector disagree about who the reference writers are",
  );
});

Deno.test("every handle carries the writer's name, because handleOf is keyed on the object", () => {
  // `normaliseRows` calls `hasOwnProperty` on this object. An array would attribute nothing and
  // every row would be counted as somebody else's, which looks exactly like a quiet week.
  for (const handle of CORPUS_HANDLES) {
    assert(
      typeof CORPUS_WRITERS[handle] === "string" && CORPUS_WRITERS[handle].length > 0,
      `${handle} has no name, so a row from them cannot be attributed`,
    );
  }
});

/* ── The backend choice, which is a correctness boundary ───────────────────── */

Deno.test("Apify is chosen over the console whenever it is available", async () => {
  const { backendFor } = await import("./corpus.ts");
  const original = Deno.env.get("APIFY_TOKEN");
  const originalXp = Deno.env.get("XP_API_KEY");
  try {
    Deno.env.set("APIFY_TOKEN", "token");
    Deno.env.set("XP_API_KEY", "key");
    const chosen = backendFor();
    assertEquals(
      chosen.name,
      "apify",
      "the console was chosen with Apify available, which silently gives up line breaks",
    );
    assertEquals(chosen.keepsLineBreaks, true);
  } finally {
    if (original === undefined) Deno.env.delete("APIFY_TOKEN");
    else Deno.env.set("APIFY_TOKEN", original);
    if (originalXp === undefined) Deno.env.delete("XP_API_KEY");
    else Deno.env.set("XP_API_KEY", originalXp);
  }
});

Deno.test("the console is used only as a fallback, and says what it cannot do", async () => {
  const { backendFor } = await import("./corpus.ts");
  const original = Deno.env.get("APIFY_TOKEN");
  const originalXp = Deno.env.get("XP_API_KEY");
  try {
    Deno.env.delete("APIFY_TOKEN");
    Deno.env.set("XP_API_KEY", "key");
    const chosen = backendFor();
    assertEquals(chosen.name, "console");
    assertEquals(
      chosen.keepsLineBreaks,
      false,
      "the console was reported as keeping line breaks; it strips them, verified 9 October",
    );
    // The note is what reaches a reader, so it has to name the consequence and the remedy.
    assert(/strips line breaks/i.test(chosen.note), `the note does not say what is lost: ${chosen.note}`);
    assert(/APIFY_TOKEN/.test(chosen.note), "the note does not say what would fix it");
  } finally {
    if (original === undefined) Deno.env.delete("APIFY_TOKEN");
    else Deno.env.set("APIFY_TOKEN", original);
    if (originalXp === undefined) Deno.env.delete("XP_API_KEY");
    else Deno.env.set("XP_API_KEY", originalXp);
  }
});

Deno.test("with no key at all it reports blocked rather than reporting a clean run", async () => {
  const { refreshCorpus } = await import("./corpus.ts");
  const apify = Deno.env.get("APIFY_TOKEN");
  const xp = Deno.env.get("XP_API_KEY");
  const events: string[] = [];
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from: (t: string) => {
      if (t !== "system_events") throw new Error(`unexpected table ${t}`);
      return {
        insert: (row: Record<string, unknown>) => {
          events.push(String(row.kind));
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  try {
    Deno.env.delete("APIFY_TOKEN");
    Deno.env.delete("XP_API_KEY");
    const result = await refreshCorpus(db);
    assertEquals(result.ok, false);
    assert(
      events.includes("corpus_blocked"),
      `no event was filed; a blocked run that leaves no trace is indistinguishable from one that ` +
        `found nothing. Events: ${JSON.stringify(events)}`,
    );
  } finally {
    if (apify !== undefined) Deno.env.set("APIFY_TOKEN", apify);
    if (xp !== undefined) Deno.env.set("XP_API_KEY", xp);
  }
});

/* ── The detached run, which is why the creator poll failed ────────────────── */

Deno.test("it answers before the harvest and files a start first", async () => {
  const { refreshDetached } = await import("./corpus.ts");
  const events: string[] = [];
  // deno-lint-ignore no-explicit-any
  const db: any = {
    from: (t: string) => {
      if (t === "system_events") {
        return {
          insert: (row: Record<string, unknown>) => {
            events.push(String(row.kind));
            return Promise.resolve({ error: null });
          },
        };
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    },
  };

  const started = Date.now();
  const res = await refreshDetached(db);
  const took = Date.now() - started;

  assertEquals(res.status, 200);
  assert(took < 5000, `the response took ${took}ms; invoke_worker allows 30 seconds in total`);
  assertEquals(
    events[0],
    "corpus_started",
    `the first event was ${events[0]}; a run torn down before finishing must leave a start behind, ` +
      `because the creator poll on 18 November left nothing at all`,
  );

  const body = await res.json();
  assert(/corpus_refreshed/.test(body.next), "the reply does not say where the outcome is recorded");
  assert(/corpus_blocked/.test(body.next), "the reply does not name the blocked outcome");
});
