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

import {
  borrowedRuns,
  hashRun,
  normaliseRun,
  shinglesOf,
  SHINGLE_WORDS,
} from "../supabase/functions/_shared/shingles.ts";

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

  const openings = [];
  /** Only the drafts actually compared — see the note on `checked` below. */
  const compared = [];
  const index = new Set();

  for (const r of rows ?? []) {
    if (!r?.body) continue;
    // A different moment, always. Same-moment echo is a redraft and is correct.
    if (Number(r.moment_id) === Number(momentId)) continue;
    compared.push(r);

    if (normalisedMine && normaliseRun(firstLine(r.body)) === normalisedMine) {
      openings.push({ draft_id: r.id, moment_id: r.moment_id });
    }
    for (const run of shinglesOf(r.body)) index.add(hashRun(run));
  }

  /*
   * MERGED INTO PASSAGES, NOT COUNTED AS WINDOWS — corrected 2 November, the day this was written.
   *
   * The first version collected every matching seven-word window separately, so one shared sentence
   * came back as ten overlapping runs and the report said "10 runs of 7 words also appear in an
   * earlier draft" over three near-identical fragments of the same sentence. A report inflated
   * tenfold is one Josh learns to skip, which costs more than the finding is worth.
   *
   * `borrowedRuns` already merges adjacent hits into one passage — it exists for exactly this, in
   * the guard this check is modelled on — so it is reused rather than re-implemented. That also
   * means the two can never disagree about where a shared passage starts and ends.
   */
  const passages = borrowedRuns(body, index);

  /*
   * Which earlier draft each passage came from. Done after the merge rather than during it, because
   * the merge works on the NEW draft's word positions and a passage can legitimately appear in more
   * than one earlier draft. Capped at three, because a fourth location tells Josh nothing a third
   * did not.
   */
  const shared = passages.map((run) => {
    const where = [];
    for (const r of compared) {
      if (where.length >= 3) break;
      if (normaliseRun(r.body).includes(run)) where.push({ draft_id: r.id, moment_id: r.moment_id });
    }
    return { run, where };
  }).filter((p) => p.where.length > 0);

  return {
    /*
     * The drafts actually compared, not the rows handed in.
     *
     * This counted `rows.length` and the reply rendered it as "N earlier drafts, excluding this
     * moment's own" — a basis it did not have. On a moment at version 7 it claimed 200 while
     * comparing 193, and if every recent draft belonged to this moment it would have claimed 200
     * against nothing compared, while the "nothing looked" branch never fired. A check that
     * misstates its own basis is the failure this module's header is about.
     */
    checked: compared.length,
    same_opening: openings,
    shared_runs: shared,
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
      `${shared.length} passage(s) of ${SHINGLE_WORDS} words or more also appear in an earlier ` +
      `draft for another moment: ${shared.slice(0, 3).map((s) => `"${s.run}"`).join(", ")}` +
      `${shared.length > 3 ? ` and ${shared.length - 3} more` : ""}.`,
    );
  }
  lines.push(
    "REPORTED, NEVER REFUSED. These are his own words and repeating himself is his call — a " +
    "deliberate callback is a real move. Read it to him and let him decide.",
  );
  return lines;
}
