/**
 * Has this draft been written before? Checked against HIS OWN earlier drafts.
 *
 * WHY THIS EXISTS, AND WHY THE CHECK THAT SHOULD HAVE CAUGHT IT DID NOT
 *
 * Josh, 30 October: "it over-indexes on some rules where if something is repeating or it thinks is
 * repetitive, it'll try to cut it down… sometimes it becomes too strict with repeating things." He
 * had also watched the retelling check run and asked whether it was "to check that it's not too
 * similar".
 *
 * Measured on 2 November, the opposite was true. The retelling check compares an embedding of the
 * new moment against `moment_embeddings` and `published_archive`. There are 122 moments and SIX
 * embeddings, and `published_archive` is empty. So the check Josh watched run compared his moment
 * against almost nothing and reported "clear" — correctly, by its own lights, and uselessly.
 *
 * What got through, from the drafts table:
 *
 *   "The number of reps who don't want to cold call shocks me."
 *     — opened FOUR drafts across FOUR different moments, all on 29 October
 *   "We moved a reporting job from 40 hours a week down to 6 hours a week."
 *     — opened THREE drafts across THREE different moments, on 13 October
 *
 * Nothing in the system noticed, because nothing compares a draft against drafts. The embedding
 * path compares MOMENTS, and it needs a provider that has been returning a billing error.
 *
 * WHY THIS ONE CANNOT BE STARVED
 *
 * It is exact-match arithmetic over text that is already in the database: the first line, and the
 * seven-word runs. No model, no embedding provider, no network beyond the query. If the drafts
 * table has rows, this check works.
 *
 * WHY IT ADVISES AND NEVER REFUSES
 *
 * Clause 8.3's shingle guard refuses a draft that borrows from a REFERENCE WRITER, because those
 * are somebody else's words. These are Josh's own, and repeating yourself is a judgement rather
 * than a wrong construction — a deliberate callback to an earlier post is a real move. It is also
 * normal for version 5 of a moment to open exactly as version 4 did, which is why this only looks
 * at drafts for a DIFFERENT moment.
 */

import { shinglesOf, normaliseRun, SHINGLE_WORDS } from "../supabase/functions/_shared/shingles.ts";

/** The first non-blank line, which is the only line the hook check reads. */
export function firstLine(body) {
  return (body ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
}

/**
 * Compare one draft against rows of earlier drafts.
 *
 * Pure, so a test can hand it rows rather than a database. `rows` is `{id, moment_id, body}`.
 *
 * @param momentId the moment this draft belongs to. Rows with this moment_id are SKIPPED — a
 *                 redraft legitimately keeps its opening, and flagging that would be noise on
 *                 every single revision.
 */
export function selfEcho(body, momentId, rows) {
  const mine = firstLine(body);
  const normalisedMine = normaliseRun(mine);
  const myRuns = new Set(shinglesOf(body));

  const openings = [];
  const runs = new Map();

  for (const r of rows ?? []) {
    if (!r?.body) continue;
    // A different moment, always. Same-moment echo is a redraft and is correct.
    if (Number(r.moment_id) === Number(momentId)) continue;

    if (normalisedMine && normaliseRun(firstLine(r.body)) === normalisedMine) {
      openings.push({ draft_id: r.id, moment_id: r.moment_id });
    }

    for (const run of shinglesOf(r.body)) {
      if (!myRuns.has(run)) continue;
      if (!runs.has(run)) runs.set(run, []);
      const at = runs.get(run);
      if (at.length < 3) at.push({ draft_id: r.id, moment_id: r.moment_id });
    }
  }

  return {
    checked: rows?.length ?? 0,
    same_opening: openings,
    shared_runs: [...runs.entries()].map(([run, where]) => ({ run, where })),
  };
}

/**
 * The reportable form, for create_draft's reply. Returns null when there is nothing to say, so the
 * caller can decide whether silence is worth printing — it is, and the caller does print it.
 */
export function selfEchoReport(echo) {
  if (!echo) return null;
  const openings = echo.same_opening ?? [];
  const shared = echo.shared_runs ?? [];
  if (!openings.length && !shared.length) return null;

  const lines = [];
  if (openings.length) {
    lines.push(
      `This draft opens on the same line as ${openings.length} earlier draft(s) for other ` +
      `moment(s): ${openings.map((o) => `draft ${o.draft_id} (moment ${o.moment_id})`).join(", ")}. ` +
      "The first line is the only line the hook check reads and the only one most readers see, so " +
      "two posts opening identically are the same post to anyone scrolling.",
    );
  }
  if (shared.length) {
    lines.push(
      `${shared.length} run(s) of ${SHINGLE_WORDS} words also appear in an earlier draft for ` +
      `another moment: ${shared.slice(0, 3).map((s) => `"${s.run}"`).join(", ")}` +
      `${shared.length > 3 ? ` and ${shared.length - 3} more` : ""}.`,
    );
  }
  lines.push(
    "REPORTED, NEVER REFUSED. These are his own words and repeating himself is his call — a " +
    "deliberate callback is a real move. Read it to him and let him decide.",
  );
  return lines;
}
