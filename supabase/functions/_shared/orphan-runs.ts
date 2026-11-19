/**
 * A worker run that started and never said how it ended.
 *
 * THE RUN THAT PROVED THIS WAS NEEDED
 *
 * 19 November, 07:00:07. `creator_poll_started` went into `system_events` and nothing else ever
 * did — no `creator_poll_ran`, no `creator_poll_idle`, no `creator_poll_failed`. The scheduled
 * creator poll produced nothing and reported nothing, and the only way anyone found out was by
 * reading the event log by hand looking for something else.
 *
 * It is not a missing catch. `pollDetached` wraps the work in a try/catch and a 240s budget, and
 * both are correct. The isolate is simply torn down before either can run: `EdgeRuntime.waitUntil`
 * extends the isolate past the response but not indefinitely, so a harvest that outlives it takes
 * the budget timer and the catch block down with it. Code inside a process cannot report that the
 * process stopped existing.
 *
 * WHY THIS IS NOT ANOTHER NOTICE
 *
 * `worker-ops` already aggregates `severity: "error"` events, tells Josh once and marks them
 * `notified_at`. `corpus_failed` reaches him that way today. A second channel for the same class of
 * news is the mistake that file already records at length: 1,581 stale events once queued up at ten
 * a day, "which is precisely how a person learns to ignore the channel that is meant to tell them
 * something broke".
 *
 * So this does not talk to Josh. It converts a silence into an `error` event and lets the existing
 * channel carry it. The repository's own habit, in its own words: **a check must report that it
 * ran**, and the silence has to mean something.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logEvent } from "./db.ts";

/**
 * Which terminal events close which start, by the family that files them.
 *
 * A start is satisfied by ANY of its terminals, including the warn-level ones:
 * `creator_poll_backend_failed` means the fetch answered badly, which is a run that reached the end
 * and said so. The question here is only ever "did it report at all".
 */
export const RUN_FAMILIES: Record<string, readonly string[]> = {
  corpus_started: ["corpus_refreshed", "corpus_failed", "corpus_blocked"],
  creator_poll_started: [
    "creator_poll_ran",
    "creator_poll_idle",
    "creator_poll_failed",
    "creator_poll_backend_failed",
  ],
};

/**
 * Event kinds that end in `_started` and are NOT a worker run, with the reason.
 *
 * Declared rather than inferred because `orphan-runs.test.ts` walks the function sources for every
 * `*_started` kind and fails if one is in neither list. The guard that only knows the kinds that
 * existed when it was written is the fault this repository keeps finding; `gate-inputs-agree` and
 * `gate-keys-agree` exist for the same reason.
 */
export const NOT_A_WORKER_RUN: Record<string, string> = {
  interview_never_started:
    "A property of a moment — an idea that was captured and never interviewed. No run begins here, " +
    "so there is no end to wait for.",
};

/** How long a run may be in flight before its silence counts as a disappearance. */
export const GRACE_MS = 20 * 60 * 1000;

/** How far back to look. One ops run a day, so a day and a half covers the gap with overlap. */
export const LOOKBACK_MS = 36 * 60 * 60 * 1000;

export const VANISHED_KIND = "worker_run_vanished";

interface StartRow {
  id: number;
  kind: string;
  created_at: string;
}

/**
 * Find starts with no finish and file one `error` event each. Returns how many were filed.
 *
 * Idempotent by the start event's id: the same disappearance is reported once, however often this
 * runs. Without that, a daily ops run would re-file the same orphan every day for as long as the
 * lookback window held it — the backlog-that-trickles-out fault, rebuilt.
 */
export async function reportVanishedRuns(
  db: SupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  const kinds = Object.keys(RUN_FAMILIES);
  const from = new Date(now - LOOKBACK_MS).toISOString();
  const until = new Date(now - GRACE_MS).toISOString();

  const { data: starts, error } = await db
    .from("system_events")
    .select("id,kind,created_at")
    .in("kind", kinds)
    .gte("created_at", from)
    .lte("created_at", until)
    .order("created_at", { ascending: true });

  if (error) {
    /*
     * Reported, not swallowed, and NOT treated as "nothing vanished".
     *
     * The whole point of this module is that an absence can mean two different things. A read that
     * failed has told us nothing about whether a run finished, and saying "all clear" on the back
     * of it would be the check with nothing to check.
     */
    await logEvent(db, "vanished_run_scan_unavailable", "warn", {
      error: error.message.slice(0, 300),
      means:
        "The scan for runs that started and never finished could not read the event log, so " +
        "whether any vanished is UNKNOWN. This is not a clean bill of health.",
    }).catch(() => {});
    return 0;
  }

  const rows = (starts ?? []) as StartRow[];
  if (rows.length === 0) return 0;

  // Everything filed since the oldest start, in one read rather than one per start.
  const terminals = [...new Set(Object.values(RUN_FAMILIES).flat())];
  const { data: ends } = await db
    .from("system_events")
    .select("kind,created_at")
    .in("kind", terminals)
    .gte("created_at", rows[0].created_at)
    .order("created_at", { ascending: true });

  /*
   * ORDERED AND LIMITED, not windowed by `created_at`.
   *
   * The first version filtered these by `gte("created_at", from)`, which reads correctly and is
   * wrong in a way only running it showed: the row this module writes gets its `created_at` from
   * the column default, so the value is not in the payload. A test caught it because `fake-db.ts`
   * supplies no defaults — deliberately, and its header says why: a fake that helpfully filled one
   * in "made that assertion pass no matter what the worker did".
   *
   * Most recent first with a ceiling, because an unordered `limit` returns an arbitrary slice and
   * PostgREST truncates at 1,000 regardless — the fault `row-ceiling.test.ts` exists to catch. 500
   * is far more than the 36-hour window can hold; if it were ever reached, the ones that fell off
   * the end are older than anything being scanned.
   */
  const { data: already } = await db
    .from("system_events")
    .select("detail")
    .eq("kind", VANISHED_KIND)
    .order("created_at", { ascending: false })
    .limit(500);

  const reported = new Set(
    (already ?? [])
      .map((r) => (r as { detail?: { started_event_id?: number } }).detail?.started_event_id)
      .filter((id): id is number => typeof id === "number"),
  );

  let filed = 0;

  for (let i = 0; i < rows.length; i++) {
    const start = rows[i];
    if (reported.has(start.id)) continue;

    const family = RUN_FAMILIES[start.kind] ?? [];
    const startedAt = new Date(start.created_at).getTime();

    /*
     * The window closes at the NEXT start of the same kind.
     *
     * Otherwise a later successful run's terminal event would retroactively close an earlier
     * orphan, and the 06:00 corpus run that died on its budget would have been covered by the 06:29
     * retry that reported properly. Two runs, two outcomes.
     */
    const nextSame = rows.slice(i + 1).find((r) => r.kind === start.kind);
    const closesAt = nextSame ? new Date(nextSame.created_at).getTime() : Infinity;

    const finished = (ends ?? []).some((e) => {
      const row = e as { kind: string; created_at: string };
      if (!family.includes(row.kind)) return false;
      const at = new Date(row.created_at).getTime();
      return at >= startedAt && at < closesAt;
    });

    if (finished) continue;

    await logEvent(db, VANISHED_KIND, "error", {
      started_kind: start.kind,
      started_event_id: start.id,
      started_at: start.created_at,
      expected_one_of: family,
      means:
        `${start.kind} was filed at ${start.created_at} and none of ${family.join(", ")} ever ` +
        `followed it. The run did not reach its own end, so it reported neither a result nor a ` +
        `failure. The usual cause is the isolate being torn down while the work continued under ` +
        `waitUntil, which takes the budget timer and the catch block with it — so nothing inside ` +
        `the run can report this, and nothing did.`,
    }).catch(() => {});

    filed++;
  }

  return filed;
}
